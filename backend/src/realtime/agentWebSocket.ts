import type { IncomingMessage, Server as HttpServer } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocket, WebSocketServer, type RawData } from 'ws';
import { config } from '../config/env';
import { logger } from '../config/logger';
import { Break, DesktopAgent, Membership, Organization, Session, TimeSession, User } from '../database';
import { hashOpaqueToken, safeEqualStrings } from '../utils/crypto';
import { AppError } from '../utils/errors';
import { isOriginAllowed } from '../middleware/csrf';
import { agentHub } from './agentHub';
import { isHeartbeatFresh, toTimeSessionSummary } from '../modules/timeTracking/timeSession.mapper';
import {
  acknowledgeScreenshotRequest,
  claimScreenshotRequest,
  completeScreenshotRequest,
  failScreenshotRequest,
  getPendingScreenshotRequestsForAgent,
} from '../modules/screenshots/screenshot.service';
import {
  failScreenLiveSession,
  getPendingScreenLiveSessionForAgent,
} from '../modules/screenshots/screenLive.service';
import type { DesktopAgent as DesktopAgentModel } from '../modules/desktopAgents/desktopAgent.model';
import type { Membership as MembershipModel } from '../modules/memberships/membership.model';
import type { Organization as OrganizationModel } from '../modules/organizations/organization.model';
import type { Session as SessionModel } from '../modules/auth/session.model';
import type { User as UserModel } from '../modules/users/user.model';
import type { TimeSession as TimeSessionModel } from '../modules/timeTracking/timeSession.model';

export type AgentConnectionContext = {
  user: UserModel;
  session: SessionModel;
  membership: MembershipModel;
  organization: OrganizationModel;
  agent: DesktopAgentModel;
  isAlive: boolean;
};

type ConnectionContext = AgentConnectionContext;

const WS_PATH = `${config.apiPrefix}/ws/agent`;

const SCREENSHOT_MESSAGE_TYPES = new Set([
  'screenshot.ack',
  'screenshot.claim',
  'screenshot.complete',
  'screenshot.fail',
]);

// Continuous media never travels over this JSON channel. The agent only uses
// it to report that local capture could not start or continue.
const SCREEN_LIVE_MESSAGE_TYPES = new Set(['screen.live.failed']);

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type AgentMessage = {
  type?: unknown;
  sessionId?: unknown;
  requestId?: unknown;
  liveSessionId?: unknown;
  contentType?: unknown;
  captureTimestamp?: unknown;
  code?: unknown;
  message?: unknown;
};

const UPGRADE_STATUS_TEXT: Record<number, string> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  409: 'Conflict',
  410: 'Gone',
  429: 'Too Many Requests',
};

export function rejectUpgrade(
  socket: Duplex,
  status: number,
  code: string,
  message: string,
): void {
  const body = JSON.stringify({ error: { code, message } });
  socket.write(
    `HTTP/1.1 ${status} ${UPGRADE_STATUS_TEXT[status] ?? 'Error'}\r\n` +
      'Content-Type: application/json\r\n' +
      `Content-Length: ${Buffer.byteLength(body)}\r\n` +
      'Connection: close\r\n\r\n' +
      body,
  );
  socket.destroy();
}

