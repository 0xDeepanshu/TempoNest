import { lookup } from 'node:dns/promises';
import { request as httpRequest, type RequestOptions } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import { config } from '../../config/env';

export type ResolvedAddress = { address: string; family: 4 | 6 };
export type HostResolver = (hostname: string) => Promise<ResolvedAddress[]>;

export type WebhookTransportRequest = {
  url: string;
  headers: Record<string, string>;
  body: string;
  timeoutMs: number;
};

export type WebhookTransportResponse = { status: number };

/**
 * Raised when a destination is not a permitted public endpoint. Delivery treats
 * this as permanent so an internal target is never retried in a loop.
 */
export class WebhookDestinationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WebhookDestinationError';
  }
}

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'metadata',
  'metadata.google.internal',
  'metadata.goog',
  'instance-data',
  'instance-data.ec2.internal',
]);

const BLOCKED_HOST_SUFFIXES = [
  '.localhost',
  '.local',
  '.localdomain',
  '.internal',
  '.intranet',
  '.lan',
  '.home.arpa',
  '.svc',
  '.cluster.local',
  '.ec2.internal',
];

/**
 * IPv4 ranges that are never acceptable webhook destinations: unspecified,
 * private, carrier-grade NAT, loopback, link-local (including cloud metadata),
 * documentation, benchmarking, multicast and reserved space.
 */
const BLOCKED_IPV4_RANGES: ReadonlyArray<{ network: number; prefix: number }> = [
  { network: ipv4ToNumber('0.0.0.0'), prefix: 8 },
  { network: ipv4ToNumber('10.0.0.0'), prefix: 8 },
  { network: ipv4ToNumber('100.64.0.0'), prefix: 10 },
  { network: ipv4ToNumber('127.0.0.0'), prefix: 8 },
  { network: ipv4ToNumber('169.254.0.0'), prefix: 16 },
  { network: ipv4ToNumber('172.16.0.0'), prefix: 12 },
  { network: ipv4ToNumber('192.0.0.0'), prefix: 24 },
  { network: ipv4ToNumber('192.0.2.0'), prefix: 24 },
  { network: ipv4ToNumber('192.88.99.0'), prefix: 24 },
  { network: ipv4ToNumber('192.168.0.0'), prefix: 16 },
  { network: ipv4ToNumber('198.18.0.0'), prefix: 15 },
  { network: ipv4ToNumber('198.51.100.0'), prefix: 24 },
  { network: ipv4ToNumber('203.0.113.0'), prefix: 24 },
  { network: ipv4ToNumber('224.0.0.0'), prefix: 4 },
  { network: ipv4ToNumber('240.0.0.0'), prefix: 4 },
];

function ipv4ToNumber(address: string): number {
  const parts = address.split('.').map(Number);
  const [a, b, c, d] = parts as [number, number, number, number];
  return ((a << 24) | (b << 16) | (c << 8) | d) >>> 0;
}

function masked(address: number, prefix: number): number {
  const shift = 32 - prefix;
  return shift === 0 ? 0 : (address >>> shift) << shift;
}

function isBlockedIpv4(address: string): boolean {
  const value = ipv4ToNumber(address);
  return BLOCKED_IPV4_RANGES.some(
    (range) => masked(value, range.prefix) === masked(range.network, range.prefix),
  );
}

function expandIpv6(input: string): number[] | null {
  let address = input;
  if (address.startsWith('[') && address.endsWith(']')) address = address.slice(1, -1);
  const zoneIndex = address.indexOf('%');
  if (zoneIndex !== -1) address = address.slice(0, zoneIndex);

  const halves = address.split('::');
  if (halves.length > 2) return null;

  const parseGroups = (part: string): number[] | null => {
    if (part === '') return [];
    const groups = part.split(':');
    const result: number[] = [];
    for (const group of groups) {
      if (group.includes('.')) {
        if (isIP(group) !== 4) return null;
        const octets = group.split('.').map(Number);
        result.push(((octets[0]! << 8) | octets[1]!) as number);
        result.push(((octets[2]! << 8) | octets[3]!) as number);
      } else {
        if (!/^[0-9a-fA-F]{1,4}$/.test(group)) return null;
        result.push(parseInt(group, 16));
      }
    }
    return result;
  };

  const head = parseGroups(halves[0]!);
  const tail = halves.length === 2 ? parseGroups(halves[1]!) : [];
  if (!head || !tail) return null;

  if (halves.length === 1) return head.length === 8 ? head : null;
  const missing = 8 - head.length - tail.length;
  if (missing < 1) return null;
  return [...head, ...Array<number>(missing).fill(0), ...tail];
}

