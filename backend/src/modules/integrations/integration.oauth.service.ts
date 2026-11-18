import { Op, UniqueConstraintError } from 'sequelize';
import { config } from '../../config/env';
import {
  sequelize,
  IntegrationAuthorizationCode,
  IntegrationAuthorizationRequest,
  IntegrationClient,
  IntegrationConnection,
  IntegrationCredential,
  Membership,
  Organization,
} from '../../database';
import { generateOpaqueToken, safeEqualStrings } from '../../utils/crypto';
import { AppError } from '../../utils/errors';
import { hasPermission } from '../memberships/permissions';
import type { Membership as MembershipModel } from '../memberships/membership.model';
import { recordAuditEvent, type AuditContext } from '../screenshots/audit.service';
import {
  decryptIntegrationValue,
  encryptIntegrationValue,
  hashIntegrationValue,
  redirectUriMatches,
  verifyPkceChallenge,
} from './integration.crypto';
import {
  INTEGRATION_SCOPES,
  type IntegrationScope,
} from './integration.constants';
import type {
  IntegrationClient as IntegrationClientModel,
} from './integrationClient.model';
import type { IntegrationAuthorizationRequest as IntegrationAuthorizationRequestModel } from './integrationAuthorizationRequest.model';
import type { IntegrationConnection as IntegrationConnectionModel } from './integrationConnection.model';
import type { IntegrationCredential as IntegrationCredentialModel } from './integrationCredential.model';
import type { OAuthTokenBody } from './integration.schemas';

const KNOWN_SCOPES = new Set<string>(INTEGRATION_SCOPES);

export type IssuedIntegrationTokens = {
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: Date;
  refreshExpiresAt: Date;
  scopes: string[];
  connection: IntegrationConnectionModel;
  credential: IntegrationCredentialModel;
};

export function parseRequestedScopes(value: string): IntegrationScope[] {
  const scopes = [...new Set(value.split(' ').map((scope) => scope.trim()).filter(Boolean))];
  if (scopes.length === 0) {
    throw AppError.badRequest('At least one scope is required', 'INVALID_SCOPE');
  }
  for (const scope of scopes) {
    if (!KNOWN_SCOPES.has(scope)) {
      throw AppError.badRequest(`Unsupported scope: ${scope}`, 'INVALID_SCOPE');
    }
  }
  return scopes as IntegrationScope[];
}

function assertClientAllowsScopes(
  client: IntegrationClientModel,
  scopes: readonly IntegrationScope[],
): void {
  const allowed = new Set(client.allowedScopes);
  const denied = scopes.filter((scope) => !allowed.has(scope));
  if (denied.length > 0) {
    throw AppError.badRequest(
      `The client is not allowed to request: ${denied.join(', ')}`,
      'SCOPE_NOT_ALLOWED',
    );
  }
}

export async function loadActiveClient(clientId: string): Promise<IntegrationClientModel> {
  const client = await IntegrationClient.findOne({ where: { clientId } });
  if (!client || client.status !== 'ACTIVE') {
    throw AppError.unauthorized('Unknown or disabled integration client', 'INVALID_CLIENT');
  }
  return client;
}

export function verifyClientSecret(client: IntegrationClientModel, secret: string): void {
  // Always hash the supplied value so a wrong secret takes the same path, and
  // compare in constant time.
  const supplied = hashIntegrationValue(secret);
  if (!safeEqualStrings(supplied, client.secretHash)) {
    throw AppError.unauthorized('Invalid client credentials', 'INVALID_CLIENT');
  }
}

export async function authenticateClient(clientId: string, secret: string): Promise<IntegrationClientModel> {
  const client = await loadActiveClient(clientId);
  verifyClientSecret(client, secret);
  return client;
}

