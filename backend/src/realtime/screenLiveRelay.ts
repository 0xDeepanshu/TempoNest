import type { IncomingMessage, Server as HttpServer } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocket, WebSocketServer, type RawData } from 'ws';
import { config } from '../config/env';
import { logger } from '../config/logger';
import { ScreenLiveSession } from '../database';
import { AppError } from '../utils/errors';
import { isOriginAllowed } from '../middleware/csrf';
import {
  authorizeScreenLiveAgentStream,
  canScreenLiveViewerContinue,
  consumeScreenLiveViewerTicket,
  isIntegrationSessionVerified,
  markScreenLiveViewerLeft,
  setScreenLiveIndicatorState,
  terminateScreenLiveSession,
  touchScreenLiveViewer,
} from '../modules/screenshots/screenLive.service';
import { LIVE_INDICATOR_STREAM_HEADER, LIVE_INDICATOR_STREAM_VALUE } from './agentCapabilities';
import { onScreenLiveSessionEnded } from '../modules/screenshots/screenLiveEvents';
import type { ScreenLiveSessionSummary } from '../modules/screenshots/screenLive.mapper';
import type { ScreenLiveViewerSummary } from '../modules/screenshots/screenLive.mapper';
import { authenticateAgentUpgrade, rejectUpgrade } from './agentWebSocket';

const VIEWER_PATH = `${config.apiPrefix}${config.screenLive.viewerPath}`;
const AGENT_PATH = `${config.apiPrefix}${config.screenLive.agentPath}`;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TICKET_PATTERN = /^[A-Za-z0-9_-]{20,200}$/;
const AUTH_RECHECK_INTERVAL_MS = 60_000;
const DEFAULT_HANDSHAKE_TIMEOUT_MS = 5_000;
const MAX_PENDING_VIEWERS = 64;

export interface ScreenLiveRelayOptions {
  /** How long an upgraded viewer may wait before sending its ticket. */
  viewerHandshakeTimeoutMs?: number;
}

type ViewerConnection = {
  ws: WebSocket;
  viewerId: string;
  sessionId: string;
  organizationId: string;
  userId: string;
  isAlive: boolean;
  lastAuthCheckAt: number;
  sawFrame: boolean;
  left: boolean;
  /** Integration sessions are re-authorized on the integration interval, not the default one. */
  integration: boolean;
};

type PendingViewer = {
  ws: WebSocket;
  timer: NodeJS.Timeout;
  authenticating: boolean;
  onMessage: (raw: RawData, isBinary: boolean) => void;
};

type AgentStreamConnection = {
  ws: WebSocket;
  sessionId: string;
  organizationId: string;
  agentId: string;
  employeeId: string;
  isAlive: boolean;
  lastFrameAt: number;
  lastAuthCheckAt: number;
  expiresAt: number;
  /** True for integration sessions: no frame is forwarded until the agent confirms its indicator. */
  requiresIndicator: boolean;
  indicatorConfirmed: boolean;
  unconfirmedFrames: number;
};

