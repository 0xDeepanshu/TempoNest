/**
 * Roles and organization membership are assigned by the server. The renderer
 * must never treat a client-provided role or organization ID as authorization.
 */
export type UserRole = 'employee' | 'organization_admin'

export interface Organization {
  id: string
  name: string
  slug: string
}

export interface EmployeeProfile {
  id: string
  organizationId: string
  name: string
  email: string
  initials: string
  jobTitle: string
  team: string
}

export interface OrganizationMembership {
  employeeId: string
  organization: Organization
  role: UserRole
}

export interface AuthSession {
  employee: EmployeeProfile
  membership: OrganizationMembership
  authenticatedAt: string
}

export interface SignInCredentials {
  email: string
  password: string
}

export type AuthErrorCode =
  | 'invalid_email'
  | 'missing_password'
  | 'invalid_credentials'
  | 'account_disabled'
  | 'no_membership'
  | 'session_expired'
  | 'rate_limited'
  | 'unavailable'
