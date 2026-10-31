import request from 'supertest';
import { createApp } from '../src/app';
import { sequelize } from '../src/database';
import { clearLocalScreenshotStorage } from '../src/modules/screenshots/storage/localStorage';
import { clearMemoryOutbox } from '../src/utils/mailer';

export const app = createApp();

export const PASSWORD = 'CorrectHorseBatteryStaple9!';
export const API = '/api/v1';

export async function resetDatabase(): Promise<void> {
  clearMemoryOutbox();

  if (sequelize.getDialect() === 'postgres') {
    // Keep the schema (so tests can also run against a migrated database) and
    // clear data between tests.
    await sequelize.sync();
    await sequelize.query(
      'TRUNCATE TABLE password_reset_tokens, leave_ledger_entries, leave_requests, leave_balances, organization_holiday_settings, leave_holidays, leave_policies, leave_types, platform_audit_events, attendance_location_samples, attendance_location_tracking, attendance_check_ins, attendance_evidence, attendance_correction_requests, screen_live_viewers, screen_live_sessions, audit_events, screenshots, screenshot_requests, screenshot_policy_acknowledgements, screenshot_policies, agent_sync_events, activity_idle_intervals, application_classifications, organization_tracking_settings, application_activities, breaks, time_sessions, desktop_agents, sessions, invitations, memberships, custom_roles, manager_role_overrides, users, organizations RESTART IDENTITY CASCADE',
    );
    await clearLocalScreenshotStorage();
    return;
  }

  await sequelize.sync({ force: true });
  await clearLocalScreenshotStorage();
}

export function uniqueEmail(prefix = 'user'): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
}

export async function registerUser(
  email: string,
  name = 'Test User',
  password = PASSWORD,
): Promise<request.Response> {
  return request(app).post(`${API}/auth/register`).send({ name, email, password });
}

export type BrowserSession = {
  agent: ReturnType<typeof request.agent>;
  csrf: string;
  user: {
    id: string;
    email: string;
    name: string;
    status: string;
  };
  response: request.Response;
};

export async function loginBrowser(email: string, password = PASSWORD): Promise<BrowserSession> {
  const agent = request.agent(app);
  const response = await agent.post(`${API}/auth/login`).send({ email, password });
  return {
    agent,
    csrf: response.body?.data?.csrfToken as string,
    user: response.body?.data?.user,
    response,
  };
}

export async function loginDesktop(email: string, password = PASSWORD): Promise<request.Response> {
  return request(app).post(`${API}/auth/login`).send({ email, password, client: 'desktop' });
}

export async function loginMobile(email: string, password = PASSWORD): Promise<request.Response> {
  return request(app).post(`${API}/auth/login`).send({ email, password, client: 'mobile' });
}

export async function mobileAuth(email: string, password = PASSWORD) {
  const response = await loginMobile(email, password);
  if (response.status !== 200) {
    throw new Error(`Mobile login failed: ${JSON.stringify(response.body)}`);
  }
  return {
    response,
    token: response.body.data.accessToken as string,
    refreshToken: response.body.data.refreshToken as string,
    user: response.body.data.user as { id: string; name: string; email: string },
    headers: { Authorization: `Bearer ${response.body.data.accessToken}` },
  };
}

export async function desktopAuth(email: string, password = PASSWORD) {
  const response = await loginDesktop(email, password);
  if (response.status !== 200) {
    throw new Error(`Desktop login failed: ${JSON.stringify(response.body)}`);
  }
  return {
    response,
    token: response.body.data.accessToken as string,
    user: response.body.data.user as { id: string; name: string; email: string },
    headers: { Authorization: `Bearer ${response.body.data.accessToken}` },
  };
}

export type RegisteredAgent = {
  id: string;
  key: string;
  deviceId: string;
  agent: Record<string, unknown>;
  headers: {
    Authorization: string;
    'x-agent-id': string;
    'x-agent-key': string;
  };
};

export async function registerAgent(
  auth: { token: string },
  organizationId: string,
  options: {
    deviceId?: string;
    name?: string;
    platform?: string;
    clientType?: 'ELECTRON' | 'MOBILE';
  } = {},
): Promise<RegisteredAgent> {
  const deviceId = options.deviceId ?? `device-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const response = await request(app)
    .post(`${API}/organizations/${organizationId}/desktop-agents`)
    .set('Authorization', `Bearer ${auth.token}`)
    .send({
      deviceId,
      name: options.name ?? 'Test Desktop',
      platform: options.platform ?? 'win32',
      ...(options.clientType ? { clientType: options.clientType } : {}),
    });

  if (response.status !== 201) {
    throw new Error(`Agent registration failed: ${JSON.stringify(response.body)}`);
  }

  const agent = response.body.data.agent as { id: string };
  const key = response.body.data.agentKey as string;
  return {
    id: agent.id,
    key,
    deviceId,
    agent,
    headers: {
      Authorization: `Bearer ${auth.token}`,
      'x-agent-id': agent.id,
      'x-agent-key': key,
    },
  };
}

export async function createAccount(email = uniqueEmail(), name = 'Test User') {
  const registerResponse = await registerUser(email, name);
  const session = await loginBrowser(email);
  return { email, registerResponse, ...session };
}

export type OwnerContext = Awaited<ReturnType<typeof createOwner>>;

export async function createOwner(email = uniqueEmail('owner'), organizationName = 'Acme Corp') {
  const account = await createAccount(email);
  const response = await account.agent
    .post(`${API}/organizations`)
    .set('x-csrf-token', account.csrf)
    .send({ name: organizationName });

  if (response.status !== 201) {
    throw new Error(`Failed to create organization: ${JSON.stringify(response.body)}`);
  }

  return {
    ...account,
    organization: response.body.data.organization as { id: string; name: string; slug: string },
    membership: response.body.data.membership as { id: string; role: string; status: string },
  };
}

/** Owner invites a person, who accepts publicly by creating a password. */
export async function inviteAndAccept(
  owner: OwnerContext,
  options: { email?: string; role?: 'ADMIN' | 'MANAGER' | 'EMPLOYEE'; name?: string } = {},
) {
  const email = options.email ?? uniqueEmail('invitee');
  const role = options.role ?? 'EMPLOYEE';
  const name = options.name ?? 'Invited User';

  const invitationResponse = await owner.agent
    .post(`${API}/organizations/${owner.organization.id}/invitations`)
    .set('x-csrf-token', owner.csrf)
    .send({ name, email, role });

  if (invitationResponse.status !== 201) {
    throw new Error(`Failed to invite: ${JSON.stringify(invitationResponse.body)}`);
  }

  const token = invitationResponse.body.data.token as string;

  // First-time onboarding is public: the e-mailed token proves control of the
  // address, and the invitee chooses their password here.
  const agent = request.agent(app);
  const acceptResponse = await agent
    .post(`${API}/invitations/accept`)
    .send({ token, password: PASSWORD });

  if (acceptResponse.status !== 200) {
    throw new Error(`Failed to accept invitation: ${JSON.stringify(acceptResponse.body)}`);
  }

  return {
    email,
    role,
    name,
    token,
    invitation: invitationResponse.body.data.invitation,
    acceptResponse,
    response: acceptResponse,
    membership: acceptResponse.body.data.membership,
    user: acceptResponse.body.data.user,
    agent,
    csrf: acceptResponse.body.data.session?.csrfToken as string,
  };
}
