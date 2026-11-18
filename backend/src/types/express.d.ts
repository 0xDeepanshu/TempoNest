import type { AppError } from '../utils/errors';
import type { Organization } from '../modules/organizations/organization.model';
import type { Membership } from '../modules/memberships/membership.model';
import type { PermissionSubject } from '../modules/memberships/permissions';
import type { Session } from '../modules/auth/session.model';
import type { User } from '../modules/users/user.model';
import type { DesktopAgent } from '../modules/desktopAgents/desktopAgent.model';
import type { IntegrationClient } from '../modules/integrations/integrationClient.model';
import type { IntegrationConnection } from '../modules/integrations/integrationConnection.model';
import type { IntegrationCredential } from '../modules/integrations/integrationCredential.model';

export type AuthTransport = 'cookie' | 'bearer';

export type AuthContext = {
  user: User;
  session: Session;
  transport: AuthTransport;
};

export type OrganizationContext = {
  organization: Organization;
  membership: Membership;
  /** Effective permissions resolved from the built-in role plus any custom role. */
  effective: PermissionSubject;
};

/** Authenticated partner-integration request context. Never a WorkZen session. */
export type IntegrationContext = {
  client: IntegrationClient;
  connection: IntegrationConnection;
  credential: IntegrationCredential;
  organization: Organization;
  scopes: readonly string[];
};

declare global {
  namespace Express {
    interface Request {
      requestId: string;
      auth?: AuthContext;
      authError?: AppError;
      organization?: OrganizationContext;
      desktopAgent?: DesktopAgent;
      integration?: IntegrationContext;
    }
  }
}

export {};
