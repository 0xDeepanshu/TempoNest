import type { WebSocket } from 'ws';

type Connection = {
  ws: WebSocket;
  organizationId: string;
  userId: string;
  agentId: string;
};

/**
 * Tracks only *live* transports. Durable presence is represented by
 * desktop_agents.last_seen_at and time_sessions.last_heartbeat_at; this map is
 * intentionally process-local and is not a source of truth.
 */
export class AgentHub {
  private readonly connections = new Map<string, Set<WebSocket>>();
  private readonly metadata = new Map<WebSocket, Connection>();

  add(connection: Connection): void {
    this.metadata.set(connection.ws, connection);
    const set = this.connections.get(connection.agentId) ?? new Set<WebSocket>();
    set.add(connection.ws);
    this.connections.set(connection.agentId, set);
  }

  remove(ws: WebSocket): void {
    const connection = this.metadata.get(ws);
    if (!connection) return;
    this.metadata.delete(ws);
    const set = this.connections.get(connection.agentId);
    if (!set) return;
    set.delete(ws);
    if (set.size === 0) this.connections.delete(connection.agentId);
  }

  countForAgent(agentId: string): number {
    return this.connections.get(agentId)?.size ?? 0;
  }

  closeAgent(agentId: string, code: number, reason: string): void {
    const set = this.connections.get(agentId);
    if (!set) return;
    for (const ws of set) {
      try {
        ws.close(code, reason.slice(0, 120));
      } catch {
        // A socket may already be closing; removal happens in the close handler.
      }
    }
  }

  publishToAgent(agentId: string, payload: Record<string, unknown>): number {
    const set = this.connections.get(agentId);
    if (!set) return 0;
    const message = JSON.stringify(payload);
    let delivered = 0;
    for (const ws of set) {
      if (ws.readyState === 1) {
        try {
          ws.send(message);
          delivered += 1;
        } catch {
          // Transport failures are handled by the socket's close event.
        }
      }
    }
    return delivered;
  }

  closeAll(code: number, reason: string): void {
    for (const agentId of [...this.connections.keys()]) {
      this.closeAgent(agentId, code, reason);
    }
  }
}

export const agentHub = new AgentHub();
