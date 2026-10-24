import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocket, WebSocketServer } from 'ws';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { config } from '../src/config/env';
import { Session, TimeSession } from '../src/database';
import { hashOpaqueToken } from '../src/utils/crypto';
import { agentHub } from '../src/realtime/agentHub';
import { attachAgentWebSocketServer } from '../src/realtime/agentWebSocket';
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

type Message = Record<string, any>;
type Waiter = {
  predicate: (message: Message) => boolean;
  resolve: (message: Message) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
};

let server: HttpServer;
let wss: WebSocketServer;
let port: number;
const clients = new Set<WebSocket>();

async function createTeam() {
  const owner = await createOwner(uniqueEmail('owner'), 'WebSocket Org');
  const ownerAuth = await desktopAuth(owner.email);
  const employee = await inviteAndAccept(owner, {
    role: 'EMPLOYEE',
    name: 'Socket Employee',
    email: uniqueEmail('employee'),
  });
  const auth = await desktopAuth(employee.email);
  const agent = await registerAgent(auth, owner.organization.id);
  return { owner, ownerAuth, employee, auth, agent, orgId: owner.organization.id };
}

function connect(headers: Record<string, string>) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}${API}/ws/agent`, { headers });
  clients.add(ws);
  const messages: Message[] = [];
  const waiters: Waiter[] = [];
  let closeInfo: { code: number; reason: string } | null = null;
  const closeWaiters: Array<(value: { code: number; reason: string }) => void> = [];

  ws.on('message', (raw) => {
    const message = JSON.parse(raw.toString()) as Message;
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

  function next(predicate: (message: Message) => boolean, timeoutMs = 4_000): Promise<Message> {
    const index = messages.findIndex(predicate);
    if (index >= 0) return Promise.resolve(messages.splice(index, 1)[0]!);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const waiterIndex = waiters.findIndex((waiter) => waiter.timer === timer);
        if (waiterIndex >= 0) waiters.splice(waiterIndex, 1);
        reject(new Error(`Timed out waiting for WebSocket message. Queued: ${JSON.stringify(messages)}`));
      }, timeoutMs);
      waiters.push({ predicate, resolve, reject, timer });
    });
  }

  function closed(): Promise<{ code: number; reason: string }> {
    if (closeInfo) return Promise.resolve(closeInfo);
    return new Promise((resolve) => closeWaiters.push(resolve));
  }

  async function close(): Promise<void> {
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
      ws.close(1000, 'test complete');
    }
    await closed().catch(() => undefined);
  }

  return { ws, opened, next, closed, close };
}

function connectFailure(headers: Record<string, string>, label = 'request'): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}${API}/ws/agent`, { headers });
    clients.add(ws);
    let settled = false;
    const settle = (value: { status: number; body: any }) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    ws.on('unexpected-response', (_req, response) => {
      let body = '';
      response.on('data', (chunk) => {
        body += chunk.toString();
      });
      response.on('end', () => {
        try {
          settle({ status: response.statusCode ?? 0, body: JSON.parse(body) });
        } catch {
          settle({ status: response.statusCode ?? 0, body });
        }
      });
    });
    ws.on('open', () => {
      if (!settled) {
        settled = true;
        reject(new Error(`Expected WebSocket authentication to fail (${label})`));
      }
    });
    ws.on('error', () => undefined);
  });
}

