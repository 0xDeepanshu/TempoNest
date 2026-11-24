import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { WebSocket, WebSocketServer } from 'ws';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app';
import { config } from '../src/config/env';
import {
  AuditEvent,
  IntegrationEmployeeMapping,
  IntegrationViewerLink,
  IntegrationConnection,
  IntegrationCredential,
  Membership,
  ScreenLiveSession,
  ScreenLiveViewer,
  ScreenshotPolicy,
} from '../src/database';
import { LIVE_INDICATOR_CAPABILITY } from '../src/realtime/agentCapabilities';
import { agentHub } from '../src/realtime/agentHub';
import { attachAgentWebSocketServer } from '../src/realtime/agentWebSocket';
import { attachScreenLiveRelay, type ScreenLiveRelay } from '../src/realtime/screenLiveRelay';
import { startIntegrationScreenLiveRevalidation } from '../src/modules/screenshots/screenLive.integrationRevalidation';
import {
  evaluateIntegrationSessionAuthorization,
  revalidateIntegrationScreenLiveSessions,
  setScreenLiveIndicatorState,
  terminateScreenLiveSession,
} from '../src/modules/screenshots/screenLive.service';
import { API, app, createOwner, loginBrowser, resetDatabase, uniqueEmail } from './helpers';
import {
  EXTERNAL_USER_ID,
  LIVE_SCOPES,
  connect,
  createClient,
  createEmployeeSession,
  createTeam,
  insertSession,
  linkOwner,
} from './integrationLinkHelpers';

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 0x33)]);

let server: HttpServer;
let agentWss: WebSocketServer;
let relay: ScreenLiveRelay;
let port: number;
const clients = new Set<WebSocket>();

