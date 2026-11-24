/**
 * Capabilities a desktop agent advertises on its WebSocket upgrade (`X-Agent-Capabilities`, a
 * comma-separated list). They describe what the installed app can do, so they are read from the live
 * connection and never from the registration record, which goes stale when the app auto-updates.
 *
 * A capability is the agent's own statement. The agent key authenticates the device, and the signed
 * desktop app is what honours the statement; WorkZen additionally requires the agent to confirm the
 * indicator is visible before any frame is forwarded (see screenLiveRelay).
 */
export const LIVE_INDICATOR_CAPABILITY = 'live-indicator.v1';

/** Header the agent sends on the screen-stream upgrade for the same statement. */
export const LIVE_INDICATOR_STREAM_HEADER = 'x-live-indicator';
export const LIVE_INDICATOR_STREAM_VALUE = 'v1';

export function parseAgentCapabilities(value: string | string[] | undefined): ReadonlySet<string> {
  const raw = Array.isArray(value) ? value.join(',') : (value ?? '');
  const out = new Set<string>();
  for (const part of raw.split(',')) {
    const item = part.trim().toLowerCase();
    if (/^[a-z0-9][a-z0-9._-]{0,63}$/.test(item)) out.add(item);
    if (out.size >= 16) break;
  }
  return out;
}