export async function createAuthorizationRequest(input: {
  clientId: string;
  redirectUri: string;
  scope: string;
  state: string;
  codeChallenge: string;
  externalOrganizationId: string;
}): Promise<{
  request: IntegrationAuthorizationRequestModel;
  client: IntegrationClientModel;
  bindingToken: string;
}> {
  const client = await loadActiveClient(input.clientId);

  if (!redirectUriMatches(client.redirectUris, input.redirectUri)) {
    throw AppError.badRequest('redirect_uri is not registered for this client', 'INVALID_REDIRECT_URI');
  }

  const scopes = parseRequestedScopes(input.scope);
  assertClientAllowsScopes(client, scopes);

  const bindingToken = generateOpaqueToken();
  const expiresAt = new Date(Date.now() + config.integrations.authRequestTtlSeconds * 1000);

  try {
    const request = await IntegrationAuthorizationRequest.create({
      clientId: client.id,
      stateHash: hashIntegrationValue(input.state),
      stateCiphertext: encryptIntegrationValue(input.state),
      browserBindingHash: hashIntegrationValue(bindingToken),
      redirectUri: input.redirectUri,
      externalOrganizationId: input.externalOrganizationId,
      scopes,
      codeChallenge: input.codeChallenge,
      codeChallengeMethod: 'S256',
      status: 'PENDING',
      expiresAt,
    });

    return { request, client, bindingToken };
  } catch (error) {
    if (error instanceof UniqueConstraintError) {
      throw AppError.conflict(
        'This authorization state is already in use. Start a new authorization attempt.',
        'STATE_ALREADY_USED',
      );
    }
    throw error;
  }
}

export function browserBindingMatches(
  request: IntegrationAuthorizationRequestModel,
  rawBinding: string | undefined,
): boolean {
  if (!rawBinding) return false;
  return hashIntegrationValue(rawBinding) === request.browserBindingHash;
}

export async function loadBindingRequest(
  requestId: string,
  rawBinding: string | undefined,
): Promise<{ request: IntegrationAuthorizationRequestModel; client: IntegrationClientModel }> {
  const request = await IntegrationAuthorizationRequest.findByPk(requestId, {
    include: [{ model: IntegrationClient, as: 'client', required: true }],
  });

  if (!request || !request.client) {
    throw AppError.badRequest('Authorization request not found', 'AUTHORIZATION_REQUEST_NOT_FOUND');
  }
  if (!browserBindingMatches(request, rawBinding)) {
    throw AppError.forbidden(
      'This authorization attempt was not started in this browser',
      'AUTHORIZATION_BINDING_INVALID',
    );
  }
  if (request.status !== 'PENDING') {
    throw AppError.gone('This authorization request is no longer pending', 'AUTHORIZATION_REQUEST_USED');
  }
  if (request.expiresAt.getTime() <= Date.now()) {
    throw AppError.gone('This authorization request has expired', 'AUTHORIZATION_REQUEST_EXPIRED');
  }

  return { request, client: request.client };
}

function stateFrom(request: IntegrationAuthorizationRequestModel): string {
  return decryptIntegrationValue(request.stateCiphertext);
}

function appendQuery(url: string, params: Record<string, string>): string {
  const target = new URL(url);
  for (const [key, value] of Object.entries(params)) {
    target.searchParams.set(key, value);
  }
  return target.toString();
}

async function assertCanManageIntegration(
  userId: string,
  organizationId: string,
): Promise<MembershipModel> {
  const membership = await Membership.findOne({
    where: { userId, organizationId, status: 'ACTIVE' },
    include: [{ model: Organization, as: 'organization', required: true }],
  });

  if (!membership || !membership.organization) {
    throw AppError.forbidden(
      'You are not an active member of this organization',
      'ORGANIZATION_ACCESS_DENIED',
    );
  }
  if (membership.organization.deletedAt || membership.organization.status !== 'ACTIVE') {
    throw AppError.forbidden('This organization is not available', 'ORGANIZATION_SUSPENDED');
  }
  // integration:manage is protected and cannot be granted to custom roles or
  // manager overrides, so the built-in role is authoritative here.
  if (!hasPermission(membership.role, 'integration:manage')) {
    throw AppError.forbidden(
      'Only an owner or admin can connect this organization',
      'PERMISSION_DENIED',
    );
  }
  return membership;
}

