import { randomBytes } from 'node:crypto';
import { connectDatabase, disconnectDatabase, IntegrationClient } from '../src/database';
import {
  assertIntegrationRedirectUri,
  generateOpaqueToken,
  hashIntegrationValue,
} from '../src/modules/integrations/integration.crypto';
import {
  INTEGRATION_SCOPES,
  type IntegrationScope,
} from '../src/modules/integrations/integration.constants';

const USAGE = [
  'Usage:',
  '  npm run integration:client -- create --name "Flowtrium" \\',
  '      --redirect-uri https://app.flowtrium.com/api/workzen/callback \\',
  '      [--redirect-uri <more>] [--scopes attendance:read,employees:read]',
  '  npm run integration:client -- list',
  '  npm run integration:client -- rotate <clientId>',
  '  npm run integration:client -- disable <clientId>',
  '  npm run integration:client -- enable <clientId>',
  '',
  'Creates the OAuth client that Flowtrium authenticates with. The client',
  'secret is printed exactly once and only its keyed hash is stored. This is a',
  'trusted server-side operation: the integration API stays dark until',
  'INTEGRATION_ENABLED=true and a client exists.',
].join('\n');

type CreateOptions = {
  name: string;
  redirectUris: string[];
  scopes: IntegrationScope[];
};

function parseOptions(args: string[]): CreateOptions {
  const options: CreateOptions = { name: '', redirectUris: [], scopes: [] };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const value = args[index + 1];
    if (arg === '--name' && value) {
      options.name = value.trim();
      index += 1;
    } else if (arg === '--redirect-uri' && value) {
      options.redirectUris.push(value.trim());
      index += 1;
    } else if (arg === '--scopes' && value) {
      options.scopes = value
        .split(',')
        .map((scope) => scope.trim())
        .filter(Boolean) as IntegrationScope[];
      index += 1;
    } else {
      throw new Error(`Unknown or incomplete argument: ${arg}`);
    }
  }

  if (!options.name) throw new Error('--name is required');
  if (options.redirectUris.length === 0) throw new Error('At least one --redirect-uri is required');
  if (options.scopes.length === 0) {
    options.scopes = ['attendance:read', 'employees:read'];
  }

  const known = new Set<string>(INTEGRATION_SCOPES);
  const unknown = options.scopes.filter((scope) => !known.has(scope));
  if (unknown.length > 0) {
    throw new Error(
      `Unsupported scope(s): ${unknown.join(', ')}. Allowed: ${INTEGRATION_SCOPES.join(', ')}`,
    );
  }

  for (const redirectUri of options.redirectUris) {
    assertIntegrationRedirectUri(redirectUri);
  }

  return options;
}

async function createClient(args: string[]): Promise<void> {
  const options = parseOptions(args);
  const clientId = `wzc_${randomBytes(12).toString('hex')}`;
  const secret = `wzcs_${generateOpaqueToken()}`;

  const client = await IntegrationClient.create({
    clientId,
    name: options.name,
    description: null,
    redirectUris: options.redirectUris,
    allowedScopes: options.scopes,
    secretHash: hashIntegrationValue(secret),
    status: 'ACTIVE',
    lastSecretRotatedAt: new Date(),
  });

  console.log(`Created integration client ${client.clientId} (${client.name})`);
  console.log(`  client_id:     ${client.clientId}`);
  console.log(`  client_secret: ${secret}`);
  console.log(`  redirect_uris: ${options.redirectUris.join(', ')}`);
  console.log(`  scopes:        ${options.scopes.join(' ')}`);
  console.log('Store the client secret now: it is not recoverable from the database.');
}

async function listClients(): Promise<void> {
  const clients = await IntegrationClient.findAll({
    order: [
      ['createdAt', 'ASC'],
      ['id', 'ASC'],
    ],
  });
  if (clients.length === 0) {
    console.log('No integration clients exist.');
    return;
  }
  for (const client of clients) {
    console.log(
      [
        client.clientId,
        client.status,
        JSON.stringify(client.name),
        `scopes=[${client.allowedScopes.join(',')}]`,
        `redirects=[${client.redirectUris.join(',')}]`,
      ].join('  '),
    );
  }
}

async function loadClient(clientId: string | undefined): Promise<IntegrationClient> {
  if (!clientId) throw new Error('clientId is required');
  const client = await IntegrationClient.findOne({ where: { clientId } });
  if (!client) throw new Error(`No integration client with client_id ${clientId}`);
  return client;
}

async function rotateSecret(clientId: string | undefined): Promise<void> {
  const client = await loadClient(clientId);
  const secret = `wzcs_${generateOpaqueToken()}`;
  await client.update({
    secretHash: hashIntegrationValue(secret),
    lastSecretRotatedAt: new Date(),
  });
  console.log(`Rotated client secret for ${client.clientId}`);
  console.log(`  client_secret: ${secret}`);
  console.log('Previous credentials remain valid until they expire or are revoked.');
}

async function setStatus(clientId: string | undefined, status: 'ACTIVE' | 'DISABLED'): Promise<void> {
  const client = await loadClient(clientId);
  await client.update({ status });
  console.log(`Integration client ${client.clientId} is now ${status}`);
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  if (!command || command === 'help' || command === '--help') {
    console.log(USAGE);
    return;
  }

  await connectDatabase();
  try {
    switch (command) {
      case 'create':
        await createClient(args);
        break;
      case 'list':
        await listClients();
        break;
      case 'rotate':
        await rotateSecret(args[0]);
        break;
      case 'disable':
        await setStatus(args[0], 'DISABLED');
        break;
      case 'enable':
        await setStatus(args[0], 'ACTIVE');
        break;
      default:
        throw new Error(`Unknown command: ${command}`);
    }
  } finally {
    await disconnectDatabase();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  console.error('');
  console.error(USAGE);
  process.exitCode = 1;
});