beforeAll(async () => {
  server = createServer(createApp());
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  agentWss = attachAgentWebSocketServer(server);
  // The relay starts its own periodic timers (socket sweep, verification) when it is attached. Tests
  // drive every pass explicitly (revalidate..., relay.enforceVerification()), so those timers are
  // pushed out of reach here: a timer firing in the middle of another test would run database work
  // on the shared in-memory SQLite connection. The real timer path is covered by its own test.
  const savedSweep = config.timeTracking.wsSweepIntervalMs;
  const savedRevalidate = config.screenLive.integrationRevalidateMs;
  config.timeTracking.wsSweepIntervalMs = 3_600_000;
  config.screenLive.integrationRevalidateMs = 3_600_000;
  relay = attachScreenLiveRelay(server, { viewerHandshakeTimeoutMs: 400 });
  config.timeTracking.wsSweepIntervalMs = savedSweep;
  config.screenLive.integrationRevalidateMs = savedRevalidate;
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  await relay.close();
  agentHub.closeAll(1001, 'tests complete');
  for (const ws of clients) ws.terminate();
  await new Promise<void>((resolve) => agentWss.close(() => resolve()));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

/**
 * Leaves nothing running behind a test: sessions are ended through the service (which makes the relay
 * clear their grace and expiry timers), every socket is closed and awaited, and the relay's background
 * database work is drained. Without this, work from one test can land in the middle of the next test's
 * transaction on the single in-memory SQLite connection.
 */
async function settle(endSessions: boolean): Promise<void> {
  if (endSessions) {
    for (const row of await ScreenLiveSession.findAll({ where: { status: 'ACTIVE' } })) {
      await terminateScreenLiveSession({
        sessionId: row.id,
        organizationId: row.organizationId,
        reason: 'SERVER_SHUTDOWN',
      });
    }
  }
  agentHub.closeAll(1001, 'test finished');
  await Promise.all(
    [...clients].map(
      (ws) =>
        new Promise<void>((resolve) => {
          if (ws.readyState === WebSocket.CLOSED) return resolve();
          ws.once('close', () => resolve());
          ws.terminate();
        }),
    ),
  );
  clients.clear();
  await relay.idle();
}

beforeEach(async () => {
  await settle(false);
  await resetDatabase();
});

afterEach(async () => {
  await settle(true);
});

// --- WebSocket helpers -------------------------------------------------------------------------

type Socket = ReturnType<typeof openWs>;

function openWs(path: string, headers: Record<string, string> = {}) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`, { headers, origin: undefined });
  clients.add(ws);
  const messages: Array<{ data: Buffer; binary: boolean }> = [];
  const state = { closeCode: null as number | null, rejected: null as number | null };
  ws.on('message', (raw, isBinary) => {
    messages.push({ data: Buffer.isBuffer(raw) ? raw : Buffer.from(raw as ArrayBuffer), binary: isBinary });
  });
  ws.on('close', (code) => {
    state.closeCode = code;
  });
  ws.on('unexpected-response', (_req, res) => {
    state.rejected = res.statusCode ?? 0;
    res.resume();
  });
  ws.on('error', () => undefined);
  const opened = new Promise<boolean>((resolve) => {
    ws.once('open', () => resolve(true));
    ws.once('error', () => resolve(false));
    ws.once('unexpected-response', () => resolve(false));
  });
  const json = () =>
    messages.filter((m) => !m.binary).map((m) => JSON.parse(m.data.toString()) as Record<string, any>);
  const frames = () => messages.filter((m) => m.binary);
  return { ws, opened, messages, state, json, frames };
}

async function waitForJson(socket: Socket, type: string, timeout = 4000) {
  await vi.waitFor(() => expect(socket.json().some((m) => m.type === type)).toBe(true), { timeout });
  return socket.json().find((m) => m.type === type)!;
}

// --- Fixtures ----------------------------------------------------------------------------------

async function liveFixture(label: string) {
  const team = await createTeam(label);
  const { link } = await linkOwner(team);
  const target = await createEmployeeSession(team, `${label} Employee`);
  const externalEmployeeId = `fx-emp-${label}`;
  await IntegrationEmployeeMapping.create({
    connectionId: team.connectionId,
    organizationId: team.orgId,
    workzenUserId: target.employee.user.id,
    externalEmployeeId,
    status: 'ACTIVE',
    matchMethod: 'MANUAL',
  });
  return { team, link, target, externalEmployeeId };
}

type Fixture = Awaited<ReturnType<typeof liveFixture>>;

/** Stands in for the employee app's control socket: online, with (or without) the indicator capability. */
function fakeControlSocket(fx: Fixture, capabilities: string[] = [LIVE_INDICATOR_CAPABILITY]) {
  const sent: string[] = [];
  const ws = { readyState: 1, send: (m: string) => sent.push(m), close: () => undefined } as unknown as WebSocket;
  agentHub.add({
    ws,
    organizationId: fx.team.orgId,
    userId: fx.target.employee.user.id,
    agentId: fx.target.agentId,
    capabilities: new Set(capabilities),
  });
  return { sent };
}

const post = (token: string, path: string, body: unknown) =>
  request(app)
    .post(`${API}/integration/v1${path}`)
    .set('Authorization', `Bearer ${token}`)
    .send(body as object);

const get = (token: string, path: string, query: Record<string, string> = {}) =>
  request(app).get(`${API}/integration/v1${path}`).set('Authorization', `Bearer ${token}`).query(query);

function startSession(fx: Fixture) {
  return post(fx.team.token, '/screen-live/sessions', {
    externalUserId: EXTERNAL_USER_ID,
    externalEmployeeId: fx.externalEmployeeId,
  });
}

function requestTicket(fx: Fixture, sessionId: string) {
  return post(fx.team.token, `/screen-live/sessions/${sessionId}/viewer-tickets`, {
    externalUserId: EXTERNAL_USER_ID,
  });
}

async function sessionRow(id: string) {
  return (await ScreenLiveSession.findByPk(id))!;
}

/** Started session with the agent attached to the stream, indicator confirmed, and one viewer joined. */
async function streamingFixture(label: string) {
  const fx = await liveFixture(label);
  fakeControlSocket(fx);
  const started = await startSession(fx);
  expect(started.status).toBe(201);
  const sessionId = started.body.data.session.id as string;

  const agent = openWs(`${API}/ws/screen-stream?liveSessionId=${sessionId}`, {
    ...fx.target.agentHeaders,
    'x-live-indicator': 'v1',
  });
  expect(await agent.opened).toBe(true);
  const ready = await waitForJson(agent, 'live.ready');
  expect(ready.requireIndicator).toBe(true);
  agent.ws.send(JSON.stringify({ type: 'live.indicator', state: 'visible' }));
  await vi.waitFor(async () => expect((await sessionRow(sessionId)).indicatorConfirmedAt).not.toBeNull(), {
    timeout: 3000,
  });

  const issued = await requestTicket(fx, sessionId);
  expect(issued.status).toBe(201);
  const viewer = openWs(`${API}/ws/screen-live`);
  expect(await viewer.opened).toBe(true);
  viewer.ws.send(JSON.stringify({ type: 'authenticate', ticket: issued.body.data.ticket }));
  await waitForJson(viewer, 'live.ready');
  return { fx, sessionId, agent, viewer, ticket: issued.body.data.ticket as string };
}

// --- API: authorization --------------------------------------------------------------------------

describe('integration live screen API', () => {
  it('refuses an external account that is not linked, before anything else', async () => {
    const team = await createTeam('unlinked');
    for (const response of [
      await get(team.token, '/screen-live/employees', { externalUserId: 'nobody' }),
      await post(team.token, '/screen-live/sessions', { externalUserId: 'nobody', externalEmployeeId: 'x' }),
    ]) {
      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('VIEWER_LINK_REQUIRED');
    }
    const denied = await AuditEvent.findAll({
      where: { organizationId: team.orgId, action: 'SCREEN_LIVE_ACCESS_DENIED' },
    });
    expect(denied.length).toBeGreaterThanOrEqual(2);
    expect(denied[0]?.metadata).toMatchObject({ via: 'integration', reason: 'VIEWER_LINK_REQUIRED' });
  });

  it('needs the screens:live scope on every route', async () => {
    const owner = await createOwner(uniqueEmail('scope-live'), 'Scope Live Org');
    const client = await createClient();
    const connected = await connect({
      approver: owner,
      organizationId: owner.organization.id,
      client,
      scopes: ['attendance:read', 'employees:read'],
      externalOrganizationId: 'flowtrium-org-scope-live',
    });
    if (!('accessToken' in connected)) throw new Error('connection failed');
    const response = await get(connected.accessToken, '/screen-live/employees', { externalUserId: 'x' });
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('INTEGRATION_SCOPE_DENIED');
    expect(
      (
        await post(connected.accessToken, '/screen-live/sessions', {
          externalUserId: 'x',
          externalEmployeeId: 'y',
        })
      ).status,
    ).toBe(403);
  });

  it('only names employees through a confirmed mapping, never a WorkZen id', async () => {
    const fx = await liveFixture('mapping');
    fakeControlSocket(fx);
    const unmapped = await post(fx.team.token, '/screen-live/sessions', {
      externalUserId: EXTERNAL_USER_ID,
      externalEmployeeId: 'not-mapped',
    });
    expect(unmapped.status).toBe(404);
    expect(unmapped.body.error.code).toBe('EMPLOYEE_NOT_MAPPED');

    // A raw WorkZen user id is not an accepted field, and not an accepted value either.
    const raw = await post(fx.team.token, '/screen-live/sessions', {
      externalUserId: EXTERNAL_USER_ID,
      externalEmployeeId: fx.target.employee.user.id,
    });
    expect(raw.status).toBe(404);
    const extra = await post(fx.team.token, '/screen-live/sessions', {
      externalUserId: EXTERNAL_USER_ID,
      externalEmployeeId: fx.externalEmployeeId,
      employeeId: fx.target.employee.user.id,
    });
    // The body schema is strict, and this API reports validation failures as 422.
    expect(extra.status).toBe(422);

    await IntegrationEmployeeMapping.update({ status: 'PENDING' }, { where: { connectionId: fx.team.connectionId } });
    expect((await startSession(fx)).status).toBe(404);
    expect(await ScreenLiveSession.count()).toBe(0);
  });

  it('cannot reach an employee of another organization', async () => {
    const a = await liveFixture('xorg-a');
    const b = await liveFixture('xorg-b');
    fakeControlSocket(b);
    const response = await post(a.team.token, '/screen-live/sessions', {
      externalUserId: EXTERNAL_USER_ID,
      externalEmployeeId: b.externalEmployeeId,
    });
    expect(response.status).toBe(404);
    expect(await ScreenLiveSession.count()).toBe(0);

    // Nor another organization's session, once one exists.
    fakeControlSocket(a);
    const started = await startSession(b);
    expect(started.status).toBe(201);
    const peek = await get(a.team.token, `/screen-live/sessions/${started.body.data.session.id}`, {
      externalUserId: EXTERNAL_USER_ID,
    });
    expect(peek.status).toBe(404);
    expect((await requestTicket(a, started.body.data.session.id)).status).toBe(404);
  });

  it('refuses when the employee app is offline or too old to show the indicator', async () => {
    const fx = await liveFixture('capability');
    const offline = await startSession(fx);
    expect(offline.status).toBe(409);
    expect(offline.body.error.code).toBe('SCREEN_LIVE_AGENT_OFFLINE');

    fakeControlSocket(fx, []); // connected, but advertises nothing
    const old = await startSession(fx);
    expect(old.status).toBe(409);
    expect(old.body.error.code).toBe('SCREEN_LIVE_INDICATOR_UNSUPPORTED');
    expect(await ScreenLiveSession.count()).toBe(0);

    const list = await get(fx.team.token, '/screen-live/employees', { externalUserId: EXTERNAL_USER_ID });
    expect(list.body.data[0]).toMatchObject({
      externalEmployeeId: fx.externalEmployeeId,
      availability: 'APP_UPDATE_REQUIRED',
    });
  });

  it('starts a session as the verified owner and records every identity', async () => {
    const fx = await liveFixture('start');
    const control = fakeControlSocket(fx);
    const list = await get(fx.team.token, '/screen-live/employees', { externalUserId: EXTERNAL_USER_ID });
    expect(list.body.data[0].availability).toBe('AVAILABLE');

    const started = await startSession(fx);
    expect(started.status).toBe(201);
    expect(started.body.data.session.indicator).toMatchObject({ required: true, confirmed: false });
    expect(started.body.data.session.externalEmployeeId).toBe(fx.externalEmployeeId);

    const row = await sessionRow(started.body.data.session.id);
    expect(row.get({ plain: true })).toMatchObject({
      origin: 'INTEGRATION',
      startedByUserId: fx.team.owner.user.id,
      integrationConnectionId: fx.team.connectionId,
      integrationViewerLinkId: fx.link.id,
      externalOrganizationId: fx.team.externalOrganizationId,
      externalUserId: EXTERNAL_USER_ID,
    });
    expect(row.indicatorConfirmedAt).toBeNull();

    // The employee's app is told the indicator is mandatory.
    const command = JSON.parse(control.sent[0]!) as Record<string, unknown>;
    expect(command).toMatchObject({ type: 'screen.live.start', requireIndicator: true });

    const audit = await AuditEvent.findOne({
      where: { organizationId: fx.team.orgId, action: 'SCREEN_LIVE_SESSION_STARTED' },
    });
    expect(audit?.actorUserId).toBe(fx.team.owner.user.id);
    expect(audit?.metadata).toMatchObject({
      origin: 'INTEGRATION',
      viewerUserId: fx.team.owner.user.id,
      externalUserId: EXTERNAL_USER_ID,
      externalOrganizationId: fx.team.externalOrganizationId,
      integrationViewerLinkId: fx.link.id,
      indicatorRequired: true,
    });
  });

  it('issues a ticket only once the indicator is confirmed, and audits it', async () => {
    const fx = await liveFixture('ticket');
    fakeControlSocket(fx);
    const started = await startSession(fx);
    const sessionId = started.body.data.session.id as string;

    const early = await requestTicket(fx, sessionId);
    expect(early.status).toBe(409);
    expect(early.body.error.code).toBe('SCREEN_LIVE_INDICATOR_NOT_CONFIRMED');
    expect(await ScreenLiveViewer.count()).toBe(0);

    await ScreenLiveSession.update({ indicatorConfirmedAt: new Date() }, { where: { id: sessionId } });
    const issued = await requestTicket(fx, sessionId);
    expect(issued.status).toBe(201);
    expect(Object.keys(issued.body.data).sort()).toEqual(['expiresAt', 'ticket', 'viewerId', 'websocketPath']);
    expect(JSON.stringify(issued.body)).not.toMatch(/access_token|refresh_token|agentKey/i);

    const viewer = await ScreenLiveViewer.findByPk(issued.body.data.viewerId);
    expect(viewer?.userId).toBe(fx.team.owner.user.id);
    const audit = await AuditEvent.findOne({
      where: { organizationId: fx.team.orgId, action: 'SCREEN_LIVE_TICKET_ISSUED' },
    });
    expect(audit?.actorUserId).toBe(fx.team.owner.user.id);
    expect(audit?.metadata).toMatchObject({ via: 'integration', externalUserId: EXTERNAL_USER_ID });
  });

  it('keeps integration and native sessions apart', async () => {
    const fx = await liveFixture('apart');
    fakeControlSocket(fx);
    const native = await insertSessionForNative(fx);
    const refused = await startSession(fx);
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe('SCREEN_LIVE_SESSION_IN_USE');
    // The integration side can neither see nor stop the native session.
    expect(
      (await get(fx.team.token, `/screen-live/sessions/${native.id}`, { externalUserId: EXTERNAL_USER_ID })).status,
    ).toBe(404);
    expect(
      (await post(fx.team.token, `/screen-live/sessions/${native.id}/stop`, { externalUserId: EXTERNAL_USER_ID }))
        .status,
    ).toBe(404);
    expect((await sessionRow(native.id)).status).toBe('ACTIVE');
  });

  it('stops a session and audits it against the owner', async () => {
    const fx = await liveFixture('stop');
    fakeControlSocket(fx);
    const started = await startSession(fx);
    const sessionId = started.body.data.session.id as string;
    const stopped = await post(fx.team.token, `/screen-live/sessions/${sessionId}/stop`, {
      externalUserId: EXTERNAL_USER_ID,
    });
    expect(stopped.status).toBe(200);
    expect(stopped.body.data.stopped).toBe(true);
    const row = await sessionRow(sessionId);
    expect(row.status).toBe('ENDED');
    expect(row.terminationReason).toBe('VIEWER_STOPPED');
    const audit = await AuditEvent.findOne({
      where: { organizationId: fx.team.orgId, action: 'SCREEN_LIVE_SESSION_STOPPED' },
    });
    expect(audit).not.toBeNull();
  });

  it('refuses a manager or employee, who can never be linked', async () => {
    // Linking itself refuses them (covered in the link suite); a link that was created for an owner
    // who is later demoted is refused here, and the link is withdrawn.
    const fx = await liveFixture('demoted-api');
    fakeControlSocket(fx);
    await Membership.update(
      { role: 'MANAGER' },
      { where: { userId: fx.team.owner.user.id, organizationId: fx.team.orgId } },
    );
    const response = await startSession(fx);
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('VIEWER_LINK_OWNER_REQUIRED');
    expect((await IntegrationViewerLink.findByPk(fx.link.id))?.status).toBe('REVOKED');
  });
});

/** A session started the way the existing in-product owner flow starts one. */
async function insertSessionForNative(fx: Fixture) {
  return insertSession(fx.team, fx.target, { origin: 'WORKZEN' });
}

// --- Continuity: sessions that are already running -----------------------------------------------

describe('continuity of running integration sessions', () => {
  async function runningSession(label: string) {
    const fx = await liveFixture(label);
    const session = await insertSession(fx.team, fx.target, {
      origin: 'INTEGRATION',
      integrationConnectionId: fx.team.connectionId,
      integrationViewerLinkId: fx.link.id,
      indicatorConfirmedAt: new Date(),
    });
    return { fx, session };
  }

  async function expectEnded(id: string, reason: string) {
    const row = await sessionRow(id);
    expect(row.status).toBe('ENDED');
    expect(row.terminationReason).toBe(reason);
  }

  it('leaves a healthy session, and every native session, alone', async () => {
    const { session } = await runningSession('healthy');
    expect(await revalidateIntegrationScreenLiveSessions()).toBe(0);
    expect((await sessionRow(session.id)).status).toBe('ACTIVE');
  });

  it.each([
    ['the viewer link is revoked', async (ctx: any) => {
      await IntegrationViewerLink.update({ status: 'REVOKED' }, { where: { id: ctx.fx.link.id } });
    }, 'VIEWER_LINK_REVOKED'],
    ['the linked owner is demoted', async (ctx: any) => {
      await Membership.update({ role: 'ADMIN' }, { where: { userId: ctx.fx.team.owner.user.id, organizationId: ctx.fx.team.orgId } });
    }, 'VIEWER_LINK_REVOKED'],
    ['the linked owner loses screenshot:live (a role without it)', async (ctx: any) => {
      await Membership.update({ role: 'EMPLOYEE' }, { where: { userId: ctx.fx.team.owner.user.id, organizationId: ctx.fx.team.orgId } });
    }, 'VIEWER_LINK_REVOKED'],
    ['the linked owner is suspended', async (ctx: any) => {
      await Membership.update({ status: 'SUSPENDED' }, { where: { userId: ctx.fx.team.owner.user.id, organizationId: ctx.fx.team.orgId } });
    }, 'VIEWER_LINK_REVOKED'],
    ['the integration is disconnected', async (ctx: any) => {
      await IntegrationConnection.update({ status: 'DISCONNECTED' }, { where: { id: ctx.fx.team.connectionId } });
    }, 'INTEGRATION_DISCONNECTED'],
    ['the integration credential is revoked', async (ctx: any) => {
      await IntegrationCredential.update({ revokedAt: new Date() }, { where: { connectionId: ctx.fx.team.connectionId } });
    }, 'INTEGRATION_DISCONNECTED'],
    ['the monitoring policy is disabled', async (ctx: any) => {
      await ScreenshotPolicy.update({ enabled: false }, { where: { organizationId: ctx.fx.team.orgId } });
    }, 'POLICY_DISABLED'],
    ['the session expires', async (ctx: any) => {
      await ScreenLiveSession.update({ expiresAt: new Date(Date.now() - 1000) }, { where: { id: ctx.session.id } });
    }, 'EXPIRED'],
    ['the indicator is never confirmed in time', async (ctx: any) => {
      const old = new Date(Date.now() - config.screenLive.indicatorConfirmTimeoutMs - 5000);
      await ScreenLiveSession.update(
        { indicatorConfirmedAt: null, startedAt: old, updatedAt: old },
        { where: { id: ctx.session.id }, silent: true },
      );
    }, 'INDICATOR_UNAVAILABLE'],
  ])('ends the session when %s', async (_name, mutate, reason) => {
    const ctx = await runningSession(`cont-${String(reason).toLowerCase()}-${Math.random().toString(36).slice(2, 6)}`);
    await mutate(ctx);
    expect(await revalidateIntegrationScreenLiveSessions()).toBe(1);
    await expectEnded(ctx.session.id, reason);
  });

  it('gives a reconnecting app the same confirmation window as a new session', async () => {
    const { session } = await runningSession('reconnect');
    // A long-running session whose stream just dropped: the flag was cleared a moment ago.
    await ScreenLiveSession.update(
      {
        indicatorConfirmedAt: null,
        startedAt: new Date(Date.now() - 10 * 60_000),
        updatedAt: new Date(),
      },
      { where: { id: session.id }, silent: true },
    );
    expect(await revalidateIntegrationScreenLiveSessions()).toBe(0);
    expect((await sessionRow(session.id)).status).toBe('ACTIVE');
  });

  it('withdraws the link when the owner is no longer eligible, and ends all of its sessions', async () => {
    const { fx, session } = await runningSession('withdraw');
    await Membership.update({ role: 'ADMIN' }, { where: { userId: fx.team.owner.user.id, organizationId: fx.team.orgId } });
    await revalidateIntegrationScreenLiveSessions();
    const link = await IntegrationViewerLink.findByPk(fx.link.id);
    expect(link?.status).toBe('REVOKED');
    expect(link?.revokeReason).toBe('IDENTITY_NO_LONGER_ELIGIBLE');
    await expectEnded(session.id, 'VIEWER_LINK_REVOKED');
  });

  it('does not touch an existing native owner session in the same pass', async () => {
    const { fx, session } = await runningSession('native');
    const other = await createEmployeeSession(fx.team, 'Native Employee');
    const native = await insertSession(fx.team, other, { origin: 'WORKZEN' });
    await IntegrationViewerLink.update({ status: 'REVOKED' }, { where: { id: fx.link.id } });
    await revalidateIntegrationScreenLiveSessions();
    await expectEnded(session.id, 'VIEWER_LINK_REVOKED');
    expect((await sessionRow(native.id)).status).toBe('ACTIVE');
  });

  it('keeps the revalidation interval within its documented maximum of 15 seconds', () => {
    expect(config.screenLive.integrationRevalidateMs).toBeGreaterThanOrEqual(2_000);
    expect(config.screenLive.integrationRevalidateMs).toBeLessThanOrEqual(15_000);
  });

  it('ends a session on its own timer, without any API call', async () => {
    const { fx, session } = await runningSession('timer');
    const stop = startIntegrationScreenLiveRevalidation(50);
    try {
      await IntegrationViewerLink.update({ status: 'REVOKED' }, { where: { id: fx.link.id } });
      await vi.waitFor(async () => expect((await sessionRow(session.id)).status).toBe('ENDED'), {
        timeout: 3000,
        interval: 25,
      });
      expect((await sessionRow(session.id)).terminationReason).toBe('VIEWER_LINK_REVOKED');
    } finally {
      stop();
      await stop.idle();
    }
  });
});

// --- Relay: the indicator gate and teardown of live streams --------------------------------------

describe('relay indicator gate', () => {
  it('forwards no frame until the agent has confirmed its indicator', async () => {
    const fx = await liveFixture('gate');
    fakeControlSocket(fx);
    const started = await startSession(fx);
    const sessionId = started.body.data.session.id as string;

    const agent = openWs(`${API}/ws/screen-stream?liveSessionId=${sessionId}`, {
      ...fx.target.agentHeaders,
      'x-live-indicator': 'v1',
    });
    expect(await agent.opened).toBe(true);
    await waitForJson(agent, 'live.ready');
    // Let the relay's own reset of the flag land first, then simulate a stale flag: the relay must not
    // trust the database for frames.
    await new Promise((resolve) => setTimeout(resolve, 200));
    await ScreenLiveSession.update({ indicatorConfirmedAt: new Date() }, { where: { id: sessionId } });

    const issued = await requestTicket(fx, sessionId);
    expect(issued.status).toBe(201);
    const viewer = openWs(`${API}/ws/screen-live`);
    await viewer.opened;
    viewer.ws.send(JSON.stringify({ type: 'authenticate', ticket: issued.body.data.ticket }));
    await waitForJson(viewer, 'live.ready');

    agent.ws.send(JSON.stringify({ type: 'ping' }));
    agent.ws.send(JPEG, { binary: true }); // unconfirmed: dropped
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(viewer.frames()).toHaveLength(0);

    agent.ws.send(JSON.stringify({ type: 'live.indicator', state: 'visible' }));
    await waitForJson(viewer, 'live.indicator');
    agent.ws.send(JPEG, { binary: true });
    await vi.waitFor(() => expect(viewer.frames().length).toBe(1), { timeout: 3000 });
    expect(viewer.frames()[0]!.data.equals(JPEG)).toBe(true);
  });

  it('ends the session when the indicator is withdrawn', async () => {
    const { sessionId, agent, viewer } = await streamingFixture('withdrawn');
    agent.ws.send(JSON.stringify({ type: 'live.indicator', state: 'hidden' }));
    await vi.waitFor(async () => expect((await sessionRow(sessionId)).status).toBe('ENDED'), { timeout: 3000 });
    expect((await sessionRow(sessionId)).terminationReason).toBe('INDICATOR_UNAVAILABLE');
    await vi.waitFor(() => expect(viewer.state.closeCode).not.toBeNull(), { timeout: 3000 });
    expect(viewer.frames()).toHaveLength(0);
  });

  it('cuts off an agent that keeps sending frames without confirming', async () => {
    const fx = await liveFixture('flood');
    fakeControlSocket(fx);
    const started = await startSession(fx);
    const sessionId = started.body.data.session.id as string;
    const agent = openWs(`${API}/ws/screen-stream?liveSessionId=${sessionId}`, {
      ...fx.target.agentHeaders,
      'x-live-indicator': 'v1',
    });
    await agent.opened;
    await waitForJson(agent, 'live.ready');
    for (let i = 0; i < 3; i += 1) agent.ws.send(JPEG, { binary: true });
    await vi.waitFor(() => expect(agent.state.closeCode).toBe(4003), { timeout: 3000 });
    await vi.waitFor(async () => expect((await sessionRow(sessionId)).status).toBe('ENDED'), { timeout: 3000 });
    expect((await sessionRow(sessionId)).terminationReason).toBe('INDICATOR_UNAVAILABLE');
  });

  it('refuses an older desktop app that does not state indicator support', async () => {
    const fx = await liveFixture('old-app');
    fakeControlSocket(fx);
    const started = await startSession(fx);
    const sessionId = started.body.data.session.id as string;
    const agent = openWs(`${API}/ws/screen-stream?liveSessionId=${sessionId}`, fx.target.agentHeaders);
    expect(await agent.opened).toBe(false);
    await vi.waitFor(() => expect(agent.state.rejected).toBe(403), { timeout: 3000 });
    await vi.waitFor(async () => expect((await sessionRow(sessionId)).status).toBe('ENDED'), { timeout: 3000 });
    expect((await sessionRow(sessionId)).terminationReason).toBe('INDICATOR_UNAVAILABLE');
  });

  it('records the confirmation and clears it when the stream drops', async () => {
    const { sessionId, agent } = await streamingFixture('confirmed');
    expect((await sessionRow(sessionId)).indicatorConfirmedAt).not.toBeNull();
    const confirmed = await AuditEvent.findOne({ where: { action: 'SCREEN_LIVE_INDICATOR_CONFIRMED' } });
    expect(confirmed?.entityId).toBe(sessionId);
    agent.ws.terminate();
    await vi.waitFor(async () => expect((await sessionRow(sessionId)).indicatorConfirmedAt).toBeNull(), {
      timeout: 3000,
    });
  });
});

describe('relay teardown of running streams', () => {
  it('ends agent and viewer when the link is revoked, with no API call', async () => {
    const { fx, sessionId, agent, viewer } = await streamingFixture('teardown-link');
    await IntegrationViewerLink.update({ status: 'REVOKED' }, { where: { id: fx.link.id } });
    expect(await revalidateIntegrationScreenLiveSessions()).toBe(1);
    await vi.waitFor(() => expect(viewer.state.closeCode).not.toBeNull(), { timeout: 3000 });
    await vi.waitFor(() => expect(agent.state.closeCode).not.toBeNull(), { timeout: 3000 });
    expect((await sessionRow(sessionId)).terminationReason).toBe('VIEWER_LINK_REVOKED');
  });

  it('ends a running stream when the owner is demoted', async () => {
    const { fx, sessionId, viewer } = await streamingFixture('teardown-demote');
    await Membership.update({ role: 'ADMIN' }, { where: { userId: fx.team.owner.user.id, organizationId: fx.team.orgId } });
    await revalidateIntegrationScreenLiveSessions();
    await vi.waitFor(() => expect(viewer.state.closeCode).not.toBeNull(), { timeout: 3000 });
    expect((await sessionRow(sessionId)).status).toBe('ENDED');
  });

  it('ends a running stream when the connection is disconnected through the API', async () => {
    const { fx, sessionId, agent, viewer } = await streamingFixture('teardown-disconnect');
    const response = await fx.team.owner.agent
      .post(`${API}/organizations/${fx.team.orgId}/integrations/connections/${fx.team.connectionId}/disconnect`)
      .set('x-csrf-token', fx.team.owner.csrf);
    expect(response.status).toBe(200);
    await vi.waitFor(() => expect(viewer.state.closeCode).not.toBeNull(), { timeout: 3000 });
    await vi.waitFor(() => expect(agent.state.closeCode).not.toBeNull(), { timeout: 3000 });
    expect((await sessionRow(sessionId)).terminationReason).toBe('INTEGRATION_DISCONNECTED');
  });

  it('ends a running stream when the monitoring policy is disabled', async () => {
    const { fx, sessionId, viewer } = await streamingFixture('teardown-policy');
    await ScreenshotPolicy.update({ enabled: false }, { where: { organizationId: fx.team.orgId } });
    await revalidateIntegrationScreenLiveSessions();
    await vi.waitFor(() => expect(viewer.state.closeCode).not.toBeNull(), { timeout: 3000 });
    expect((await sessionRow(sessionId)).terminationReason).toBe('POLICY_DISABLED');
  });

  it('ends a running stream when the viewer stops it', async () => {
    const { fx, sessionId, viewer } = await streamingFixture('teardown-stop');
    const stopped = await post(fx.team.token, `/screen-live/sessions/${sessionId}/stop`, {
      externalUserId: EXTERNAL_USER_ID,
    });
    expect(stopped.status).toBe(200);
    await vi.waitFor(() => expect(viewer.state.closeCode).not.toBeNull(), { timeout: 3000 });
    expect((await sessionRow(sessionId)).terminationReason).toBe('VIEWER_STOPPED');
  });
});

describe('feature switch and fail-closed behaviour', () => {
  it('ends running streams and refuses new ones when the feature is switched off', async () => {
    const { fx, sessionId, agent, viewer } = await streamingFixture('switch-off');
    const original = config.integrations.liveScreensEnabled;
    try {
      config.integrations.liveScreensEnabled = false;
      expect(await revalidateIntegrationScreenLiveSessions()).toBe(1);
      await vi.waitFor(() => expect(viewer.state.closeCode).not.toBeNull(), { timeout: 3000 });
      await vi.waitFor(() => expect(agent.state.closeCode).not.toBeNull(), { timeout: 3000 });
      expect((await sessionRow(sessionId)).terminationReason).toBe('FEATURE_DISABLED');

      // New work is refused outright, but an existing link can still be inspected and withdrawn.
      const started = await startSession(fx);
      expect(started.status).toBe(404);
      expect(started.body.error.code).toBe('LIVE_SCREENS_DISABLED');
      expect((await get(fx.team.token, `/viewer-links/users/${EXTERNAL_USER_ID}`)).status).toBe(200);
    } finally {
      config.integrations.liveScreensEnabled = original;
    }
  });

  it('refuses a new stream while the feature is off, even for a session left ACTIVE in the database', async () => {
    const fx = await liveFixture('switch-off-attach');
    fakeControlSocket(fx);
    const started = await startSession(fx);
    const sessionId = started.body.data.session.id as string;
    const original = config.integrations.liveScreensEnabled;
    try {
      config.integrations.liveScreensEnabled = false;
      const agent = openWs(`${API}/ws/screen-stream?liveSessionId=${sessionId}`, {
        ...fx.target.agentHeaders,
        'x-live-indicator': 'v1',
      });
      expect(await agent.opened).toBe(false);
      await vi.waitFor(() => expect(agent.state.rejected).toBe(403), { timeout: 3000 });
      expect((await sessionRow(sessionId)).terminationReason).toBe('FEATURE_DISABLED');
    } finally {
      config.integrations.liveScreensEnabled = original;
    }
  });

  it('forwards frames only while the session was positively re-authorized recently', async () => {
    const { agent, viewer } = await streamingFixture('verified-window');
    const original = config.screenLive.integrationRevalidateMs;
    try {
      // Positive control: a verified, confirmed stream forwards.
      agent.ws.send(JPEG, { binary: true });
      await vi.waitFor(() => expect(viewer.frames().length).toBe(1), { timeout: 3000 });

      // Shrink the window (3 x interval) and let the last verification age out. Nothing re-verifies.
      config.screenLive.integrationRevalidateMs = 100;
      await new Promise((resolve) => setTimeout(resolve, 450));
      agent.ws.send(JPEG, { binary: true });
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(viewer.frames().length).toBe(1);

      // A successful pass makes it verified again, and the stream carries on.
      expect(await revalidateIntegrationScreenLiveSessions()).toBe(0);
      agent.ws.send(JPEG, { binary: true });
      await vi.waitFor(() => expect(viewer.frames().length).toBe(2), { timeout: 3000 });
    } finally {
      config.screenLive.integrationRevalidateMs = original;
    }
  });

  it('stops showing the screen when re-authorization keeps failing, instead of trusting the last answer', async () => {
    const { sessionId, agent, viewer } = await streamingFixture('db-outage');
    const original = config.screenLive.integrationRevalidateMs;
    const failing = vi
      .spyOn(IntegrationViewerLink, 'findByPk')
      .mockRejectedValue(new Error('simulated database failure'));
    try {
      config.screenLive.integrationRevalidateMs = 100;

      // A failed pass must not end a healthy session by itself...
      expect(await revalidateIntegrationScreenLiveSessions()).toBe(0);
      expect((await sessionRow(sessionId)).status).toBe('ACTIVE');

      // ...but once the verification window has passed with no success, nothing is forwarded.
      await new Promise((resolve) => setTimeout(resolve, 450));
      expect(await revalidateIntegrationScreenLiveSessions()).toBe(0);
      agent.ws.send(JPEG, { binary: true });
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(viewer.frames()).toHaveLength(0);

      // And the relay tears the stream down and keeps trying to end the session.
      relay.enforceVerification();
      await vi.waitFor(() => expect(viewer.state.closeCode).not.toBeNull(), { timeout: 3000 });
      await vi.waitFor(() => expect(agent.state.closeCode).not.toBeNull(), { timeout: 3000 });
      await vi.waitFor(async () => expect((await sessionRow(sessionId)).status).toBe('ENDED'), {
        timeout: 3000,
      });
      expect((await sessionRow(sessionId)).terminationReason).toBe('VERIFICATION_UNAVAILABLE');
    } finally {
      failing.mockRestore();
      config.screenLive.integrationRevalidateMs = original;
    }
  });

  it('never lets a failed database read count as permission', async () => {
    const ctx = await liveFixture('db-read');
    const session = await insertSession(ctx.team, ctx.target, {
      origin: 'INTEGRATION',
      integrationConnectionId: ctx.team.connectionId,
      integrationViewerLinkId: ctx.link.id,
      indicatorConfirmedAt: new Date(),
    });
    const failing = vi
      .spyOn(Membership, 'findOne')
      .mockRejectedValue(new Error('simulated database failure'));
    try {
      // The error propagates (and the loop logs and retries); it is never treated as "eligible".
      const row = await sessionRow(session.id);
      await expect(evaluateIntegrationSessionAuthorization(row)).rejects.toThrow('simulated database failure');
    } finally {
      failing.mockRestore();
    }
  });
});

describe('viewer tickets', () => {
  it('are single use', async () => {
    const { fx, ticket } = await streamingFixture('replay-ticket');
    const second = openWs(`${API}/ws/screen-live`);
    await second.opened;
    second.ws.send(JSON.stringify({ type: 'authenticate', ticket }));
    const error = await waitForJson(second, 'live.error');
    expect(error.code).toBe('SCREEN_LIVE_TICKET_INVALID');
    expect(fx).toBeTruthy();
  });

  it('expire', async () => {
    const fx = await liveFixture('expiry-ticket');
    fakeControlSocket(fx);
    const started = await startSession(fx);
    const sessionId = started.body.data.session.id as string;
    await ScreenLiveSession.update({ indicatorConfirmedAt: new Date() }, { where: { id: sessionId } });
    const issued = await requestTicket(fx, sessionId);
    await ScreenLiveViewer.update(
      { ticketExpiresAt: new Date(Date.now() - 1000) },
      { where: { id: issued.body.data.viewerId } },
    );
    const viewer = openWs(`${API}/ws/screen-live`);
    await viewer.opened;
    viewer.ws.send(JSON.stringify({ type: 'authenticate', ticket: issued.body.data.ticket }));
    const error = await waitForJson(viewer, 'live.error');
    expect(error.code).toBe('SCREEN_LIVE_TICKET_EXPIRED');
  });

  it('are refused at the socket once the link is gone, even before any revalidation tick', async () => {
    const fx = await liveFixture('revoked-ticket');
    fakeControlSocket(fx);
    const started = await startSession(fx);
    const sessionId = started.body.data.session.id as string;
    await setScreenLiveIndicatorState({
      sessionId,
      organizationId: fx.team.orgId,
      agentId: fx.target.agentId,
      visible: true,
    });
    const issued = await requestTicket(fx, sessionId);
    expect(issued.status).toBe(201);
    await IntegrationViewerLink.update({ status: 'REVOKED' }, { where: { id: fx.link.id } });
    const viewer = openWs(`${API}/ws/screen-live`);
    await viewer.opened;
    viewer.ws.send(JSON.stringify({ type: 'authenticate', ticket: issued.body.data.ticket }));
    const error = await waitForJson(viewer, 'live.error');
    expect(error.code).toBe('SCREEN_LIVE_ACCESS_REVOKED');
    expect((await sessionRow(sessionId)).status).toBe('ENDED');
  });

  it('cannot be requested by a native owner for an integration session', async () => {
    const fx = await liveFixture('foreign');
    fakeControlSocket(fx);
    const started = await startSession(fx);
    const sessionId = started.body.data.session.id as string;
    await ScreenLiveSession.update({ indicatorConfirmedAt: new Date() }, { where: { id: sessionId } });
    const native = await request(app)
      .post(`${API}/admin/screen-live-sessions/${sessionId}/viewer-tickets`)
      .set({
        Authorization: `Bearer ${(await loginDesktopToken(fx.team.owner.email)).token}`,
        'x-organization-id': fx.team.orgId,
      })
      .send({});
    expect(native.status).toBe(403);
    expect(native.body.error.code).toBe('SCREEN_LIVE_SESSION_FOREIGN');
  });
});

async function loginDesktopToken(email: string) {
  const { desktopAuth } = await import('./helpers');
  return desktopAuth(email);
}

// Silence unused-import lint for helpers kept for readability in failures.
void loginBrowser;
void LIVE_SCOPES;