describe('agent WebSocket', () => {
  beforeAll(async () => {
    server = createServer(createApp());
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    wss = attachAgentWebSocketServer(server);
    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    agentHub.closeAll(1001, 'tests complete');
    for (const ws of clients) ws.terminate();
    await new Promise<void>((resolve) => wss.close(() => resolve()));
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
  });

  it('authenticates, persists heartbeats, pushes session updates, and reconnects', async () => {
    const { orgId, agent } = await createTeam();
    const started = await request(app)
      .post(`${API}/organizations/${orgId}/time-sessions/start`)
      .set(agent.headers)
      .send({});
    expect(started.status).toBe(201);
    const sessionId = started.body.data.session.id as string;

    const first = connect(agent.headers);
    await first.opened;
    const connected = await first.next((message) => message.type === 'connected');
    expect(connected.agent.id).toBe(agent.id);
    expect(connected.state).toBe('WORKING');
    expect(connected.session.id).toBe(sessionId);

    const before = (await TimeSession.findByPk(sessionId))!.lastHeartbeatAt.getTime();
    await new Promise((resolve) => setTimeout(resolve, 15));
    first.ws.send(JSON.stringify({ type: 'heartbeat', sessionId }));
    const ack = await first.next((message) => message.type === 'heartbeat.ack');
    expect(ack.session.id).toBe(sessionId);
    const after = (await TimeSession.findByPk(sessionId))!.lastHeartbeatAt.getTime();
    expect(after).toBeGreaterThan(before);

    const breakStart = await request(app)
      .post(`${API}/organizations/${orgId}/time-sessions/${sessionId}/breaks`)
      .set(agent.headers)
      .send({});
    expect(breakStart.status).toBe(201);
    const pushedBreak = await first.next(
      (message) => message.type === 'session.updated' && message.session.status === 'ON_BREAK',
    );
    expect(pushedBreak.session.activeBreak).toBeTruthy();

    await first.close();

    const second = connect(agent.headers);
    await second.opened;
    const reconnected = await second.next((message) => message.type === 'connected');
    expect(reconnected.state).toBe('ON_BREAK');
    expect(reconnected.session.id).toBe(sessionId);

    const status = await (async () => {
      second.ws.send(JSON.stringify({ type: 'session.status' }));
      return second.next((message) => message.type === 'session.status');
    })();
    expect(status.session.status).toBe('ON_BREAK');
    await second.close();
  });

  it('rejects missing, invalid, mismatched, and expired credentials', async () => {
    const { orgId, agent, auth, ownerAuth } = await createTeam();

    const missing = await connectFailure({}, 'missing');
    expect(missing.status).toBe(401);
    expect(missing.body.error.code).toBe('UNAUTHENTICATED');

    const wrong = await connectFailure(
      {
        ...agent.headers,
        'x-agent-key': 'tna_wrong-key-that-is-long-enough',
      },
      'wrong-key',
    );
    expect(wrong.status).toBe(401);
    expect(wrong.body.error.code).toBe('AGENT_CREDENTIALS_INVALID');

    const mismatched = await connectFailure(
      {
        Authorization: ownerAuth.headers.Authorization,
        'x-agent-id': agent.id,
        'x-agent-key': agent.key,
      },
      'mismatched-user',
    );
    expect(mismatched.status).toBe(403);
    expect(mismatched.body.error.code).toBe('AGENT_CONTEXT_MISMATCH');

    const started = await request(app)
      .post(`${API}/organizations/${orgId}/time-sessions/start`)
      .set(agent.headers)
      .send({});
    const sessionId = started.body.data.session.id as string;

    const live = connect(agent.headers);
    await live.opened;
    await live.next((message) => message.type === 'connected');

    await Session.update(
      { accessExpiresAt: new Date(Date.now() - 1_000) },
      {
        where: {
          accessTokenHash: hashOpaqueToken(auth.token, config.auth.tokenPepper),
        },
      },
    );

    live.ws.send(JSON.stringify({ type: 'heartbeat', sessionId }));
    const closed = await live.closed();
    expect(closed.code).toBe(4001);

    const refreshed = await desktopAuth(auth.user.email);
    const reconnected = connect({
      Authorization: `Bearer ${refreshed.token}`,
      'x-agent-id': agent.id,
      'x-agent-key': agent.key,
    });
    await reconnected.opened;
    const connected = await reconnected.next((message) => message.type === 'connected');
    expect(connected.session.id).toBe(sessionId);
    await reconnected.close();
  });

  it('delivers screenshot lifecycle messages and recovers pending requests on reconnect', async () => {
    const { orgId, agent, ownerAuth, employee, auth } = await createTeam();
    const started = await request(app)
      .post(`${API}/organizations/${orgId}/time-sessions/start`)
      .set(agent.headers)
      .send({});
    expect(started.status).toBe(201);

    const policy = await request(app)
      .patch(`${API}/admin/screenshot-policy`)
      .set({ ...ownerAuth.headers, 'x-organization-id': orgId })
      .send({
        enabled: true,
        requestCooldownSeconds: 0,
        retentionDays: 1,
        disclosureText: 'Individual screenshots may be requested during tracked work.',
      });
    expect(policy.status).toBe(200);

    const live = connect(agent.headers);
    await live.opened;
    const connected = await live.next((message) => message.type === 'connected');
    expect(connected.pendingScreenshotRequests).toEqual([]);

    const create = () =>
      request(app)
        .post(`${API}/admin/employees/${employee.user.id}/screenshot-requests`)
        .set({ ...ownerAuth.headers, 'x-organization-id': orgId })
        .send({});

    const created = await create();
    expect(created.status).toBe(201);
    expect(created.body.data.delivery.delivered).toBe(true);
    const requestId = created.body.data.request.id as string;

    const command = await live.next(
      (message) => message.type === 'screenshot.request' && message.requestId === requestId,
    );
    expect(command.requiresClaim).toBe(true);
    expect(command.maxBytes).toBe(4096);

    live.ws.send(JSON.stringify({ type: 'screenshot.ack', requestId }));
    const acknowledged = await live.next(
      (message) => message.type === 'screenshot.acknowledged' && message.requestId === requestId,
    );
    expect(acknowledged.status).toBe('PENDING');

    live.ws.send(
      JSON.stringify({ type: 'screenshot.claim', requestId, contentType: 'image/png' }),
    );
    const claimed = await live.next(
      (message) => message.type === 'screenshot.claimed' && message.requestId === requestId,
    );
    expect(claimed.status).toBe('CLAIMED');
    expect(claimed.upload.url).toContain('/api/v1/agent/screenshot-uploads/');

    const png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.alloc(24, 0x44),
    ]);
    const uploadPath = new URL(claimed.upload.url as string).pathname;
    const uploaded = await request(app)
      .put(uploadPath)
      .set(agent.headers)
      .set('x-organization-id', orgId)
      .set('content-type', 'image/png')
      .send(png);
    expect(uploaded.status).toBe(201);

    live.ws.send(
      JSON.stringify({
        type: 'screenshot.complete',
        requestId,
        captureTimestamp: new Date().toISOString(),
      }),
    );
    const completed = await live.next(
      (message) => message.type === 'screenshot.completed' && message.requestId === requestId,
    );
    expect(completed.screenshot.contentType).toBe('image/png');

    live.ws.send(JSON.stringify({ type: 'screenshot.claim', requestId }));
    const replay = await live.next(
      (message) => message.type === 'screenshot.error' && message.requestId === requestId,
    );
    expect(replay.code).toBe('SCREENSHOT_ALREADY_COMPLETED');

    await live.close();

    const pending = await create();
    expect(pending.status).toBe(201);
    expect(pending.body.data.delivery.delivered).toBe(false);
    const pendingId = pending.body.data.request.id as string;

    const reconnect = connect(agent.headers);
    await reconnect.opened;
    const recovered = await reconnect.next((message) => message.type === 'connected');
    expect(recovered.pendingScreenshotRequests).toHaveLength(1);
    expect(recovered.pendingScreenshotRequests[0].requestId).toBe(pendingId);

    const claimRecovered = await request(app)
      .post(`${API}/agent/screenshot-requests/${pendingId}/claim`)
      .set({ ...agent.headers, 'x-organization-id': orgId })
      .send({ contentType: 'image/png' });
    expect(claimRecovered.status).toBe(200);
    await reconnect.close();

    // Keep the employee variable referenced so this test also documents that
    // the agent session belongs to the target employee.
    const me = await request(app)
      .get(`${API}/screenshot-policy`)
      .set({ ...auth.headers, 'x-organization-id': orgId });
    expect(me.status).toBe(200);
  });

  it('closes live sockets and stops sessions when an agent is revoked', async () => {
    const { orgId, agent, ownerAuth } = await createTeam();
    const started = await request(app)
      .post(`${API}/organizations/${orgId}/time-sessions/start`)
      .set(agent.headers)
      .send({});
    const sessionId = started.body.data.session.id as string;

    const live = connect(agent.headers);
    await live.opened;
    await live.next((message) => message.type === 'connected');

    const revoked = await request(app)
      .delete(`${API}/organizations/${orgId}/desktop-agents/${agent.id}`)
      .set(ownerAuth.headers);
    expect(revoked.status).toBe(200);

    const closed = await live.closed();
    expect(closed.code).toBe(4003);

    const session = await TimeSession.findByPk(sessionId);
    expect(session!.status).toBe('STOPPED');
    expect(session!.endedAt).toBeTruthy();

    const reconnect = await connectFailure(agent.headers, 'revoked-agent');
    expect(reconnect.status).toBe(403);
    expect(reconnect.body.error.code).toBe('AGENT_REVOKED');
  });
});