function embeddedIpv4(groups: number[], offset: number): string {
  const [a, b] = [groups[offset]!, groups[offset + 1]!];
  return `${(a >> 8) & 0xff}.${a & 0xff}.${(b >> 8) & 0xff}.${b & 0xff}`;
}

/** Returns a human-readable reason when an IPv6 address is not public. */
function blockedIpv6Reason(groups: number[]): string | null {
  const first = groups[0]!;
  const second = groups[1]!;

  const allZero = groups.every((group) => group === 0);
  if (allZero) return 'unspecified address';
  if (groups.slice(0, 7).every((group) => group === 0) && groups[7] === 1) {
    return 'loopback address';
  }
  if ((first & 0xfe00) === 0xfe00) return 'link-local address';
  if ((first & 0xfe00) === 0xfc00) return 'unique-local address';
  if ((first & 0xff00) === 0xff00) return 'multicast address';
  if ((first & 0xffc0) === 0x64 && second === 0xff9b) {
    return isBlockedIpv4(embeddedIpv4(groups, 6)) ? 'NAT64-mapped private address' : null;
  }
  if (first === 0x2002) {
    return isBlockedIpv4(embeddedIpv4(groups, 1)) ? '6to4-mapped private address' : null;
  }
  if (first === 0x2001 && second === 0x0000) return 'Teredo address';
  if (first === 0x2001 && second === 0x0db8) return 'documentation address';
  if (first === 0x0100 && groups.slice(1, 4).every((group) => group === 0)) {
    return 'discard-only address';
  }
  // IPv4-mapped (::ffff:a.b.c.d) and deprecated IPv4-compatible forms.
  if (groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff) {
    return isBlockedIpv4(embeddedIpv4(groups, 6)) ? 'IPv4-mapped private address' : null;
  }
  if (groups.slice(0, 6).every((group) => group === 0)) {
    return isBlockedIpv4(embeddedIpv4(groups, 6)) ? 'IPv4-compatible private address' : null;
  }
  return null;
}

function normalizeHostname(hostname: string): string {
  let host = hostname.trim().toLowerCase();
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);
  if (host.endsWith('.')) host = host.slice(0, -1);
  return host;
}

/**
 * Synchronous check for literal hostnames and IPs. DNS names that resolve to
 * internal addresses are rejected separately at delivery time.
 */
export function webhookHostBlockReason(hostname: string): string | null {
  const host = normalizeHostname(hostname);
  const family = isIP(host);

  if (family === 4) return isBlockedIpv4(host) ? 'private or reserved IPv4 address' : null;
  if (family === 6) {
    const groups = expandIpv6(host);
    if (!groups) return 'invalid IPv6 address';
    return blockedIpv6Reason(groups);
  }

  if (BLOCKED_HOSTNAMES.has(host)) return 'internal hostname';
  if (BLOCKED_HOST_SUFFIXES.some((suffix) => host === suffix.slice(1) || host.endsWith(suffix))) {
    return 'internal hostname';
  }
  return null;
}

const defaultResolver: HostResolver = async (hostname) => {
  const addresses = await lookup(hostname, { all: true, verbatim: true });
  return addresses.map((entry) => ({
    address: entry.address,
    family: entry.family === 6 ? 6 : 4,
  }));
};

export type WebhookDestination = {
  url: URL;
  address: string;
  family: 4 | 6;
};

/**
 * Resolves and validates the destination immediately before every attempt.
 * The returned address must be pinned for the actual connection so a second
 * DNS answer cannot redirect the request to an internal host (DNS rebinding).
 */
