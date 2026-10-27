import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocket, WebSocketServer } from 'ws';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { AuditEvent, ScreenLiveSession, ScreenLiveViewer, TimeSession, User } from '../src/database';
import { agentHub } from '../src/realtime/agentHub';
import { attachAgentWebSocketServer } from '../src/realtime/agentWebSocket';
import { attachScreenLiveRelay, type ScreenLiveRelay } from '../src/realtime/screenLiveRelay';
import { canScreenLiveViewerContinue } from '../src/modules/screenshots/screenLive.service';
import {
  API,
  app,
  createOwner,
  desktopAuth,
  inviteAndAccept,
  registerAgent,
  resetDatabase,
  uniqueEmail,
} from './helpers';

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 0x33)]);

let server: HttpServer;
let agentWss: WebSocketServer;
let relay: ScreenLiveRelay;
let port: number;
const clients = new Set<WebSocket>();

type Incoming = { data: Buffer; binary: boolean };
type Waiter = {
  predicate: (message: Incoming) => boolean;
  resolve: (message: Incoming) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
};

function openSocket(path: string, headers: Record<string, string> = {}) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`, { headers, origin: undefined });
  clients.add(ws);
  const messages: Incoming[] = [];
  const waiters: Waiter[] = [];
  let closeInfo: { code: number; reason: string } | null = null;
  const closeWaiters: Array<(value: { code: number; reason: string }) => void> = [];

  ws.on('message', (raw, isBinary) => {
    const message = { data: Buffer.isBuffer(raw) ? raw : Buffer.from(raw as ArrayBuffer), binary: isBinary };
    const index = waiters.findIndex((waiter) => waiter.predicate(message));
    if (index >= 0) {
      const waiter = waiters.splice(index, 1)[0]!;
      clearTimeout(waiter.timer);
      waiter.resolve(message);
    } else {
      messages.push(message);
    }
  });
  ws.on('close', (code, reason) => {
    closeInfo = { code, reason: reason.toString() };
    while (closeWaiters.length) closeWaiters.shift()!(closeInfo);
  });
  ws.on('error', () => undefined);

  const opened = new Promise<void>((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });

  function next(predicate: (message: Incoming) => boolean, timeoutMs = 4_000): Promise<Incoming> {
    const index = messages.findIndex(predicate);
    if (index >= 0) return Promise.resolve(messages.splice(index, 1)[0]!);
    const callSite = new Error().stack?.split('\n').slice(2, 5).join(' <- ');
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const waiterIndex = waiters.findIndex((waiter) => waiter.timer === timer);
        if (waiterIndex >= 0) waiters.splice(waiterIndex, 1);
        reject(
          new Error(
            `Timed out waiting for WebSocket data. Queued: ${messages
              .map((message) => (message.binary ? '<binary>' : message.data.toString()))
              .join(' | ')} (at ${callSite})`,
          ),
        );
      }, timeoutMs);
      waiters.push({ predicate, resolve, reject, timer });
    });
  }

  const nextJson = (predicate: (message: Record<string, any>) => boolean, timeoutMs?: number) =>
    next((message) => {
      if (message.binary) return false;
      try {
        return predicate(JSON.parse(message.data.toString()));
      } catch {
        return false;
      }
    }, timeoutMs).then((message) => JSON.parse(message.data.toString()) as Record<string, any>);

  const closed = () =>
    closeInfo
      ? Promise.resolve(closeInfo)
      : new Promise<{ code: number; reason: string }>((resolve) => closeWaiters.push(resolve));

  async function close(): Promise<void> {
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
      ws.close(1000, 'test complete');
    }
    await closed().catch(() => undefined);
  }

  return { ws, opened, next, nextJson, closed, close };
}

async function createTeam(options: { clientType?: 'ELECTRON' | 'MOBILE' } = {}) {
  const owner = await createOwner(uniqueEmail('live-owner'), 'Live Screen Org');
  const ownerAuth = await desktopAuth(owner.email);
  const employee = await inviteAndAccept(owner, {
    role: 'EMPLOYEE',
    name: 'Live Employee',
    email: uniqueEmail('live-employee'),
  });
  const employeeAuth = await desktopAuth(employee.email);
  const agent = await registerAgent(employeeAuth, owner.organization.id, {
    name: 'Live Desktop',
    clientType: options.clientType,
  });
  const started = await request(app)
    .post(`${API}/organizations/${owner.organization.id}/time-sessions/start`)
    .set(agent.headers)
    .send({});
  if (started.status !== 201) throw new Error(JSON.stringify(started.body));
  return {
    owner,
    ownerAuth,
    employee,
    employeeAuth,
    agent,
    orgId: owner.organization.id as string,
    sessionId: started.body.data.session.id as string,
  };
}

async function enablePolicy(ownerAuth: { headers: Record<string, string> }, orgId: string) {
  const response = await request(app)
    .patch(`${API}/admin/screenshot-policy`)
    .set({ ...ownerAuth.headers, 'x-organization-id': orgId })
    .send({
      enabled: true,
      requestRoles: ['OWNER', 'ADMIN'],
      viewRoles: ['OWNER', 'ADMIN'],
      retentionDays: 1,
      auditRetentionDays: 30,
      disclosureVersion: 'v1',
      disclosureText: 'Authorized administrators may view an active desktop session live.',
    });
  expect(response.status).toBe(200);
}

function startLive(
  auth: { headers: Record<string, string> },
  orgId: string,
  employeeId: string,
) {
  return request(app)
    .post(`${API}/admin/employees/${employeeId}/screen-live-sessions`)
    .set({ ...auth.headers, 'x-organization-id': orgId })
    .send({});
}

function ticket(
  auth: { headers: Record<string, string> },
  orgId: string,
  liveSessionId: string,
) {
  return request(app)
    .post(`${API}/admin/screen-live-sessions/${liveSessionId}/viewer-tickets`)
    .set({ ...auth.headers, 'x-organization-id': orgId })
    .send({});
}

function stopLive(
  auth: { headers: Record<string, string> },
  orgId: string,
  liveSessionId: string,
) {
  return request(app)
    .post(`${API}/admin/screen-live-sessions/${liveSessionId}/stop`)
    .set({ ...auth.headers, 'x-organization-id': orgId })
    .send({});
}

async function connectViewer(viewerTicket: string, sendTicket = true) {
  const viewer = openSocket(`${API}/ws/screen-live`);
  await viewer.opened;
  if (sendTicket) {
    viewer.ws.send(JSON.stringify({ type: 'authenticate', ticket: viewerTicket }));
  }
  return viewer;
}

async function authenticateAndExpectFailure(viewerTicket: string) {
  const viewer = await connectViewer(viewerTicket);
  const error = await viewer.nextJson((message) => message.type === 'live.error');
  const close = await viewer.closed();
  await viewer.close();
  return { viewer, error, close };
}

describe('admin live screen viewing', () => {
  beforeAll(async () => {
    server = createServer(createApp());
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    agentWss = attachAgentWebSocketServer(server);
    relay = attachScreenLiveRelay(server, { viewerHandshakeTimeoutMs: 400 });
    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await relay.close();
    agentHub.closeAll(1001, 'tests complete');
    for (const ws of clients) ws.terminate();
    await new Promise<void>((resolve) => agentWss.close(() => resolve()));
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  beforeEach(async () => {
    agentHub.closeAll(1001, 'test reset');
    for (const ws of clients) ws.terminate();
    clients.clear();
    await new Promise((resolve) => setTimeout(resolve, 20));
    await resetDatabase();
  });

  afterEach(async () => {
    agentHub.closeAll(1001, 'test finished');
    for (const ws of clients) ws.terminate();
    clients.clear();
    await new Promise((resolve) => setTimeout(resolve, 20));
  });

  it('fails closed when the policy is disabled or the role is not live-capable', async () => {
    const team = await createTeam();

    const disabled = await startLive(team.ownerAuth, team.orgId, team.employee.user.id);
    expect(disabled.status).toBe(403);
    expect(disabled.body.error.code).toBe('SCREEN_LIVE_POLICY_DISABLED');

    await enablePolicy(team.ownerAuth, team.orgId);
    const managerAuth = await desktopAuth(
      (
        await inviteAndAccept(team.owner, {
          role: 'MANAGER',
          name: 'Live Manager',
          email: uniqueEmail('live-manager'),
        })
      ).email,
    );
    const denied = await startLive(managerAuth, team.orgId, team.employee.user.id);
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe('PERMISSION_DENIED');
  });

  it('rejects employees without an eligible session and mobile-only agents', async () => {
    const team = await createTeam();
    await enablePolicy(team.ownerAuth, team.orgId);

    await TimeSession.update({ status: 'ENDED', endedAt: new Date() }, { where: { id: team.sessionId } });
    const noSession = await startLive(team.ownerAuth, team.orgId, team.employee.user.id);
    expect(noSession.status).toBe(409);
    expect(noSession.body.error.code).toBe('NO_ELIGIBLE_SCREEN_LIVE_SESSION');

    const mobile = await createTeam({ clientType: 'MOBILE' });
    await enablePolicy(mobile.ownerAuth, mobile.orgId);
    const mobileStart = await startLive(mobile.ownerAuth, mobile.orgId, mobile.employee.user.id);
    expect(mobileStart.status).toBe(409);
    expect(mobileStart.body.error.code).toBe('INVALID_SCREEN_LIVE_AGENT');
  });

  it('relays JPEG frames to an authorized viewer and stops on viewer request', async () => {
    const team = await createTeam();
    await enablePolicy(team.ownerAuth, team.orgId);

    const agentSocket = openSocket(`${API}/ws/agent`, team.agent.headers);
    await agentSocket.opened;
    await agentSocket.nextJson((message) => message.type === 'connected');

    const started = await startLive(team.ownerAuth, team.orgId, team.employee.user.id);
    expect(started.status).toBe(201);
    expect(started.body.data.delivery.delivered).toBe(true);
    const liveSessionId = started.body.data.session.id as string;

    const command = await agentSocket.nextJson(
      (message) => message.type === 'screen.live.start' && message.liveSessionId === liveSessionId,
    );
    expect(command.streamPath).toBe(`${API}/ws/screen-stream`);
    expect(command.maxFps).toBeGreaterThanOrEqual(1);

    const reused = await startLive(team.ownerAuth, team.orgId, team.employee.user.id);
    expect(reused.status).toBe(200);
    expect(reused.body.data.reused).toBe(true);
    expect(reused.body.data.session.id).toBe(liveSessionId);

    const issued = await ticket(team.ownerAuth, team.orgId, liveSessionId);
    expect(issued.status).toBe(201);
    const viewerTicket = issued.body.data.ticket as string;
    expect(issued.body.data.websocketPath).toBe(`${API}/ws/screen-live`);

    const viewer = await connectViewer(viewerTicket);
    const viewerReady = await viewer.nextJson((message) => message.type === 'live.ready');
    expect(viewerReady.session.id).toBe(liveSessionId);

    const stream = openSocket(
      `${API}/ws/screen-stream?liveSessionId=${liveSessionId}`,
      team.agent.headers,
    );
    await stream.opened;
    const streamReady = await stream.nextJson((message) => message.type === 'live.ready');
    expect(streamReady.liveSessionId).toBe(liveSessionId);
    expect(streamReady.maxFrameBytes).toBeGreaterThanOrEqual(JPEG.length);

    stream.ws.send(JPEG);
    const startedFrame = await viewer.nextJson((message) => message.type === 'live.started');
    expect(startedFrame.serverTime).toBeTruthy();
    const frame = await viewer.next((message) => message.binary);
    expect(frame.data.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
    expect(frame.data).toEqual(JPEG);

    const stopped = await stopLive(team.ownerAuth, team.orgId, liveSessionId);
    expect(stopped.status).toBe(200);
    expect(stopped.body.data.stopped).toBe(true);

    const stopCommand = await stream.nextJson((message) => message.type === 'live.stop');
    expect(stopCommand.reason).toBe('VIEWER_STOPPED');

    const ended = await viewer.nextJson(
      (message) => message.type === 'live.ended' && message.reason === 'VIEWER_STOPPED',
    );
    expect(ended.reason).toBe('VIEWER_STOPPED');
    expect((await viewer.closed()).code).toBe(4000);

    const record = await ScreenLiveSession.findByPk(liveSessionId);
    expect(record?.status).toBe('ENDED');
    expect(record?.terminationReason).toBe('VIEWER_STOPPED');
    const viewerRow = await ScreenLiveViewer.findOne({ where: { screenLiveSessionId: liveSessionId } });
    expect(viewerRow?.leftAt).not.toBeNull();

    await agentSocket.close();
    await stream.close();
    await viewer.close();
  });

  it('closes a viewer that sends stop without ending the shared session', async () => {
    const team = await createTeam();
    await enablePolicy(team.ownerAuth, team.orgId);
    const started = await startLive(team.ownerAuth, team.orgId, team.employee.user.id);
    const liveSessionId = started.body.data.session.id as string;
    const issued = await ticket(team.ownerAuth, team.orgId, liveSessionId);
    const viewer = await connectViewer(issued.body.data.ticket as string);
    await viewer.nextJson((message) => message.type === 'live.ready');

    viewer.ws.send(JSON.stringify({ type: 'stop' }));
    expect((await viewer.closed()).code).toBe(1000);

    const record = await ScreenLiveSession.findByPk(liveSessionId);
    expect(record?.status).toBe('ACTIVE');
    const viewerRow = await ScreenLiveViewer.findOne({ where: { screenLiveSessionId: liveSessionId } });
    expect(viewerRow?.leftAt).not.toBeNull();

    await stopLive(team.ownerAuth, team.orgId, liveSessionId);
  });

  it('consumes tickets exactly once', async () => {
    const team = await createTeam();
    await enablePolicy(team.ownerAuth, team.orgId);
    const started = await startLive(team.ownerAuth, team.orgId, team.employee.user.id);
    const liveSessionId = started.body.data.session.id as string;
    const issued = await ticket(team.ownerAuth, team.orgId, liveSessionId);
    const viewerTicket = issued.body.data.ticket as string;

    const first = await connectViewer(viewerTicket);
    await first.nextJson((message) => message.type === 'live.ready');

    const replay = await authenticateAndExpectFailure(viewerTicket);
    expect(replay.error.code).toBe('SCREEN_LIVE_TICKET_INVALID');
    expect(replay.close.code).toBe(4001);

    await stopLive(team.ownerAuth, team.orgId, liveSessionId);
    await first.close();
  });

  it('ends the session when the agent reports a capture failure', async () => {
    const team = await createTeam();
    await enablePolicy(team.ownerAuth, team.orgId);

    const agentSocket = openSocket(`${API}/ws/agent`, team.agent.headers);
    await agentSocket.opened;
    await agentSocket.nextJson((message) => message.type === 'connected');

    const started = await startLive(team.ownerAuth, team.orgId, team.employee.user.id);
    const liveSessionId = started.body.data.session.id as string;
    await agentSocket.nextJson((message) => message.type === 'screen.live.start');

    agentSocket.ws.send(
      JSON.stringify({
        type: 'screen.live.failed',
        liveSessionId,
        code: 'OS_PERMISSION_DENIED',
        message: 'Screen recording permission was denied',
      }),
    );
    const failed = await agentSocket.nextJson(
      (message) => message.type === 'screen.live.failed' && message.liveSessionId === liveSessionId,
    );
    expect(failed.session.terminationReason).toBe('AGENT_FAILED');

    const record = await ScreenLiveSession.findByPk(liveSessionId);
    expect(record?.status).toBe('ENDED');
    expect(record?.terminationReason).toBe('AGENT_FAILED');
    const audit = await AuditEvent.findOne({
      where: { action: 'SCREEN_LIVE_SESSION_STOPPED', entityId: liveSessionId },
    });
    expect(audit?.metadata).toMatchObject({
      reason: 'AGENT_FAILED',
      failureCode: 'OS_PERMISSION_DENIED',
    });

    await agentSocket.close();
  });

  it('stops sessions idempotently and enforces organization scope', async () => {
    const team = await createTeam();
    await enablePolicy(team.ownerAuth, team.orgId);
    const started = await startLive(team.ownerAuth, team.orgId, team.employee.user.id);
    const liveSessionId = started.body.data.session.id as string;

    const other = await createOwner(uniqueEmail('live-other'), 'Other Org');
    const otherAuth = await desktopAuth(other.email);
    const crossTicket = await request(app)
      .post(`${API}/admin/screen-live-sessions/${liveSessionId}/viewer-tickets`)
      .set({ ...otherAuth.headers, 'x-organization-id': other.organization.id })
      .send({});
    expect(crossTicket.status).toBe(404);
    expect(crossTicket.body.error.code).toBe('SCREEN_LIVE_SESSION_NOT_FOUND');

    const stopped = await stopLive(team.ownerAuth, team.orgId, liveSessionId);
    expect(stopped.status).toBe(200);
    expect(stopped.body.data.stopped).toBe(true);
    expect(stopped.body.data.session.terminationReason).toBe('VIEWER_STOPPED');

    const again = await stopLive(team.ownerAuth, team.orgId, liveSessionId);
    expect(again.status).toBe(200);
    expect(again.body.data.stopped).toBe(false);

    const crossTenant = await request(app)
      .post(`${API}/admin/screen-live-sessions/${liveSessionId}/stop`)
      .set({ ...otherAuth.headers, 'x-organization-id': other.organization.id })
      .send({});
    expect(crossTenant.status).toBe(404);
    expect(crossTenant.body.error.code).toBe('SCREEN_LIVE_SESSION_NOT_FOUND');
  });

  it('rejects invalid and expired tickets without joining', async () => {
    const team = await createTeam();
    await enablePolicy(team.ownerAuth, team.orgId);
    const started = await startLive(team.ownerAuth, team.orgId, team.employee.user.id);
    const liveSessionId = started.body.data.session.id as string;

    const invalid = await authenticateAndExpectFailure('A'.repeat(30));
    expect(invalid.error.code).toBe('SCREEN_LIVE_TICKET_INVALID');
    expect(invalid.close.code).toBe(4001);

    const issued = await ticket(team.ownerAuth, team.orgId, liveSessionId);
    await ScreenLiveViewer.update(
      { ticketExpiresAt: new Date(Date.now() - 1_000) },
      { where: { screenLiveSessionId: liveSessionId } },
    );
    const expired = await authenticateAndExpectFailure(issued.body.data.ticket as string);
    expect(expired.error.code).toBe('SCREEN_LIVE_TICKET_EXPIRED');
    expect(expired.close.code).toBe(4001);

    const viewerRow = await ScreenLiveViewer.findOne({
      where: { screenLiveSessionId: liveSessionId },
    });
    expect(viewerRow?.joinedAt).toBeNull();
    expect(viewerRow?.ticketHash).not.toBeNull();

    await stopLive(team.ownerAuth, team.orgId, liveSessionId);
  });

  it('times out silent handshakes and rejects binary data before authentication', async () => {
    const silent = await connectViewer('', false);
    const timeout = await silent.nextJson((message) => message.type === 'live.error');
    expect(timeout.code).toBe('SCREEN_LIVE_AUTH_TIMEOUT');
    expect((await silent.closed()).code).toBe(4001);
    await silent.close();

    const binary = openSocket(`${API}/ws/screen-live`);
    await binary.opened;
    binary.ws.send(JPEG);
    const denied = await binary.nextJson((message) => message.type === 'live.error');
    expect(denied.code).toBe('SCREEN_LIVE_AUTH_REQUIRED');
    expect((await binary.closed()).code).toBe(4001);
    await binary.close();
  });

  it('re-checks policy roles when a ticket is consumed', async () => {
    const team = await createTeam();
    await enablePolicy(team.ownerAuth, team.orgId);
    const started = await startLive(team.ownerAuth, team.orgId, team.employee.user.id);
    const liveSessionId = started.body.data.session.id as string;
    const issued = await ticket(team.ownerAuth, team.orgId, liveSessionId);

    const narrowed = await request(app)
      .patch(`${API}/admin/screenshot-policy`)
      .set({ ...team.ownerAuth.headers, 'x-organization-id': team.orgId })
      .send({ requestRoles: ['ADMIN'], viewRoles: ['ADMIN'] });
    expect(narrowed.status).toBe(200);

    const denied = await authenticateAndExpectFailure(issued.body.data.ticket as string);
    expect(denied.error.code).toBe('SCREEN_LIVE_ROLE_NOT_ALLOWED');
    expect(denied.close.code).toBe(4001);

    await stopLive(team.ownerAuth, team.orgId, liveSessionId);
  });

  it('drops an already connected viewer when the account is disabled', async () => {
    const team = await createTeam();
    await enablePolicy(team.ownerAuth, team.orgId);
    const started = await startLive(team.ownerAuth, team.orgId, team.employee.user.id);
    const liveSessionId = started.body.data.session.id as string;
    const issued = await ticket(team.ownerAuth, team.orgId, liveSessionId);
    const viewer = await connectViewer(issued.body.data.ticket as string);
    const ready = await viewer.nextJson((message) => message.type === 'live.ready');
    const viewerId = ready.viewer.id as string;

    expect(await canScreenLiveViewerContinue(viewerId)).toBe(true);
    await User.update({ status: 'DISABLED' }, { where: { email: team.owner.email } });
    expect(await canScreenLiveViewerContinue(viewerId)).toBe(false);

    await User.update({ status: 'ACTIVE' }, { where: { email: team.owner.email } });
    await stopLive(team.ownerAuth, team.orgId, liveSessionId);
  });

  it('stops active capture when monitoring is disabled', async () => {
    const team = await createTeam();
    await enablePolicy(team.ownerAuth, team.orgId);
    const started = await startLive(team.ownerAuth, team.orgId, team.employee.user.id);
    const liveSessionId = started.body.data.session.id as string;
    const issued = await ticket(team.ownerAuth, team.orgId, liveSessionId);
    const viewer = await connectViewer(issued.body.data.ticket as string);
    await viewer.nextJson((message) => message.type === 'live.ready');

    const disabled = await request(app)
      .patch(`${API}/admin/screenshot-policy`)
      .set({ ...team.ownerAuth.headers, 'x-organization-id': team.orgId })
      .send({ enabled: false });
    expect(disabled.status).toBe(200);

    const ended = await viewer.nextJson((message) => message.type === 'live.ended');
    expect(ended.reason).toBe('POLICY_DISABLED');
    expect((await viewer.closed()).code).toBe(4000);

    const record = await ScreenLiveSession.findByPk(liveSessionId);
    expect(record?.status).toBe('ENDED');
    expect(record?.terminationReason).toBe('POLICY_DISABLED');
  });

  it('stops capture when the desktop agent is revoked', async () => {
    const team = await createTeam();
    await enablePolicy(team.ownerAuth, team.orgId);
    const started = await startLive(team.ownerAuth, team.orgId, team.employee.user.id);
    const liveSessionId = started.body.data.session.id as string;
    const issued = await ticket(team.ownerAuth, team.orgId, liveSessionId);
    const viewer = await connectViewer(issued.body.data.ticket as string);
    await viewer.nextJson((message) => message.type === 'live.ready');

    const revoked = await request(app)
      .delete(`${API}/organizations/${team.orgId}/desktop-agents/${team.agent.id}`)
      .set({ ...team.ownerAuth.headers, 'x-organization-id': team.orgId });
    expect(revoked.status).toBe(200);

    const ended = await viewer.nextJson((message) => message.type === 'live.ended');
    expect(ended.reason).toBe('AGENT_REVOKED');
    expect((await viewer.closed()).code).toBe(4000);

    const record = await ScreenLiveSession.findByPk(liveSessionId);
    expect(record?.status).toBe('ENDED');
    expect(record?.terminationReason).toBe('AGENT_REVOKED');
  });

  it('stops capture and ends viewers when the organization is suspended', async () => {
    const team = await createTeam();
    await enablePolicy(team.ownerAuth, team.orgId);
    const started = await startLive(team.ownerAuth, team.orgId, team.employee.user.id);
    const liveSessionId = started.body.data.session.id as string;
    const issued = await ticket(team.ownerAuth, team.orgId, liveSessionId);
    const viewer = await connectViewer(issued.body.data.ticket as string);
    await viewer.nextJson((message) => message.type === 'live.ready');

    await User.update({ platformRole: 'SUPERADMIN' }, { where: { email: team.owner.email } });
    const suspended = await request(app)
      .post(`${API}/platform/organizations/${team.orgId}/suspend`)
      .set(team.ownerAuth.headers);
    expect(suspended.status).toBe(200);

    const ended = await viewer.nextJson((message) => message.type === 'live.ended');
    expect(ended.reason).toBe('ORGANIZATION_SUSPENDED');
    expect((await viewer.closed()).code).toBe(4000);

    const record = await ScreenLiveSession.findByPk(liveSessionId);
    expect(record?.status).toBe('ENDED');
    expect(record?.terminationReason).toBe('ORGANIZATION_SUSPENDED');
  });

  it('keeps the shared session when one of several viewers stops', async () => {
    const team = await createTeam();
    await enablePolicy(team.ownerAuth, team.orgId);
    const started = await startLive(team.ownerAuth, team.orgId, team.employee.user.id);
    const liveSessionId = started.body.data.session.id as string;

    const firstTicket = await ticket(team.ownerAuth, team.orgId, liveSessionId);
    const secondTicket = await ticket(team.ownerAuth, team.orgId, liveSessionId);
    const first = await connectViewer(firstTicket.body.data.ticket as string);
    await first.nextJson((message) => message.type === 'live.ready');
    const second = await connectViewer(secondTicket.body.data.ticket as string);
    await second.nextJson((message) => message.type === 'live.ready');

    const stream = openSocket(
      `${API}/ws/screen-stream?liveSessionId=${liveSessionId}`,
      team.agent.headers,
    );
    await stream.opened;
    await stream.nextJson((message) => message.type === 'live.ready');
    stream.ws.send(JPEG);
    expect((await first.next((message) => message.binary)).data).toEqual(JPEG);
    expect((await second.next((message) => message.binary)).data).toEqual(JPEG);

    first.ws.send(JSON.stringify({ type: 'stop' }));
    expect((await first.closed()).code).toBe(1000);

    const record = await ScreenLiveSession.findByPk(liveSessionId);
    expect(record?.status).toBe('ACTIVE');

    const stopped = await stopLive(team.ownerAuth, team.orgId, liveSessionId);
    expect(stopped.status).toBe(200);
    const ended = await second.nextJson(
      (message) => message.type === 'live.ended' && message.reason === 'VIEWER_STOPPED',
    );
    expect(ended.reason).toBe('VIEWER_STOPPED');
    expect((await second.closed()).code).toBe(4000);

    await stream.close();
  });
});
