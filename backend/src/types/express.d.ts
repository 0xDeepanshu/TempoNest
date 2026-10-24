import type { AppError } from '../utils/errors';
import type { Organization } from '../modules/organizations/organization.model';
import type { Membership } from '../modules/memberships/membership.model';
import type { Session } from '../modules/auth/session.model';
import type { User } from '../modules/users/user.model';
import type { DesktopAgent } from '../modules/desktopAgents/desktopAgent.model';

export type AuthTransport = 'cookie' | 'bearer';

export type AuthContext = {
  user: User;
  session: Session;
  transport: AuthTransport;
};

export type OrganizationContext = {
  organization: Organization;
  membership: Membership;
};

declare global {
  namespace Express {
    interface Request {
      requestId: string;
      auth?: AuthContext;
      authError?: AppError;
      organization?: OrganizationContext;
      desktopAgent?: DesktopAgent;
    }
  }
}

export {};
