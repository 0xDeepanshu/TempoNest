export type ScreenLiveSessionEndedEvent = {
  sessionId: string;
  organizationId: string;
  agentId: string;
  reason: string;
};

type Listener = (event: ScreenLiveSessionEndedEvent) => void;

const listeners = new Set<Listener>();

/**
 * Decouples the durable lifecycle service from live transports. The service
 * commits the database transition first, then notifies whichever relay is
 * attached in this process; no frame data or ticket material is included.
 */
export function onScreenLiveSessionEnded(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function emitScreenLiveSessionEnded(event: ScreenLiveSessionEndedEvent): void {
  for (const listener of listeners) {
    try {
      listener(event);
    } catch {
      // A broken transport must not roll back or mask the durable transition.
    }
  }
}
