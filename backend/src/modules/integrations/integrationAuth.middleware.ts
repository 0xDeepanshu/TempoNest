import type { NextFunction, Request, Response } from 'express';
import { config } from '../../config/env';
import {
  IntegrationClient,
  IntegrationConnection,
  IntegrationCredential,
  Organization,
} from '../../database';
import { AppError } from '../../utils/errors';
import { hashIntegrationValue } from './integration.crypto';
import { INTEGRATION_SCOPES, type IntegrationScope } from './integration.constants';

const KNOWN_SCOPES = new Set<string>(INTEGRATION_SCOPES);

function hasAllScopes(granted: readonly string[], required: readonly IntegrationScope[]): boolean {
  return required.every((scope) => granted.includes(scope));
}

/**
 * Authenticates a partner-integration access token.
 *
 * This is a completely separate credential namespace from WorkZen user
 * sessions: an integration token can never call user-facing routes, and a
 * WorkZen session can never call the integration data API.
 */
export function requireIntegrationAuth(requiredScopes: readonly IntegrationScope[] = []) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!config.integrations.enabled) {
        return next(
          AppError.notFound('Integration API is not enabled', 'INTEGRATION_DISABLED'),
        );
      }

      const authorization = req.get('authorization');
      const match = authorization ? /^Bearer\s+(.+)$/i.exec(authorization.trim()) : null;
      if (!match?.[1]) {
        return next(
          AppError.unauthorized('Integration access token is required', 'INTEGRATION_TOKEN_REQUIRED'),
        );
      }

      const credential = await IntegrationCredential.findOne({
        where: {
          accessTokenHash: hashIntegrationValue(match[1]),
          revokedAt: null,
        },
        include: [
          {
            model: IntegrationConnection,
            as: 'connection',
            required: true,
            include: [{ model: Organization, as: 'organization', required: true }],
          },
          { model: IntegrationClient, as: 'client', required: true },
        ],
      });

      if (!credential) {
        return next(
          AppError.unauthorized('Integration access token is invalid', 'INTEGRATION_TOKEN_INVALID'),
        );
      }
      if (credential.accessExpiresAt.getTime() <= Date.now()) {
        return next(
          AppError.unauthorized('Integration access token has expired', 'INTEGRATION_TOKEN_EXPIRED'),
        );
      }

      const connection = credential.connection;
      const client = credential.client;
      const organization = connection?.organization;

      if (!connection || !client || !organization) {
        return next(
          AppError.unauthorized(
            'Integration connection is not available',
            'INTEGRATION_CONNECTION_INACTIVE',
          ),
        );
      }
      if (client.status !== 'ACTIVE') {
        return next(
          AppError.forbidden('This integration client is disabled', 'INTEGRATION_CLIENT_DISABLED'),
        );
      }
      if (connection.status !== 'ACTIVE') {
        return next(
          AppError.forbidden('This integration is not connected', 'INTEGRATION_CONNECTION_INACTIVE'),
        );
      }
      if (organization.deletedAt || organization.status !== 'ACTIVE') {
        return next(
          AppError.forbidden('This organization is not available', 'ORGANIZATION_SUSPENDED'),
        );
      }

      const scopes = credential.scopes.filter((scope) => KNOWN_SCOPES.has(scope));
      if (!hasAllScopes(scopes, requiredScopes)) {
        return next(
          AppError.forbidden(
            `This integration is missing the required scope: ${requiredScopes.join(', ')}`,
            'INTEGRATION_SCOPE_DENIED',
          ),
        );
      }

      req.integration = { client, connection, credential, organization, scopes };

      if (Date.now() - credential.lastUsedAt.getTime() > 5 * 60_000) {
        void credential.update({ lastUsedAt: new Date() }).catch(() => undefined);
      }

      next();
    } catch (error) {
      next(error);
    }
  };
}