export async function approveAuthorizationRequest(options: {
  request: IntegrationAuthorizationRequestModel;
  userId: string;
  organizationId: string;
  context?: AuditContext;
}): Promise<{ redirectUrl: string; code: string }> {
  const { request, userId, organizationId, context } = options;
  await assertCanManageIntegration(userId, organizationId);

  const code = generateOpaqueToken();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + config.integrations.authorizationCodeTtlSeconds * 1000);

  const redirectUrl = await sequelize.transaction(async (transaction) => {
    const [claimed] = await IntegrationAuthorizationRequest.update(
      {
        status: 'APPROVED',
        authorizedByUserId: userId,
        organizationId,
        decidedAt: now,
      },
      {
        where: { id: request.id, status: 'PENDING' },
        transaction,
      },
    );
    if (claimed !== 1) {
      throw AppError.gone(
        'This authorization request is no longer pending',
        'AUTHORIZATION_REQUEST_USED',
      );
    }

    await IntegrationAuthorizationCode.create(
      {
        authorizationRequestId: request.id,
        clientId: request.clientId,
        organizationId,
        authorizedByUserId: userId,
        connectionId: null,
        codeHash: hashIntegrationValue(code),
        redirectUri: request.redirectUri,
        scopes: request.scopes,
        codeChallenge: request.codeChallenge,
        codeChallengeMethod: request.codeChallengeMethod,
        expiresAt,
      },
      { transaction },
    );

    await recordAuditEvent(
      {
        organizationId,
        actorUserId: userId,
        action: 'INTEGRATION_AUTHORIZATION_APPROVED',
        entityType: 'INTEGRATION_AUTHORIZATION_REQUEST',
        entityId: request.id,
        metadata: {
          clientId: request.clientId,
          scopes: request.scopes,
        },
      },
      { transaction, context },
    );

    return appendQuery(request.redirectUri, {
      code,
      state: stateFrom(request),
    });
  });

  return { redirectUrl, code };
}

export async function denyAuthorizationRequest(options: {
  request: IntegrationAuthorizationRequestModel;
  userId: string;
  organizationId: string | null;
  context?: AuditContext;
}): Promise<{ redirectUrl: string }> {
  const { request, userId, organizationId, context } = options;
  const now = new Date();

  const redirectUrl = await sequelize.transaction(async (transaction) => {
    const [claimed] = await IntegrationAuthorizationRequest.update(
      {
        status: 'DENIED',
        authorizedByUserId: userId,
        organizationId,
        decidedAt: now,
        errorCode: 'access_denied',
      },
      { where: { id: request.id, status: 'PENDING' }, transaction },
    );
    if (claimed !== 1) {
      throw AppError.gone(
        'This authorization request is no longer pending',
        'AUTHORIZATION_REQUEST_USED',
      );
    }

    if (organizationId) {
      await recordAuditEvent(
        {
          organizationId,
          actorUserId: userId,
          action: 'INTEGRATION_AUTHORIZATION_DENIED',
          entityType: 'INTEGRATION_AUTHORIZATION_REQUEST',
          entityId: request.id,
          metadata: { clientId: request.clientId },
        },
        { transaction, context },
      );
    }

    return appendQuery(request.redirectUri, {
      error: 'access_denied',
      error_description: 'The organization declined the integration request.',
      state: stateFrom(request),
    });
  });

  return { redirectUrl };
}

async function issueCredential(options: {
  transaction: import('sequelize').Transaction;
  client: IntegrationClientModel;
  connection: IntegrationConnectionModel;
  scopes: string[];
  authorizationCodeId: string | null;
  createdByUserId: string | null;
}): Promise<{
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: Date;
  refreshExpiresAt: Date;
  credential: IntegrationCredentialModel;
}> {
  const { transaction, client, connection, scopes, authorizationCodeId, createdByUserId } = options;
  const accessToken = `wziat_${generateOpaqueToken()}`;
  const refreshToken = `wzirt_${generateOpaqueToken()}`;
  const now = new Date();
  const accessExpiresAt = new Date(now.getTime() + config.integrations.accessTokenTtlSeconds * 1000);
  const refreshExpiresAt = new Date(now.getTime() + config.integrations.refreshTokenTtlSeconds * 1000);

  const credential = await IntegrationCredential.create(
    {
      connectionId: connection.id,
      clientId: client.id,
      authorizationCodeId,
      accessTokenHash: hashIntegrationValue(accessToken),
      refreshTokenHash: hashIntegrationValue(refreshToken),
      previousRefreshTokenHash: null,
      scopes,
      accessExpiresAt,
      refreshExpiresAt,
      lastUsedAt: now,
      createdByUserId,
    },
    { transaction },
  );

  return { accessToken, refreshToken, accessExpiresAt, refreshExpiresAt, credential };
}