function header(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

export async function authenticateAgentUpgrade(
  req: IncomingMessage,
): Promise<AgentConnectionContext> {
  const origin = header(req.headers.origin);
  if (origin && !isOriginAllowed(origin)) {
    throw Object.assign(new Error('Origin not allowed'), { status: 403, code: 'ORIGIN_NOT_ALLOWED' });
  }

  const authorization = header(req.headers.authorization);
  const match = authorization ? /^Bearer\s+(.+)$/i.exec(authorization.trim()) : null;
  if (!match?.[1]) {
    throw Object.assign(new Error('Authentication required'), { status: 401, code: 'UNAUTHENTICATED' });
  }

  const agentId = header(req.headers['x-agent-id']);
  const agentKey = header(req.headers['x-agent-key']);
  if (!agentId || !agentKey) {
    throw Object.assign(new Error('Agent credentials are required'), {
      status: 401,
      code: 'AGENT_AUTH_REQUIRED',
    });
  }

  const session = await Session.findOne({
    where: {
      accessTokenHash: hashOpaqueToken(match[1], config.auth.tokenPepper),
      revokedAt: null,
    },
    include: [{ model: User, as: 'user', required: true }],
  });

  if (!session?.user) {
    throw Object.assign(new Error('Invalid access token'), { status: 401, code: 'AUTH_TOKEN_INVALID' });
  }
  if (session.accessExpiresAt.getTime() <= Date.now()) {
    throw Object.assign(new Error('Access token expired'), { status: 401, code: 'AUTH_TOKEN_EXPIRED' });
  }
  if (session.user.status !== 'ACTIVE') {
    throw Object.assign(new Error('Account disabled'), { status: 403, code: 'ACCOUNT_DISABLED' });
  }

  const agent = await DesktopAgent.findByPk(agentId);
  if (!agent) {
    throw Object.assign(new Error('Agent credentials are invalid'), {
      status: 401,
      code: 'AGENT_CREDENTIALS_INVALID',
    });
  }
  if (
    !safeEqualStrings(
      agent.agentKeyHash,
      hashOpaqueToken(agentKey, config.auth.tokenPepper),
    )
  ) {
    throw Object.assign(new Error('Agent credentials are invalid'), {
      status: 401,
      code: 'AGENT_CREDENTIALS_INVALID',
    });
  }
  if (agent.userId !== session.userId) {
    throw Object.assign(new Error('Agent does not belong to this user'), {
      status: 403,
      code: 'AGENT_CONTEXT_MISMATCH',
    });
  }
  if (agent.revokedAt) {
    throw Object.assign(new Error('Agent revoked'), { status: 403, code: 'AGENT_REVOKED' });
  }

  const membership = await Membership.findOne({
    where: { organizationId: agent.organizationId, userId: session.userId },
    include: [{ model: Organization, as: 'organization', required: true }],
  });
  if (!membership || membership.status !== 'ACTIVE') {
    throw Object.assign(new Error('Membership is not active'), {
      status: 403,
      code: 'MEMBERSHIP_INACTIVE',
    });
  }
  if (!membership.organization) {
    throw Object.assign(new Error('Organization not found'), { status: 403, code: 'ORGANIZATION_NOT_FOUND' });
  }
  if (membership.organization.deletedAt || membership.organization.status !== 'ACTIVE') {
    throw Object.assign(new Error('Organization is suspended'), {
      status: 403,
      code: 'ORGANIZATION_SUSPENDED',
    });
  }

  return {
    user: session.user,
    session,
    membership,
    organization: membership.organization,
    agent,
    isAlive: true,
  };
}

async function loadActiveSession(context: ConnectionContext): Promise<TimeSessionModel | null> {
  return TimeSession.findOne({
    where: {
      organizationId: context.organization.id,
      employeeId: context.user.id,
      desktopAgentId: context.agent.id,
      endedAt: null,
    },
    include: [{ model: Break, as: 'breaks', required: false }],
  });
}

function stateFor(session: TimeSessionModel | null, now = new Date()) {
  if (session && isHeartbeatFresh(session.lastHeartbeatAt, now)) {
    return session.status === 'ON_BREAK' ? ('ON_BREAK' as const) : ('WORKING' as const);
  }
  return 'ONLINE' as const;
}

function send(ws: WebSocket, payload: Record<string, unknown>): void {
  if (ws.readyState !== WebSocket.OPEN) return;
  try {
    ws.send(JSON.stringify(payload));
  } catch (error) {
    logger.warn({ err: error }, 'failed to send WebSocket message');
  }
}

async function handleScreenshotMessage(
  ws: WebSocket,
  context: ConnectionContext,
  message: AgentMessage,
): Promise<void> {
  const requestId = message.requestId;
  if (typeof requestId !== 'string' || !UUID_PATTERN.test(requestId)) {
    send(ws, {
      type: 'screenshot.error',
      code: 'INVALID_SCREENSHOT_REQUEST_ID',
      message: 'A valid screenshot requestId is required',
    });
    return;
  }

  const common = {
    organizationId: context.organization.id,
    requestId,
    employeeId: context.user.id,
    agentId: context.agent.id,
  };

  try {
    switch (message.type) {
      case 'screenshot.ack': {
        const result = await acknowledgeScreenshotRequest(common);
        send(ws, {
          type: 'screenshot.acknowledged',
          ...result,
          serverTime: new Date().toISOString(),
        });
        return;
      }
      case 'screenshot.claim': {
        const result = await claimScreenshotRequest({
          ...common,
          contentType: typeof message.contentType === 'string' ? message.contentType : undefined,
        });
        send(ws, {
          type: 'screenshot.claimed',
          ...result,
          serverTime: new Date().toISOString(),
        });
        return;
      }
      case 'screenshot.complete': {
        const screenshot = await completeScreenshotRequest({
          ...common,
          captureTimestamp:
            typeof message.captureTimestamp === 'string' ? message.captureTimestamp : undefined,
        });
        send(ws, {
          type: 'screenshot.completed',
          requestId,
          screenshot,
          serverTime: new Date().toISOString(),
        });
        return;
      }
      case 'screenshot.fail': {
        const request = await failScreenshotRequest({
          ...common,
          code: typeof message.code === 'string' ? message.code : '',
          message: typeof message.message === 'string' ? message.message : undefined,
        });
        send(ws, {
          type: 'screenshot.failed',
          requestId,
          request,
          serverTime: new Date().toISOString(),
        });
        return;
      }
      default:
        return;
    }
  } catch (error) {
    if (error instanceof AppError) {
      send(ws, {
        type: 'screenshot.error',
        requestId,
        code: error.code,
        message: error.message,
      });
      return;
    }
    throw error;
  }
}

async function handleScreenLiveMessage(
  ws: WebSocket,
  context: ConnectionContext,
  message: AgentMessage,
): Promise<void> {
  const liveSessionId = message.liveSessionId;
  if (typeof liveSessionId !== 'string' || !UUID_PATTERN.test(liveSessionId)) {
    send(ws, {
      type: 'screen.live.error',
      code: 'INVALID_LIVE_SESSION_ID',
      message: 'A valid liveSessionId is required',
    });
    return;
  }

  try {
    const result = await failScreenLiveSession({
      organizationId: context.organization.id,
      sessionId: liveSessionId,
      employeeId: context.user.id,
      agentId: context.agent.id,
      code: typeof message.code === 'string' ? message.code : '',
      message: typeof message.message === 'string' ? message.message : undefined,
    });
    send(ws, {
      type: 'screen.live.failed',
      liveSessionId,
      session: result,
      serverTime: new Date().toISOString(),
    });
  } catch (error) {
    if (error instanceof AppError) {
      send(ws, {
        type: 'screen.live.error',
        liveSessionId,
        code: error.code,
        message: error.message,
      });
      return;
    }
    throw error;
  }
}

function setupConnection(ws: WebSocket, context: ConnectionContext): void {
  const now = new Date();
  agentHub.add({
    ws,
    organizationId: context.organization.id,
    userId: context.user.id,
    agentId: context.agent.id,
  });

  void Promise.all([
    context.agent.update({ lastConnectedAt: now, lastSeenAt: now }),
    context.session.update({ lastUsedAt: now }),
  ]).catch((error) => logger.warn({ err: error }, 'failed to persist WebSocket connection'));

  void Promise.all([
    loadActiveSession(context),
    getPendingScreenshotRequestsForAgent(context.organization.id, context.agent).catch((error) => {
      logger.warn({ err: error }, 'failed to load pending screenshot requests');
      return [];
    }),
    getPendingScreenLiveSessionForAgent(context.organization.id, context.agent).catch((error) => {
      logger.warn({ err: error }, 'failed to load pending live screen session');
      return null;
    }),
  ])
    .then(([session, pendingScreenshotRequests, pendingScreenLiveSession]) => {
      send(ws, {
        type: 'connected',
        serverTime: now.toISOString(),
        user: { id: context.user.id, name: context.user.name, email: context.user.email },
        organization: {
          id: context.organization.id,
          name: context.organization.name,
          timezone: context.organization.timezone,
        },
        agent: { id: context.agent.id, name: context.agent.name },
        state: stateFor(session, now),
        session: session ? toTimeSessionSummary(session, now) : null,
        pendingScreenshotRequests,
        pendingScreenLiveSession,
        heartbeatIntervalSeconds: Math.max(15, Math.floor(config.timeTracking.heartbeatStaleSeconds / 2)),
        heartbeatStaleAfterSeconds: config.timeTracking.heartbeatStaleSeconds,
      });
    })
    .catch((error) => logger.error({ err: error }, 'failed to load session for WebSocket connection'));

  ws.on('pong', () => {
    context.isAlive = true;
  });

  ws.on('message', (raw: RawData, isBinary: boolean) => {
    void (async () => {
      if (isBinary) {
        send(ws, { type: 'error', code: 'INVALID_MESSAGE', message: 'Binary messages are not supported' });
        return;
      }

      if (context.session.accessExpiresAt.getTime() <= Date.now()) {
        ws.close(4001, 'AUTH_EXPIRED');
        return;
      }

      let message: AgentMessage;
      try {
        message = JSON.parse(raw.toString()) as AgentMessage;
      } catch {
        send(ws, { type: 'error', code: 'INVALID_JSON', message: 'Message must be valid JSON' });
        return;
      }

      if (typeof message.type !== 'string') {
        send(ws, { type: 'error', code: 'INVALID_MESSAGE', message: 'Message type is required' });
        return;
      }

      if (message.type === 'ping') {
        send(ws, { type: 'pong', serverTime: new Date().toISOString() });
        return;
      }

      if (
        message.type !== 'heartbeat' &&
        message.type !== 'session.status' &&
        !SCREENSHOT_MESSAGE_TYPES.has(message.type) &&
        !SCREEN_LIVE_MESSAGE_TYPES.has(message.type)
      ) {
        send(ws, {
          type: 'error',
          code: 'UNKNOWN_MESSAGE_TYPE',
          message: `Unsupported message type: ${message.type}`,
        });
        return;
      }

      // Re-check durable authorization on every heartbeat/status request so a
      // suspended membership or a revoked/rotated agent loses access promptly.
      const [authSession, agent, membership, organization] = await Promise.all([
        Session.findByPk(context.session.id, {
          include: [{ model: User, as: 'user', required: true }],
        }),
        DesktopAgent.findByPk(context.agent.id),
        Membership.findOne({
          where: { organizationId: context.organization.id, userId: context.user.id },
        }),
        Organization.findByPk(context.organization.id),
      ]);

      if (!authSession || authSession.revokedAt || authSession.accessExpiresAt.getTime() <= Date.now()) {
        ws.close(4001, 'AUTH_EXPIRED');
        return;
      }
      context.session = authSession;

      if (!authSession.user || authSession.user.status !== 'ACTIVE') {
        ws.close(4003, 'ACCOUNT_DISABLED');
        return;
      }
      if (!agent || agent.revokedAt) {
        ws.close(4003, 'AGENT_REVOKED');
        return;
      }
      if (!membership || membership.status !== 'ACTIVE') {
        ws.close(4003, 'MEMBERSHIP_INACTIVE');
        return;
      }
      if (!organization || organization.deletedAt || organization.status !== 'ACTIVE') {
        ws.close(4003, 'ORGANIZATION_SUSPENDED');
        return;
      }

      const heartbeatAt = new Date();
      context.agent = agent;
      context.membership = membership;
      context.organization = organization;

      if (SCREENSHOT_MESSAGE_TYPES.has(message.type)) {
        await handleScreenshotMessage(ws, context, message);
        return;
      }

      if (SCREEN_LIVE_MESSAGE_TYPES.has(message.type)) {
        await handleScreenLiveMessage(ws, context, message);
        return;
      }

      let session: TimeSessionModel | null;
      if (typeof message.sessionId === 'string') {
        session = await TimeSession.findOne({
          where: {
            id: message.sessionId,
            organizationId: context.organization.id,
            employeeId: context.user.id,
            desktopAgentId: agent.id,
            endedAt: null,
          },
          include: [{ model: Break, as: 'breaks', required: false }],
        });
      } else if (message.type === 'heartbeat') {
        session = await loadActiveSession(context);
      } else {
        session = await loadActiveSession(context);
      }

      if (message.type === 'heartbeat') {
        if (session) await session.update({ lastHeartbeatAt: heartbeatAt });
        await agent.update({ lastSeenAt: heartbeatAt });

        send(ws, {
          type: 'heartbeat.ack',
          serverTime: heartbeatAt.toISOString(),
          state: stateFor(session, heartbeatAt),
          session: session ? toTimeSessionSummary(session, heartbeatAt) : null,
          nextHeartbeatInSeconds: Math.max(
            15,
            Math.floor(config.timeTracking.heartbeatStaleSeconds / 2),
          ),
        });
        return;
      }

      send(ws, {
        type: 'session.status',
        serverTime: heartbeatAt.toISOString(),
        state: stateFor(session, heartbeatAt),
        session: session ? toTimeSessionSummary(session, heartbeatAt) : null,
      });
    })().catch((error) => {
      logger.error({ err: error }, 'WebSocket message handling failed');
      send(ws, { type: 'error', code: 'INTERNAL_ERROR', message: 'Message handling failed' });
    });
  });

  ws.on('close', () => {
    const remaining = agentHub.countForAgent(context.agent.id) - 1;
    agentHub.remove(ws);
    if (remaining <= 0) {
      void context.agent
        .update({ lastDisconnectedAt: new Date() })
        .catch((error) => logger.warn({ err: error }, 'failed to persist WebSocket disconnect'));
    }
  });

  ws.on('error', (error) => {
    logger.debug({ err: error }, 'WebSocket transport error');
  });
}

/**
 * Attaches the authenticated agent WebSocket endpoint to an existing HTTP
 * server. Presence is durable in the database; only live sockets are held
 * in memory. Reconnect with a fresh access token and the same agent key.
 */
export function attachAgentWebSocketServer(server: HttpServer): WebSocketServer {
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: config.timeTracking.wsMaxPayloadBytes,
  });
  const contexts = new Map<WebSocket, ConnectionContext>();

  server.on('upgrade', (req, socket, head) => {
    let pathname: string;
    try {
      pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
    } catch {
      socket.destroy();
      return;
    }

    // Other realtime endpoints have their own upgrade listeners. Ignore
    // unmatched paths instead of destroying the socket.
    if (pathname !== WS_PATH) {
      return;
    }

    void authenticateAgentUpgrade(req)
      .then((context) => {
        wss.handleUpgrade(req, socket, head, (ws) => {
          contexts.set(ws, context);
          setupConnection(ws, context);
          ws.on('close', () => contexts.delete(ws));
        });
      })
      .catch((error: unknown) => {
        const status = (error as { status?: number }).status ?? 401;
        const code = (error as { code?: string }).code ?? 'UNAUTHENTICATED';
        const message = error instanceof Error ? error.message : 'Authentication failed';
        rejectUpgrade(socket, status, code, message);
      });
  });

  const sweep = setInterval(() => {
    const now = Date.now();
    for (const ws of wss.clients) {
      const context = contexts.get(ws);
      if (!context) continue;

      if (context.session.accessExpiresAt.getTime() <= now) {
        ws.close(4001, 'AUTH_EXPIRED');
        continue;
      }

      if (!context.isAlive) {
        ws.terminate();
        continue;
      }

      context.isAlive = false;
      try {
        ws.ping();
      } catch {
        ws.terminate();
      }
    }
  }, config.timeTracking.wsSweepIntervalMs);
  sweep.unref();

  wss.on('close', () => {
    clearInterval(sweep);
    contexts.clear();
  });

  return wss;
}