function header(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function toBuffer(raw: RawData): Buffer {
  if (Buffer.isBuffer(raw)) return raw;
  if (Array.isArray(raw)) return Buffer.concat(raw);
  return Buffer.from(raw as ArrayBuffer);
}

function isJpeg(frame: Buffer): boolean {
  return (
    frame.length >= 4 &&
    frame[0] === 0xff &&
    frame[1] === 0xd8 &&
    frame[2] === 0xff
  );
}

function sendJson(ws: WebSocket, payload: Record<string, unknown>): void {
  if (ws.readyState !== WebSocket.OPEN) return;
  try {
    ws.send(JSON.stringify(payload));
  } catch (error) {
    logger.debug({ err: error }, 'failed to send live screen control message');
  }
}

/**
 * Dedicated binary relay for live screen capture. It is intentionally separate
 * from the JSON agent channel: frames are fanned out from one agent socket to
 * the authorized viewers of the same session and are never persisted.
 *
 * The relay is process-local. Running more than one API instance requires
 * sticky routing for both endpoints or a shared pub/sub layer; frames are not
 * bridged between processes.
 */
export class ScreenLiveRelay {
  private readonly viewerWss = new WebSocketServer({
    noServer: true,
    maxPayload: 16_384,
  });
  private readonly agentWss = new WebSocketServer({
    noServer: true,
    maxPayload: config.screenLive.maxFrameBytes,
  });

  private readonly viewers = new Map<string, Set<ViewerConnection>>();
  private readonly viewerMeta = new Map<WebSocket, ViewerConnection>();
  private readonly pendingViewers = new Map<WebSocket, PendingViewer>();
  private readonly agentStreams = new Map<string, AgentStreamConnection>();
  private readonly viewerGraceTimers = new Map<string, NodeJS.Timeout>();
  private readonly agentGraceTimers = new Map<string, NodeJS.Timeout>();
  private readonly expiryTimers = new Map<string, NodeJS.Timeout>();
  private readonly handshakeTimeoutMs: number;

  /** Background database work started by socket events and timers, so shutdown and tests can await it. */
  private readonly inFlight = new Set<Promise<unknown>>();

  private unsubscribe: (() => void) | null = null;
  private sweepTimer: NodeJS.Timeout | null = null;
  private verifyTimer: NodeJS.Timeout | null = null;
  /** Integration sessions that could not be ended in the database yet, retried until they are. */
  private readonly pendingTerminations = new Set<string>();
  private closed = false;

  constructor(options: ScreenLiveRelayOptions = {}) {
    this.handshakeTimeoutMs = options.viewerHandshakeTimeoutMs ?? DEFAULT_HANDSHAKE_TIMEOUT_MS;
  }

  /**
   * Runs a fire-and-forget task (a database write started by a socket event or a timer). A failure is
   * logged, never thrown, and the task is remembered until it settles so `idle()` can wait for it.
   */
  private fire(task: Promise<unknown>): void {
    const tracked: Promise<unknown> = task
      .then(
        () => undefined,
        (error: unknown) => logger.warn({ err: error }, 'live screen relay background task failed'),
      )
      .finally(() => {
        this.inFlight.delete(tracked);
      });
    this.inFlight.add(tracked);
  }

  /** Resolves once every background task started so far, and any it started in turn, has settled. */
  async idle(): Promise<void> {
    while (this.inFlight.size > 0) {
      await Promise.all([...this.inFlight]);
    }
  }

  attach(server: HttpServer): this {
    server.on('upgrade', (req, socket, head) => {
      let url: URL;
      try {
        url = new URL(req.url ?? '/', 'http://localhost');
      } catch {
        socket.destroy();
        return;
      }

      if (url.pathname === VIEWER_PATH) {
        this.handleViewerUpgrade(req, socket, head, url);
        return;
      }
      if (url.pathname === AGENT_PATH) {
        this.handleAgentUpgrade(req, socket, head, url);
      }
    });

    this.unsubscribe = onScreenLiveSessionEnded((event) => {
      this.endLocal(event.sessionId, event.reason);
    });

    this.sweepTimer = setInterval(() => this.sweep(), config.timeTracking.wsSweepIntervalMs);
    this.sweepTimer.unref();
    this.verifyTimer = setInterval(
      () => this.enforceVerification(),
      config.screenLive.integrationRevalidateMs,
    );
    this.verifyTimer.unref();

    this.viewerWss.on('close', () => this.viewerWss.clients.clear());
    this.agentWss.on('close', () => this.agentWss.clients.clear());

    return this;
  }

  private handleViewerUpgrade(
    req: IncomingMessage,
    socket: Duplex,
    head: Buffer,
    _url: URL,
  ): void {
    if (this.closed) {
      rejectUpgrade(socket, 503, 'RELAY_UNAVAILABLE', 'Live viewing is unavailable');
      return;
    }

    const origin = header(req.headers.origin);
    if (origin && !isOriginAllowed(origin)) {
      rejectUpgrade(socket, 403, 'ORIGIN_NOT_ALLOWED', 'Origin not allowed');
      return;
    }

    if (this.pendingViewers.size >= MAX_PENDING_VIEWERS) {
      rejectUpgrade(socket, 503, 'RELAY_BUSY', 'Too many pending live view connections');
      return;
    }

    // The upgrade is unauthenticated by design: the ticket arrives in the first
    // text message so it never appears in URLs, proxy access logs, or errors.
    this.viewerWss.handleUpgrade(req, socket, head, (ws) => {
      this.registerPendingViewer(ws);
    });
  }

  private registerPendingViewer(ws: WebSocket): void {
    const pending: PendingViewer = {
      ws,
      authenticating: false,
      timer: setTimeout(() => {
        this.failPendingViewer(
          pending,
          4001,
          'SCREEN_LIVE_AUTH_TIMEOUT',
          'Send a viewer ticket to start the live view.',
        );
      }, this.handshakeTimeoutMs),
      onMessage: (raw: RawData, isBinary: boolean) => {
        this.fire(this.handleViewerAuthMessage(pending, raw, isBinary));
      },
    };
    pending.timer.unref();
    this.pendingViewers.set(ws, pending);

    ws.on('message', pending.onMessage);
    ws.on('close', () => this.clearPendingViewer(ws));
    ws.on('error', (error) => {
      logger.debug({ err: error }, 'live screen viewer handshake transport error');
    });
  }

  private async handleViewerAuthMessage(
    pending: PendingViewer,
    raw: RawData,
    isBinary: boolean,
  ): Promise<void> {
    if (pending.authenticating) return;
    if (!this.pendingViewers.has(pending.ws)) return;

    if (isBinary) {
      this.failPendingViewer(
        pending,
        4001,
        'SCREEN_LIVE_AUTH_REQUIRED',
        'Send a viewer ticket before any stream data.',
      );
      return;
    }

    let message: { type?: unknown; ticket?: unknown };
    try {
      message = JSON.parse(raw.toString()) as { type?: unknown; ticket?: unknown };
    } catch {
      this.failPendingViewer(
        pending,
        4001,
        'SCREEN_LIVE_TICKET_REQUIRED',
        'Send a viewer ticket to start the live view.',
      );
      return;
    }

    if (
      message.type !== 'authenticate' ||
      typeof message.ticket !== 'string' ||
      !TICKET_PATTERN.test(message.ticket)
    ) {
      this.failPendingViewer(
        pending,
        4001,
        'SCREEN_LIVE_TICKET_REQUIRED',
        'Send a viewer ticket to start the live view.',
      );
      return;
    }

    pending.authenticating = true;
    clearTimeout(pending.timer);

    try {
      const result = await consumeScreenLiveViewerTicket(message.ticket);
      if (!this.pendingViewers.delete(pending.ws)) {
        // The socket disappeared while the ticket was being verified. Release
        // the viewer row so it cannot look like an active viewer.
        await markScreenLiveViewerLeft({
          viewerId: result.viewer.id,
          reason: 'VIEWER_DISCONNECTED',
        }).catch(() => undefined);
        return;
      }
      pending.ws.off('message', pending.onMessage);
      this.registerViewer(
        pending.ws,
        result.viewer,
        result.session,
        result.organizationId,
        result.userId,
      );
    } catch (error) {
      if (!this.pendingViewers.has(pending.ws)) return;
      const status = (error as { statusCode?: number }).statusCode ?? 401;
      const code = (error as { code?: string }).code ?? 'SCREEN_LIVE_TICKET_INVALID';
      if (!(error instanceof AppError)) {
        // Unexpected database or transport failures must not leak internal
        // details to the browser.
        logger.warn({ err: error }, 'live screen ticket verification failed');
      }
      const message =
        error instanceof AppError
          ? error.message
          : 'The live screen ticket could not be verified.';
      const closeCode = status === 409 ? 4000 : 4001;
      this.failPendingViewer(pending, closeCode, code, message);
    }
  }

  private failPendingViewer(
    pending: PendingViewer,
    closeCode: number,
    code: string,
    message: string,
  ): void {
    this.clearPendingViewer(pending.ws);
    sendJson(pending.ws, {
      type: 'live.error',
      code,
      message,
      serverTime: new Date().toISOString(),
    });
    try {
      pending.ws.close(closeCode, code.slice(0, 64));
    } catch {
      // The socket may already be closing.
    }
  }

  private clearPendingViewer(ws: WebSocket): void {
    const pending = this.pendingViewers.get(ws);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pendingViewers.delete(ws);
  }

  private registerViewer(
    ws: WebSocket,
    viewer: ScreenLiveViewerSummary,
    session: ScreenLiveSessionSummary,
    organizationId: string,
    userId: string,
  ): void {
    const connection: ViewerConnection = {
      ws,
      viewerId: viewer.id,
      sessionId: session.id,
      organizationId,
      userId,
      isAlive: true,
      lastAuthCheckAt: Date.now(),
      sawFrame: false,
      left: false,
      integration: session.origin === 'INTEGRATION',
    };

    const set = this.viewers.get(session.id) ?? new Set<ViewerConnection>();
    set.add(connection);
    this.viewers.set(session.id, set);
    this.viewerMeta.set(ws, connection);

    const grace = this.viewerGraceTimers.get(session.id);
    if (grace) {
      clearTimeout(grace);
      this.viewerGraceTimers.delete(session.id);
    }
    this.ensureExpiryTimer(session.id, new Date(session.expiresAt).getTime());

    sendJson(ws, {
      type: 'live.ready',
      serverTime: new Date().toISOString(),
      session,
      viewer,
    });

    ws.on('pong', () => {
      connection.isAlive = true;
    });

    ws.on('message', (raw: RawData, isBinary: boolean) => {
      if (isBinary) {
        ws.close(1003, 'TEXT_ONLY');
        return;
      }
      let message: { type?: unknown };
      try {
        message = JSON.parse(raw.toString()) as { type?: unknown };
      } catch {
        return;
      }
      if (message.type === 'ping') {
        sendJson(ws, { type: 'pong', serverTime: new Date().toISOString() });
        return;
      }
      if (message.type === 'stop') {
        this.leaveViewer(connection, 'VIEWER_STOPPED');
        ws.close(1000, 'VIEWER_STOPPED');
      }
    });

    ws.on('close', () => {
      this.leaveViewer(connection, 'VIEWER_DISCONNECTED');
    });

    ws.on('error', (error) => {
      logger.debug({ err: error }, 'live screen viewer transport error');
    });
  }

  private handleAgentUpgrade(
    req: IncomingMessage,
    socket: Duplex,
    head: Buffer,
    url: URL,
  ): void {
    if (this.closed) {
      rejectUpgrade(socket, 503, 'RELAY_UNAVAILABLE', 'Live viewing is unavailable');
      return;
    }

    const liveSessionId = url.searchParams.get('liveSessionId');
    if (!liveSessionId || !UUID_PATTERN.test(liveSessionId)) {
      rejectUpgrade(socket, 400, 'INVALID_LIVE_SESSION_ID', 'A valid liveSessionId is required');
      return;
    }

    this.fire(authenticateAgentUpgrade(req)
      .then(async (context) => {
        const session = await authorizeScreenLiveAgentStream({
          organizationId: context.organization.id,
          sessionId: liveSessionId,
          employeeId: context.user.id,
          agentId: context.agent.id,
        });
        if (
          session.origin === 'INTEGRATION' &&
          header(req.headers[LIVE_INDICATOR_STREAM_HEADER]) !== LIVE_INDICATOR_STREAM_VALUE
        ) {
          // An older desktop app cannot show the employee the indicator. It is refused, and the session
          // ends instead of waiting for an app that can never confirm.
          this.fire(terminateScreenLiveSession({
            sessionId: session.id,
            organizationId: session.organizationId,
            reason: 'INDICATOR_UNAVAILABLE',
            metadata: { code: 'SCREEN_LIVE_INDICATOR_UNSUPPORTED' },
          }).catch((error) => logger.warn({ err: error }, 'failed to end session for unsupported agent')));
          rejectUpgrade(
            socket,
            403,
            'SCREEN_LIVE_INDICATOR_UNSUPPORTED',
            'The desktop app must be updated to show the live viewing indicator',
          );
          return;
        }
        if (this.closed) {
          rejectUpgrade(socket, 503, 'RELAY_UNAVAILABLE', 'Live viewing is unavailable');
          return;
        }
        this.agentWss.handleUpgrade(req, socket, head, (ws) => {
          this.registerAgent(ws, session);
        });
      })
      .catch((error: unknown) => {
        const status =
          (error as { statusCode?: number; status?: number }).statusCode ??
          (error as { status?: number }).status ??
          401;
        const code = (error as { code?: string }).code ?? 'UNAUTHENTICATED';
        const message = error instanceof Error ? error.message : 'Authorization failed';
        rejectUpgrade(socket, status, code, message);
      }));
  }

  private registerAgent(
    ws: WebSocket,
    session: Awaited<ReturnType<typeof authorizeScreenLiveAgentStream>>,
  ): void {
    const previous = this.agentStreams.get(session.id);
    if (previous) {
      try {
        previous.ws.close(4000, 'REPLACED');
      } catch {
        // The replacement socket is authoritative.
      }
      this.agentStreams.delete(session.id);
    }

    const grace = this.agentGraceTimers.get(session.id);
    if (grace) {
      clearTimeout(grace);
      this.agentGraceTimers.delete(session.id);
    }

    const connection: AgentStreamConnection = {
      ws,
      sessionId: session.id,
      organizationId: session.organizationId,
      agentId: session.desktopAgentId,
      employeeId: session.employeeId,
      isAlive: true,
      lastFrameAt: 0,
      lastAuthCheckAt: Date.now(),
      expiresAt: session.expiresAt.getTime(),
      requiresIndicator: session.origin === 'INTEGRATION',
      indicatorConfirmed: false,
      unconfirmedFrames: 0,
    };
    this.agentStreams.set(session.id, connection);
    if (connection.requiresIndicator) {
      // Every stream connection starts unconfirmed, even if an earlier one was confirmed.
      this.fire(setScreenLiveIndicatorState({
        sessionId: session.id,
        organizationId: session.organizationId,
        agentId: session.desktopAgentId,
        visible: false,
      }).catch((error) => logger.warn({ err: error }, 'failed to reset indicator state')));
    }
    this.ensureExpiryTimer(session.id, connection.expiresAt);

    sendJson(ws, {
      type: 'live.ready',
      serverTime: new Date().toISOString(),
      liveSessionId: session.id,
      expiresAt: session.expiresAt.toISOString(),
      maxFps: config.screenLive.maxFps,
      maxFrameBytes: config.screenLive.maxFrameBytes,
      requireIndicator: connection.requiresIndicator,
    });

    ws.on('pong', () => {
      connection.isAlive = true;
    });

    ws.on('message', (raw: RawData, isBinary: boolean) => {
      if (!isBinary) {
        let message: { type?: unknown; state?: unknown };
        try {
          message = JSON.parse(raw.toString()) as { type?: unknown; state?: unknown };
        } catch {
          return;
        }
        if (message.type === 'ping') {
          sendJson(ws, { type: 'pong', serverTime: new Date().toISOString() });
        } else if (message.type === 'live.indicator') {
          this.handleIndicatorMessage(connection, message.state === 'visible');
        }
        return;
      }
      this.handleFrame(connection, raw);
    });

    ws.on('close', () => {
      if (this.agentStreams.get(connection.sessionId) !== connection) return;
      this.agentStreams.delete(connection.sessionId);
      if (connection.requiresIndicator) {
        connection.indicatorConfirmed = false;
        this.fire(setScreenLiveIndicatorState({
          sessionId: connection.sessionId,
          organizationId: connection.organizationId,
          agentId: connection.agentId,
          visible: false,
        }).catch((error) => logger.warn({ err: error }, 'failed to clear indicator state')));
      }
      if (this.closed) return;
      this.scheduleAgentGrace(connection.sessionId);
    });

    ws.on('error', (error) => {
      logger.debug({ err: error }, 'live screen agent transport error');
    });
  }

  /**
   * The agent's statement that its on-screen indicator is (or is no longer) visible. Frames of an
   * integration session are forwarded only between a `visible` and the next `hidden`.
   */
  private handleIndicatorMessage(connection: AgentStreamConnection, visible: boolean): void {
    if (!connection.requiresIndicator) return;
    connection.indicatorConfirmed = visible;
    this.fire(setScreenLiveIndicatorState({
      sessionId: connection.sessionId,
      organizationId: connection.organizationId,
      agentId: connection.agentId,
      visible,
    })
      .then(() => {
        if (visible) {
          for (const viewer of this.viewers.get(connection.sessionId) ?? []) {
            sendJson(viewer.ws, {
              type: 'live.indicator',
              state: 'visible',
              serverTime: new Date().toISOString(),
            });
          }
          return;
        }
        // The indicator went away: nothing may be shown, and the session does not continue.
        return terminateScreenLiveSession({
          sessionId: connection.sessionId,
          organizationId: connection.organizationId,
          reason: 'INDICATOR_UNAVAILABLE',
          metadata: { code: 'SCREEN_LIVE_INDICATOR_HIDDEN' },
        });
      })
      .catch((error) => logger.warn({ err: error }, 'failed to record live indicator state')));
  }

  /**
   * Fail-closed check for integration streams. A stream whose session could not be re-authorized within
   * the verification window (the database or the revalidation loop is not working) is shown to nobody:
   * frames are already dropped by `handleFrame`, and here the sockets are closed and the session ended,
   * retrying until the database accepts the change. Public so tests can run a pass on demand.
   */
  enforceVerification(): void {
    if (this.closed) return;
    for (const agent of [...this.agentStreams.values()]) {
      if (!agent.requiresIndicator || isIntegrationSessionVerified(agent.sessionId)) continue;
      this.pendingTerminations.add(agent.sessionId);
      this.endLocal(agent.sessionId, 'VERIFICATION_UNAVAILABLE');
    }
    for (const sessionId of [...this.pendingTerminations]) {
      this.fire(terminateScreenLiveSession({
        sessionId,
        reason: 'VERIFICATION_UNAVAILABLE',
        metadata: { code: 'SCREEN_LIVE_VERIFICATION_UNAVAILABLE' },
      })
        .then(() => this.pendingTerminations.delete(sessionId))
        .catch((error) => logger.warn({ err: error, sessionId }, 'will retry ending unverifiable session')));
    }
  }

  private handleFrame(connection: AgentStreamConnection, raw: RawData): void {
    const now = Date.now();
    if (now >= connection.expiresAt) {
      this.fire(terminateScreenLiveSession({
        sessionId: connection.sessionId,
        organizationId: connection.organizationId,
        reason: 'EXPIRED',
      }).catch((error) => logger.warn({ err: error }, 'failed to expire live screen session')));
      return;
    }

    // Hard gate: an integration session shows nothing until the employee's indicator is confirmed.
    // Early frames are dropped, never forwarded or buffered; an agent that keeps sending them is cut off.
    if (connection.requiresIndicator && !connection.indicatorConfirmed) {
      connection.unconfirmedFrames += 1;
      if (connection.unconfirmedFrames >= 3) {
        this.fire(terminateScreenLiveSession({
          sessionId: connection.sessionId,
          organizationId: connection.organizationId,
          reason: 'INDICATOR_UNAVAILABLE',
          metadata: { code: 'SCREEN_LIVE_INDICATOR_REQUIRED' },
        }).catch((error) => logger.warn({ err: error }, 'failed to end session without indicator')));
        try {
          connection.ws.close(4003, 'INDICATOR_REQUIRED');
        } catch {
          // The close handler applies the agent grace period.
        }
      }
      return;
    }

    // Fail closed: no frame leaves while the session cannot be positively re-authorized.
    if (connection.requiresIndicator && !isIntegrationSessionVerified(connection.sessionId)) return;

    const frame = toBuffer(raw);
    if (frame.length === 0 || frame.length > config.screenLive.maxFrameBytes) return;
    if (!isJpeg(frame)) {
      // A non-JPEG payload is a protocol violation; stop capture rather than
      // forwarding unvalidated bytes to browsers.
      try {
        connection.ws.close(4003, 'INVALID_FRAME');
      } catch {
        // The close handler applies the agent grace period.
      }
      return;
    }

    const minimumInterval = Math.floor(1000 / config.screenLive.maxFps);
    if (
      connection.lastFrameAt > 0 &&
      now - connection.lastFrameAt < minimumInterval * 0.75
    ) {
      return;
    }
    connection.lastFrameAt = now;

    const viewers = this.viewers.get(connection.sessionId);
    if (!viewers || viewers.size === 0) return;

    for (const viewer of viewers) {
      if (viewer.ws.readyState !== WebSocket.OPEN) continue;
      if (viewer.ws.bufferedAmount > config.screenLive.viewerBufferLimitBytes) {
        // Slow viewer: drop this frame instead of building unbounded memory.
        continue;
      }
      if (!viewer.sawFrame) {
        viewer.sawFrame = true;
        sendJson(viewer.ws, {
          type: 'live.started',
          serverTime: new Date(now).toISOString(),
        });
      }
      try {
        viewer.ws.send(frame, { binary: true });
      } catch (error) {
        logger.debug({ err: error }, 'failed to deliver live frame');
      }
    }
  }

  private leaveViewer(connection: ViewerConnection, reason: string): void {
    if (connection.left) return;
    connection.left = true;

    const set = this.viewers.get(connection.sessionId);
    if (set) {
      set.delete(connection);
      if (set.size === 0) {
        this.viewers.delete(connection.sessionId);
        this.scheduleViewerGrace(connection.sessionId);
      }
    }
    this.viewerMeta.delete(connection.ws);

    this.fire(markScreenLiveViewerLeft({
      viewerId: connection.viewerId,
      reason,
    }).catch((error) => logger.warn({ err: error }, 'failed to record viewer departure')));
  }

  private scheduleViewerGrace(sessionId: string): void {
    if (this.closed || this.viewerGraceTimers.has(sessionId)) return;
    const timer = setTimeout(() => {
      this.viewerGraceTimers.delete(sessionId);
      if (this.closed) return;
      if ((this.viewers.get(sessionId)?.size ?? 0) > 0) return;
      this.fire(terminateScreenLiveSession({
        sessionId,
        reason: 'ALL_VIEWERS_LEFT',
      }).catch((error) => logger.warn({ err: error }, 'failed to stop unattended live session')));
    }, config.screenLive.viewerGraceMs);
    timer.unref();
    this.viewerGraceTimers.set(sessionId, timer);
  }

  private scheduleAgentGrace(sessionId: string): void {
    if (this.closed || this.agentGraceTimers.has(sessionId)) return;
    const timer = setTimeout(() => {
      this.agentGraceTimers.delete(sessionId);
      if (this.closed) return;
      if (this.agentStreams.has(sessionId)) return;
      this.fire(terminateScreenLiveSession({
        sessionId,
        reason: 'AGENT_DISCONNECTED',
      }).catch((error) => logger.warn({ err: error }, 'failed to stop disconnected live session')));
    }, config.screenLive.agentGraceMs);
    timer.unref();
    this.agentGraceTimers.set(sessionId, timer);
  }

  private ensureExpiryTimer(sessionId: string, expiresAt: number): void {
    if (this.expiryTimers.has(sessionId)) return;
    const delay = Math.max(0, expiresAt - Date.now()) + 250;
    const timer = setTimeout(() => {
      this.expiryTimers.delete(sessionId);
      if (this.closed) return;
      this.fire(terminateScreenLiveSession({ sessionId, reason: 'EXPIRED' }).catch((error) =>
        logger.warn({ err: error }, 'failed to expire live screen session'),
      ));
    }, delay);
    timer.unref();
    this.expiryTimers.set(sessionId, timer);
  }

  private clearSessionTimers(sessionId: string): void {
    for (const timers of [
      this.viewerGraceTimers,
      this.agentGraceTimers,
      this.expiryTimers,
    ]) {
      const timer = timers.get(sessionId);
      if (timer) {
        clearTimeout(timer);
        timers.delete(sessionId);
      }
    }
  }

  private endLocal(sessionId: string, reason: string): void {
    this.clearSessionTimers(sessionId);

    for (const viewer of [...(this.viewers.get(sessionId) ?? [])]) {
      viewer.left = true;
      sendJson(viewer.ws, {
        type: 'live.ended',
        reason,
        serverTime: new Date().toISOString(),
      });
      try {
        viewer.ws.close(4000, 'SESSION_ENDED');
      } catch {
        // Best-effort close; the socket may already be closing.
      }
    }
    this.viewers.delete(sessionId);

    const agent = this.agentStreams.get(sessionId);
    if (agent) {
      sendJson(agent.ws, {
        type: 'live.stop',
        reason,
        serverTime: new Date().toISOString(),
      });
      try {
        agent.ws.close(4000, 'SESSION_ENDED');
      } catch {
        // Best-effort close.
      }
      this.agentStreams.delete(sessionId);
    }
  }

  private sweep(): void {
    if (this.closed) return;

    for (const [ws, viewer] of [...this.viewerMeta]) {
      if (!viewer.isAlive) {
        ws.terminate();
        continue;
      }
      viewer.isAlive = false;
      try {
        ws.ping();
      } catch {
        ws.terminate();
        continue;
      }
      this.fire(touchScreenLiveViewer(viewer.viewerId).catch(() => undefined));

      const now = Date.now();
      const recheckMs = viewer.integration
        ? Math.min(AUTH_RECHECK_INTERVAL_MS, config.screenLive.integrationRevalidateMs)
        : AUTH_RECHECK_INTERVAL_MS;
      if (now - viewer.lastAuthCheckAt < recheckMs) continue;
      viewer.lastAuthCheckAt = now;
      this.fire(canScreenLiveViewerContinue(viewer.viewerId)
        .then((allowed) => {
          if (allowed || this.closed) return;
          sendJson(ws, {
            type: 'live.ended',
            reason: 'ACCESS_REVOKED',
            serverTime: new Date().toISOString(),
          });
          ws.close(4003, 'ACCESS_REVOKED');
        })
        .catch((error) =>
          logger.warn({ err: error }, 'failed to revalidate live screen viewer'),
        ));
    }

    for (const agent of [...this.agentStreams.values()]) {
      if (!agent.isAlive) {
        agent.ws.terminate();
        continue;
      }
      agent.isAlive = false;
      try {
        agent.ws.ping();
      } catch {
        agent.ws.terminate();
        continue;
      }

      const now = Date.now();
      const agentRecheckMs = agent.requiresIndicator
        ? Math.min(AUTH_RECHECK_INTERVAL_MS, config.screenLive.integrationRevalidateMs)
        : AUTH_RECHECK_INTERVAL_MS;
      if (now - agent.lastAuthCheckAt < agentRecheckMs) continue;
      agent.lastAuthCheckAt = now;
      this.fire(authorizeScreenLiveAgentStream({
        organizationId: agent.organizationId,
        sessionId: agent.sessionId,
        employeeId: agent.employeeId,
        agentId: agent.agentId,
      })
        .then((session) => {
          if (session.expiresAt.getTime() !== agent.expiresAt) {
            agent.expiresAt = session.expiresAt.getTime();
            this.ensureExpiryTimer(agent.sessionId, agent.expiresAt);
          }
        })
        .catch((error) => {
          if (this.agentStreams.get(agent.sessionId) !== agent) return;
          if (!(error instanceof AppError)) {
            // Transient database failures must not drop a healthy stream; the
            // next sweep retries before authorization is trusted again.
            logger.warn({ err: error, sessionId: agent.sessionId }, 'live screen agent revalidation failed');
            return;
          }
          logger.info(
            { sessionId: agent.sessionId, reason: error.code },
            'live screen agent stream failed revalidation',
          );
          try {
            agent.ws.close(4003, 'ACCESS_REVOKED');
          } catch {
            agent.ws.terminate();
          }
        }));
    }
  }

  /**
   * Stops capture on the agent, terminates every active session durably, and
   * closes remaining sockets. Called during server shutdown before the database
   * connection is released.
   */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;

    this.unsubscribe?.();
    this.unsubscribe = null;
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = null;
    }
    if (this.verifyTimer) {
      clearInterval(this.verifyTimer);
      this.verifyTimer = null;
    }
    for (const timers of [
      this.viewerGraceTimers,
      this.agentGraceTimers,
      this.expiryTimers,
    ]) {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    }

    try {
      const active = await ScreenLiveSession.findAll({
        where: { status: 'ACTIVE' },
        attributes: ['id'],
      });
      for (const session of active) {
        try {
          await terminateScreenLiveSession({
            sessionId: session.id,
            reason: 'SERVER_SHUTDOWN',
          });
        } catch (error) {
          logger.warn({ err: error }, 'failed to stop live screen session on shutdown');
        }
      }
    } catch (error) {
      logger.warn({ err: error }, 'failed to load live screen sessions on shutdown');
    }

    for (const pending of this.pendingViewers.values()) {
      clearTimeout(pending.timer);
      try {
        pending.ws.close(1001, 'SERVER_SHUTDOWN');
      } catch {
        // Best-effort close.
      }
    }
    this.pendingViewers.clear();

    for (const viewer of this.viewerMeta.values()) {
      try {
        viewer.ws.close(1001, 'SERVER_SHUTDOWN');
      } catch {
        // Best-effort close.
      }
    }
    for (const agent of this.agentStreams.values()) {
      try {
        agent.ws.close(1001, 'SERVER_SHUTDOWN');
      } catch {
        // Best-effort close.
      }
    }
    this.viewerMeta.clear();
    this.agentStreams.clear();
    this.viewers.clear();

    await Promise.all([
      new Promise<void>((resolve) => this.viewerWss.close(() => resolve())),
      new Promise<void>((resolve) => this.agentWss.close(() => resolve())),
    ]);
  }
}

export function attachScreenLiveRelay(
  server: HttpServer,
  options: ScreenLiveRelayOptions = {},
): ScreenLiveRelay {
  return new ScreenLiveRelay(options).attach(server);
}