export async function exchangeAuthorizationCode(input: {
  body: OAuthTokenBody;
  context?: AuditContext;
}): Promise<IssuedIntegrationTokens> {
  const { body, context } = input;
  const client = await authenticateClient(body.client_id, body.client_secret);

  const codeValue = body.code;
  const redirectUriValue = body.redirect_uri;
  const verifier = body.code_verifier;
  const externalOrganizationId = body.external_organization_id;

  if (!codeValue || !redirectUriValue || !verifier || !externalOrganizationId) {
    throw AppError.badRequest('Malformed authorization_code grant', 'INVALID_GRANT');
  }

  const code = await IntegrationAuthorizationCode.findOne({
    where: { codeHash: hashIntegrationValue(codeValue) },
  });

  if (!code) {
    throw AppError.badRequest('Authorization code is invalid', 'INVALID_GRANT');
  }
  if (code.clientId !== client.id) {
    throw AppError.badRequest('Authorization code is invalid', 'INVALID_GRANT');
  }
  if (code.consumedAt) {
    // A replayed code is treated as an attack on the whole connection.
    await IntegrationCredential.update(
      { revokedAt: new Date(), revokedReason: 'AUTHORIZATION_CODE_REPLAYED' },
      { where: { authorizationCodeId: code.id, revokedAt: null } },
    );
    throw AppError.badRequest('Authorization code has already been used', 'INVALID_GRANT');
  }
  if (code.expiresAt.getTime() <= Date.now()) {
    throw AppError.badRequest('Authorization code has expired', 'INVALID_GRANT');
  }
  if (code.redirectUri !== redirectUriValue) {
    throw AppError.badRequest('redirect_uri does not match the authorization request', 'INVALID_GRANT');
  }
  if (!verifyPkceChallenge(verifier, code.codeChallenge)) {
    throw AppError.badRequest('PKCE verification failed', 'INVALID_GRANT');
  }

  const authorizationRequest = await IntegrationAuthorizationRequest.findByPk(
    code.authorizationRequestId,
    { attributes: ['externalOrganizationId'] },
  );
  if (!authorizationRequest) {
    throw AppError.badRequest('Authorization code is invalid', 'INVALID_GRANT');
  }
  // The external organization is fixed by the approved authorization attempt;
  // a different value at exchange time would silently link the wrong tenant.
  if (
    authorizationRequest.externalOrganizationId &&
    authorizationRequest.externalOrganizationId !== externalOrganizationId
  ) {
    throw AppError.badRequest(
      'external_organization_id does not match the authorization request',
      'INVALID_GRANT',
    );
  }

  const organization = await Organization.findByPk(code.organizationId);
  if (!organization || organization.deletedAt || organization.status !== 'ACTIVE') {
    throw AppError.badRequest('The organization is not available', 'INVALID_GRANT');
  }

  return sequelize.transaction(async (transaction) => {
    // Conditional consume guarantees a single exchange even under concurrency.
    const [claimed] = await IntegrationAuthorizationCode.update(
      { consumedAt: new Date() },
      { where: { id: code.id, consumedAt: null }, transaction },
    );
    if (claimed !== 1) {
      throw AppError.badRequest('Authorization code has already been used', 'INVALID_GRANT');
    }

    const now = new Date();
    const existing = await IntegrationConnection.findOne({
      where: {
        clientId: client.id,
        externalOrganizationId,
      },
      order: [
        ['createdAt', 'DESC'],
        ['id', 'ASC'],
      ],
      transaction,
      lock: transaction.LOCK.UPDATE,
    });

    let connection: IntegrationConnectionModel;
    let reauthorized = false;

    if (existing) {
      if (existing.status === 'ACTIVE' && existing.organizationId !== code.organizationId) {
        throw AppError.conflict(
          'This Flowtrium organization is already connected to a different WorkZen organization',
          'EXTERNAL_ORGANIZATION_CONFLICT',
        );
      }
      reauthorized = existing.status !== 'ACTIVE' || existing.revokedAt !== null;

      // Re-authorization invalidates every previous credential for the link.
      await IntegrationCredential.update(
        { revokedAt: now, revokedReason: 'REAUTHORIZED' },
        { where: { connectionId: existing.id, revokedAt: null }, transaction },
      );

      await existing.update(
        {
          organizationId: code.organizationId,
          status: 'ACTIVE',
          scopes: code.scopes,
          connectedByUserId: code.authorizedByUserId,
          lastAuthorizedAt: now,
          disconnectedAt: null,
          revokedAt: null,
        },
        { transaction },
      );
      connection = existing;
    } else {
      connection = await IntegrationConnection.create(
        {
          clientId: client.id,
          organizationId: code.organizationId,
          externalOrganizationId,
          status: 'ACTIVE',
          scopes: code.scopes,
          connectedByUserId: code.authorizedByUserId,
          connectedAt: now,
          lastAuthorizedAt: now,
        },
        { transaction },
      );
    }

    const issued = await issueCredential({
      transaction,
      client,
      connection,
      scopes: code.scopes,
      authorizationCodeId: code.id,
      createdByUserId: code.authorizedByUserId,
    });

    await IntegrationAuthorizationCode.update(
      { connectionId: connection.id },
      { where: { id: code.id }, transaction },
    );

    if (code.authorizedByUserId && code.organizationId) {
      await recordAuditEvent(
        {
          organizationId: code.organizationId,
          actorUserId: code.authorizedByUserId,
          action: reauthorized ? 'INTEGRATION_REAUTHORIZED' : 'INTEGRATION_CONNECTED',
          entityType: 'INTEGRATION_CONNECTION',
          entityId: connection.id,
          metadata: {
            clientId: client.clientId,
            externalOrganizationId: connection.externalOrganizationId,
            scopes: connection.scopes,
          },
        },
        { transaction, context },
      );
    }

    return {
      accessToken: issued.accessToken,
      refreshToken: issued.refreshToken,
      accessExpiresAt: issued.accessExpiresAt,
      refreshExpiresAt: issued.refreshExpiresAt,
      scopes: code.scopes,
      connection,
      credential: issued.credential,
    };
  });
}