export async function assertWebhookDestination(
  rawUrl: string | URL,
  resolve: HostResolver = defaultResolver,
): Promise<WebhookDestination> {
  let url: URL;
  try {
    url = rawUrl instanceof URL ? rawUrl : new URL(rawUrl);
  } catch {
    throw new WebhookDestinationError('Webhook destination is not a valid URL');
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new WebhookDestinationError('Webhook destination must use http or https');
  }
  if (url.username || url.password) {
    throw new WebhookDestinationError('Webhook destination must not contain credentials');
  }
  if (url.hash) {
    throw new WebhookDestinationError('Webhook destination must not contain a fragment');
  }
  if (config.isProduction && url.protocol !== 'https:') {
    throw new WebhookDestinationError('Webhook destination must use https in production');
  }

  const host = normalizeHostname(url.hostname);
  const literalReason = webhookHostBlockReason(host);
  if (literalReason) {
    throw new WebhookDestinationError(`Webhook destination is not permitted (${literalReason})`);
  }

  const literalFamily = isIP(host);
  if (literalFamily === 4 || literalFamily === 6) {
    return { url, address: host, family: literalFamily as 4 | 6 };
  }

  let addresses: ResolvedAddress[];
  try {
    addresses = await resolve(host);
  } catch {
    throw new WebhookDestinationError('Webhook destination could not be resolved');
  }
  if (addresses.length === 0) {
    throw new WebhookDestinationError('Webhook destination could not be resolved');
  }

  for (const entry of addresses) {
    const reason = webhookHostBlockReason(entry.address);
    if (reason) {
      throw new WebhookDestinationError(`Webhook destination resolves to a blocked address (${reason})`);
    }
  }

  const chosen = addresses[0]!;
  return { url, address: chosen.address, family: chosen.family };
}

type LookupCallback = (
  error: NodeJS.ErrnoException | null,
  address: string | ReadonlyArray<{ address: string; family: number }>,
  family?: number,
) => void;

/**
 * A `lookup` implementation that always yields one already-validated address,
 * so the socket cannot be redirected by a changed DNS answer.
 */
export function createPinnedLookup(address: string, family: 4 | 6) {
  return (
    _hostname: string,
    options: { all?: boolean } | LookupCallback,
    callback?: LookupCallback,
  ): void => {
    const done = (typeof options === 'function' ? options : callback)!;
    const all = typeof options === 'object' && options !== null && options.all === true;
    if (all) done(null, [{ address, family }]);
    else done(null, address, family);
  };
}

/**
 * Default outbound transport. Redirects are not followed (Node's HTTP client
 * never follows them), response bodies are discarded and only the status is
 * observed for delivery accounting.
 */
export async function deliverWebhookRequest(
  input: WebhookTransportRequest,
  resolve: HostResolver = defaultResolver,
): Promise<WebhookTransportResponse> {
  const destination = await assertWebhookDestination(input.url, resolve);
  const url = destination.url;
  const hostname = normalizeHostname(url.hostname);
  const body = Buffer.from(input.body, 'utf8');

  const requestFn = url.protocol === 'https:' ? httpsRequest : httpRequest;
  const options: RequestOptions = {
    protocol: url.protocol,
    hostname,
    port: url.port === '' ? undefined : Number(url.port),
    path: `${url.pathname}${url.search}`,
    method: 'POST',
    headers: {
      ...input.headers,
      'content-length': String(body.length),
    },
    lookup: createPinnedLookup(destination.address, destination.family) as RequestOptions['lookup'],
    // Never reuse a pooled socket: each attempt is bound to its own validated
    // address rather than an earlier connection that might be stale.
    agent: false,
    timeout: input.timeoutMs,
  };

  return new Promise<WebhookTransportResponse>((resolvePromise, rejectPromise) => {
    const request = requestFn(options, (response) => {
      response.resume();
      resolvePromise({ status: response.statusCode ?? 0 });
    });

    request.on('timeout', () => {
      request.destroy(new Error('Webhook request timed out'));
    });
    request.on('error', (error) => {
      rejectPromise(error);
    });
    request.end(body);
  });
}

export const webhookTransport: {
  deliver: (input: WebhookTransportRequest) => Promise<WebhookTransportResponse>;
} = {
  deliver: deliverWebhookRequest,
};
