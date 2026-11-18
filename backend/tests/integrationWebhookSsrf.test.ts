import { describe, expect, it } from 'vitest';
import {
  assertWebhookDestination,
  createPinnedLookup,
  deliverWebhookRequest,
  WebhookDestinationError,
  webhookHostBlockReason,
  type ResolvedAddress,
} from '../src/modules/integrations/integration.webhookTransport';

const publicResolver = async (): Promise<ResolvedAddress[]> => [
  { address: '93.184.216.34', family: 4 },
];

const internalDestinations = [
  'http://127.0.0.1/hook',
  'http://127.10.20.30/hook',
  'http://10.1.2.3/hook',
  'http://172.16.5.4/hook',
  'http://172.31.255.255/hook',
  'http://192.168.10.10/hook',
  'http://169.254.169.254/latest/meta-data/',
  'http://100.100.100.200/latest/meta-data/',
  'http://192.0.0.10/hook',
  'http://198.18.0.1/hook',
  'http://224.0.0.1/hook',
  'http://0.0.0.0/hook',
  'http://2130706433/hook',
  'http://0x7f000001/hook',
  'https://[::1]/hook',
  'https://[::]/hook',
  'https://[fd00:ec2::254]/hook',
  'https://[fe80::1]/hook',
  'https://[::ffff:169.254.169.254]/hook',
  'https://[2002:a00:1::]/hook',
  'https://localhost/hook',
  'https://api.localhost/hook',
  'https://metadata.google.internal/computeMetadata/v1/',
  'https://instance-data/latest/',
  'https://printer.local/hook',
  'https://billing.internal/hook',
  'https://box.lan/hook',
  'https://router.home.arpa/hook',
];

describe('webhook SSRF protections', () => {
  it.each(internalDestinations)('rejects internal destination %s', async (url) => {
    await expect(assertWebhookDestination(url, publicResolver)).rejects.toBeInstanceOf(
      WebhookDestinationError,
    );
  });

  it('rejects destinations that resolve to private, loopback or metadata addresses', async () => {
    for (const address of [
      '10.1.2.3',
      '127.0.0.1',
      '169.254.169.254',
      '100.100.100.200',
      '192.168.0.5',
      '::1',
      'fd00:ec2::254',
      'fe80::1234',
      '::ffff:169.254.169.254',
    ]) {
      const family = address.includes(':') ? 6 : 4;
      await expect(
        assertWebhookDestination('https://partner.example.com/hook', async () => [
          { address, family: family as 4 | 6 },
        ]),
      ).rejects.toBeInstanceOf(WebhookDestinationError);
    }
  });

  it('rejects when any resolved address is private', async () => {
    await expect(
      assertWebhookDestination('https://partner.example.com/hook', async () => [
        { address: '93.184.216.34', family: 4 },
        { address: '192.168.1.20', family: 4 },
      ]),
    ).rejects.toBeInstanceOf(WebhookDestinationError);
  });

  it('rejects unresolved destinations', async () => {
    await expect(
      assertWebhookDestination('https://partner.example.com/hook', async () => []),
    ).rejects.toBeInstanceOf(WebhookDestinationError);

    await expect(
      assertWebhookDestination('https://partner.example.com/hook', async () => {
        throw new Error('ENOTFOUND');
      }),
    ).rejects.toBeInstanceOf(WebhookDestinationError);
  });

  it('accepts and pins a public resolution', async () => {
    const destination = await assertWebhookDestination(
      'https://partner.example.com/hook',
      publicResolver,
    );
    expect(destination.address).toBe('93.184.216.34');
    expect(destination.family).toBe(4);
    expect(destination.url.hostname).toBe('partner.example.com');
  });

  it('pins the validated address so a second DNS answer cannot be used', async () => {
    const lookup = createPinnedLookup('93.184.216.34', 4);
    const single = await new Promise<{ address: unknown; family?: number }>((resolve, reject) => {
      lookup('redefined.example.com', {}, (error, address, family) => {
        if (error) reject(error);
        else resolve({ address, family });
      });
    });
    expect(single).toEqual({ address: '93.184.216.34', family: 4 });

    const all = await new Promise<unknown>((resolve, reject) => {
      lookup('redefined.example.com', { all: true }, (error, addresses) => {
        if (error) reject(error);
        else resolve(addresses);
      });
    });
    expect(all).toEqual([{ address: '93.184.216.34', family: 4 }]);
  });

  it('blocks at delivery time, not only when the subscription is saved', async () => {
    await expect(
      deliverWebhookRequest(
        {
          url: 'http://169.254.169.254/latest/meta-data/',
          headers: {},
          body: '{}',
          timeoutMs: 1_000,
        },
        publicResolver,
      ),
    ).rejects.toBeInstanceOf(WebhookDestinationError);
  });

  it('classifies literal hosts and addresses', () => {
    expect(webhookHostBlockReason('169.254.169.254')).toBeTruthy();
    expect(webhookHostBlockReason('[fd00:ec2::254]')).toBeTruthy();
    expect(webhookHostBlockReason('LOCALHOST')).toBeTruthy();
    expect(webhookHostBlockReason('metadata.google.internal')).toBeTruthy();
    expect(webhookHostBlockReason('partner.example.com')).toBeNull();
    expect(webhookHostBlockReason('93.184.216.34')).toBeNull();
  });
});