export async function rotateRefreshToken(input: {
  body: OAuthTokenBody;
}): Promise<IssuedIntegrationTokens> {
  const client = await authenticateClient(input.body.client_id, input.body.client_secret);
  const refreshTokenValue = input.body.refresh_token;
  if (!refreshTokenValue) {
    throw AppError.badRequest('Refresh token is required', 'INVALID_GRANT');
  }
  const suppliedHash = hashIntegrationValue(refreshTokenValue);

  const credential = await IntegrationCredential.findOne({
    where: {
      [Op.or]: [{ refreshTokenHash: suppliedHash }, { previousRefreshTokenHash: suppliedHash }],
    },
    include: [
      {
        model: IntegrationConnection,
        as: 'connection',
        required: true,
        include: [{ model: Organization, as: 'organization', required: true }],
      },
    ],
  });

  if (!credential) {
    throw AppError.badRequest('Refresh token is invalid', 'INVALID_GRANT');
  }
  if (credential.clientId !== client.id) {
    throw AppError.badRequest('Refresh token is invalid', 'INVALID_GRANT');
  }

  // Reuse of an already-rotated token means the token was captured; revoke the
  // whole credential family rather than issuing another one.
  if (credential.previousRefreshTokenHash === suppliedHash) {
    await IntegrationCredential.update(
      { revokedAt: new Date(), revokedReason: 'REFRESH_TOKEN_REUSE' },
      { where: { connectionId: credential.connectionId, revokedAt: null } },
    );
    throw AppError.unauthorized('Refresh token reuse detected', 'REFRESH_TOKEN_REUSED');
  }

  if (credential.revokedAt) {
    throw AppError.badRequest('Refresh token has been revoked', 'INVALID_GRANT');
  }
  if (credential.refreshExpiresAt.getTime() <= Date.now()) {
    throw AppError.badRequest('Refresh token has expired', 'INVALID_GRANT');
  }

  const connection = credential.connection;
  if (!connection) {
    throw AppError.badRequest('Integration connection is not available', 'INVALID_GRANT');
  }
  if (connection.status !== 'ACTIVE') {
    throw AppError.forbidden('This integration is not connected', 'INTEGRATION_CONNECTION_INACTIVE');
  }
  if (connection.organization?.deletedAt || connection.organization?.status !== 'ACTIVE') {
    throw AppError.forbidden('This organization is not available', 'ORGANIZATION_SUSPENDED');
  }

  const accessToken = `wziat_${generateOpaqueToken()}`;
  const refreshToken = `wzirt_${generateOpaqueToken()}`;
  const now = new Date();
  const accessExpiresAt = new Date(now.getTime() + config.integrations.accessTokenTtlSeconds * 1000);
  const refreshExpiresAt = new Date(now.getTime() + config.integrations.refreshTokenTtlSeconds * 1000);

  return sequelize.transaction(async (transaction) => {
    const [rotated] = await IntegrationCredential.update(
      {
        accessTokenHash: hashIntegrationValue(accessToken),
        refreshTokenHash: hashIntegrationValue(refreshToken),
        previousRefreshTokenHash: suppliedHash,
        accessExpiresAt,
        refreshExpiresAt,
        lastUsedAt: now,
        rotatedAt: now,
      },
      {
        where: { id: credential.id, refreshTokenHash: suppliedHash, revokedAt: null },
        transaction,
      },
    );

    if (rotated !== 1) {
      throw AppError.badRequest('Refresh token is invalid', 'INVALID_GRANT');
    }

    await credential.reload({ transaction });

    return {
      accessToken,
      refreshToken,
      accessExpiresAt,
      refreshExpiresAt,
      scopes: credential.scopes,
      connection,
      credential,
    };
  });
}

export async function revokeIntegrationToken(input: {
  body: { token: string; client_id: string; client_secret: string };
}): Promise<void> {
  const client = await authenticateClient(input.body.client_id, input.body.client_secret);
  const tokenHash = hashIntegrationValue(input.body.token);

  const credential = await IntegrationCredential.findOne({
    where: {
      [Op.or]: [
        { accessTokenHash: tokenHash },
        { refreshTokenHash: tokenHash },
        // A rotated-out refresh token still identifies the credential family,
        // so revoking it must invalidate the current access/refresh pair too.
        { previousRefreshTokenHash: tokenHash },
      ],
    },
  });

  // Unknown or foreign tokens succeed silently to avoid a token oracle.
  if (!credential || credential.clientId !== client.id) return;
  if (credential.revokedAt) return;

  await credential.update({ revokedAt: new Date(), revokedReason: 'CLIENT_REVOKED' });
}

export function toTokenResponse(issued: IssuedIntegrationTokens) {
  return {
    access_token: issued.accessToken,
    token_type: 'Bearer' as const,
    expires_in: Math.max(0, Math.floor((issued.accessExpiresAt.getTime() - Date.now()) / 1000)),
    refresh_token: issued.refreshToken,
    refresh_expires_in: Math.max(
      0,
      Math.floor((issued.refreshExpiresAt.getTime() - Date.now()) / 1000),
    ),
    scope: issued.scopes.join(' '),
    connection: {
      id: issued.connection.id,
      organization_id: issued.connection.organizationId,
      external_organization_id: issued.connection.externalOrganizationId,
      status: issued.connection.status,
    },
  };
}

/** Exposed for the hosted page: which organizations may this user connect? */
export async function listConnectableOrganizations(userId: string) {
  const memberships = await Membership.findAll({
    where: { userId, status: 'ACTIVE' },
    include: [{ model: Organization, as: 'organization', required: true }],
    order: [['createdAt', 'ASC']],
  });

  return memberships
    .filter(
      (membership) =>
        membership.organization &&
        !membership.organization.deletedAt &&
        membership.organization.status === 'ACTIVE' &&
        hasPermission(membership.role, 'integration:manage'),
    )
    .map((membership) => ({
      id: membership.organizationId,
      name: membership.organization!.name,
    }));
}
