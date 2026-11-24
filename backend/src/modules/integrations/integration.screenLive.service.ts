import { Op } from 'sequelize';
import {
  IntegrationEmployeeMapping,
  ScreenLiveSession,
  TimeSession,
  User,
} from '../../database';
import { agentHub } from '../../realtime/agentHub';
import { LIVE_INDICATOR_CAPABILITY } from '../../realtime/agentCapabilities';
import { AppError } from '../../utils/errors';
import { recordAuditEvent, type AuditContext } from '../screenshots/audit.service';
import { isEmployeeMonitoringEnabled } from '../screenshots/employeeMonitoringPolicy.service';
import {
  issueScreenLiveViewerTicket,
  startScreenLiveSession,
  stopScreenLiveSession,
} from '../screenshots/screenLive.service';
import { isHeartbeatFresh } from '../timeTracking/timeSession.mapper';
import type { IntegrationContext } from '../../types/express';
import { resolveVerifiedViewer } from './integration.viewerLink.service';

/**
 * Live screen API for a partner integration. Nothing here decides who may watch: every call resolves
 * the verified WorkZen owner behind the external user (link, OWNER role, permission, policy and
 * connection are all rechecked), and the existing live-screen service then applies the same monitoring
 * policy and employee-eligibility rules as for a native owner, with that owner as the actor. Sessions
 * are tied to the link that started them.
 */

export type EmployeeAvailability =
  | 'AVAILABLE'
  | 'NOT_TRACKING'
  | 'MONITORING_DISABLED'
  | 'AGENT_OFFLINE'
  | 'APP_UPDATE_REQUIRED';

async function auditDenied(options: {
  integration: IntegrationContext;
  externalUserId: string;
  reason: string;
  sessionId?: string | null;
  targetEmployeeId?: string | null;
  context?: AuditContext;
}): Promise<void> {
  try {
    await recordAuditEvent(
      {
        organizationId: options.integration.connection.organizationId,
        actorUserId: null,
        targetEmployeeId: options.targetEmployeeId ?? null,
        action: 'SCREEN_LIVE_ACCESS_DENIED',
        entityType: 'SCREEN_LIVE_SESSION',
        entityId: options.sessionId ?? null,
        metadata: {
          via: 'integration',
          reason: options.reason,
          connectionId: options.integration.connection.id,
          clientId: options.integration.client.clientId,
          externalOrganizationId: options.integration.connection.externalOrganizationId,
          externalUserId: options.externalUserId,
        },
      },
      { context: options.context },
    );
  } catch {
    // A failed audit write must not change the authorization outcome.
  }
}

/** Resolves the verified owner for this request, recording a denial when it cannot be resolved. */
async function authorizeViewer(
  integration: IntegrationContext,
  externalUserId: string,
  context?: AuditContext,
) {
  try {
    return await resolveVerifiedViewer({
      connectionId: integration.connection.id,
      externalUserId,
      context,
    });
  } catch (error) {
    if (error instanceof AppError) {
      await auditDenied({ integration, externalUserId, reason: error.code, context });
    }
    throw error;
  }
}

async function loadOwnedSession(options: {
  integration: IntegrationContext;
  linkId: string;
  organizationId: string;
  sessionId: string;
}): Promise<ScreenLiveSession> {
  const session = await ScreenLiveSession.findOne({
    where: {
      id: options.sessionId,
      organizationId: options.organizationId,
      origin: 'INTEGRATION',
      integrationConnectionId: options.integration.connection.id,
      integrationViewerLinkId: options.linkId,
    },
  });
  // Another viewer's, another connection's and a non-existent session all read the same.
  if (!session) {
    throw AppError.notFound('Live screen session not found', 'SCREEN_LIVE_SESSION_NOT_FOUND');
  }
  return session;
}

function sessionView(session: ScreenLiveSession, externalEmployeeId: string | null) {
  return {
    id: session.id,
    status: session.status,
    externalEmployeeId,
    startedAt: session.startedAt.toISOString(),
    expiresAt: session.expiresAt.toISOString(),
    endedAt: session.endedAt ? session.endedAt.toISOString() : null,
    terminationReason: session.terminationReason,
    indicator: {
      required: true,
      confirmed: session.indicatorConfirmedAt !== null,
      confirmedAt: session.indicatorConfirmedAt ? session.indicatorConfirmedAt.toISOString() : null,
    },
  };
}

async function externalEmployeeIdFor(
  integration: IntegrationContext,
  employeeId: string,
): Promise<string | null> {
  const mapping = await IntegrationEmployeeMapping.findOne({
    where: { connectionId: integration.connection.id, workzenUserId: employeeId, status: 'ACTIVE' },
    attributes: ['externalEmployeeId'],
  });
  return mapping?.externalEmployeeId ?? null;
}

export async function listLiveScreenEmployees(options: {
  integration: IntegrationContext;
  externalUserId: string;
  context?: AuditContext;
}) {
  const { integration } = options;
  const { link } = await authorizeViewer(integration, options.externalUserId, options.context);

  const mappings = await IntegrationEmployeeMapping.findAll({
    where: {
      connectionId: integration.connection.id,
      organizationId: link.organizationId,
      status: 'ACTIVE',
      workzenUserId: { [Op.ne]: null },
    },
    order: [['externalEmployeeId', 'ASC']],
    limit: 200,
  });
  const ids = mappings.map((mapping) => mapping.workzenUserId!).filter(Boolean);
  if (ids.length === 0) return [];

  const [users, timeSessions] = await Promise.all([
    User.findAll({ where: { id: { [Op.in]: ids } }, attributes: ['id', 'name'] }),
    TimeSession.findAll({
      where: {
        organizationId: link.organizationId,
        employeeId: { [Op.in]: ids },
        status: 'ACTIVE',
        endedAt: null,
      },
      attributes: ['employeeId', 'desktopAgentId', 'lastHeartbeatAt'],
    }),
  ]);
  const names = new Map(users.map((user) => [user.id, user.name]));
  const tracking = new Map(timeSessions.map((session) => [session.employeeId, session]));
  const now = new Date();

  const rows = [];
  for (const mapping of mappings) {
    const employeeId = mapping.workzenUserId!;
    const time = tracking.get(employeeId);
    let availability: EmployeeAvailability;
    if (!(await isEmployeeMonitoringEnabled(link.organizationId, employeeId))) {
      availability = 'MONITORING_DISABLED';
    } else if (!time || !isHeartbeatFresh(time.lastHeartbeatAt, now)) {
      availability = 'NOT_TRACKING';
    } else if (!time.desktopAgentId || agentHub.countForAgent(time.desktopAgentId) === 0) {
      availability = 'AGENT_OFFLINE';
    } else if (!agentHub.agentHasCapability(time.desktopAgentId, LIVE_INDICATOR_CAPABILITY)) {
      availability = 'APP_UPDATE_REQUIRED';
    } else {
      availability = 'AVAILABLE';
    }
    rows.push({
      externalEmployeeId: mapping.externalEmployeeId,
      displayName: names.get(employeeId) ?? null,
      availability,
    });
  }
  return rows;
}

export async function startIntegrationLiveSession(options: {
  integration: IntegrationContext;
  externalUserId: string;
  externalEmployeeId: string;
  context?: AuditContext;
}) {
  const { integration, externalUserId, context } = options;
  const { link, membership } = await authorizeViewer(integration, externalUserId, context);

  // Only a confirmed mapping in this connection and organization can name an employee. An arbitrary
  // WorkZen user id is never accepted.
  const mapping = await IntegrationEmployeeMapping.findOne({
    where: {
      connectionId: integration.connection.id,
      organizationId: link.organizationId,
      externalEmployeeId: options.externalEmployeeId,
      status: 'ACTIVE',
      workzenUserId: { [Op.ne]: null },
    },
  });
  if (!mapping?.workzenUserId) {
    await auditDenied({ integration, externalUserId, reason: 'EMPLOYEE_NOT_MAPPED', context });
    throw AppError.notFound('This employee is not mapped to a WorkZen employee', 'EMPLOYEE_NOT_MAPPED');
  }

  const result = await startScreenLiveSession({
    organizationId: link.organizationId,
    employeeId: mapping.workzenUserId,
    actorUserId: link.workzenUserId,
    actorRole: membership.role,
    integration: {
      connectionId: integration.connection.id,
      viewerLinkId: link.id,
      externalOrganizationId: integration.connection.externalOrganizationId,
      externalUserId,
      clientId: integration.client.clientId,
    },
    context,
  });

  const row = await ScreenLiveSession.findByPk(result.session.id);
  if (!row) throw AppError.notFound('Live screen session not found', 'SCREEN_LIVE_SESSION_NOT_FOUND');
  return {
    session: sessionView(row, mapping.externalEmployeeId),
    reused: result.reused,
    delivery: { agentOnline: result.agentOnline, delivered: result.delivered },
  };
}

export async function getIntegrationLiveSession(options: {
  integration: IntegrationContext;
  externalUserId: string;
  sessionId: string;
  context?: AuditContext;
}) {
  const { link } = await authorizeViewer(options.integration, options.externalUserId, options.context);
  const session = await loadOwnedSession({
    integration: options.integration,
    linkId: link.id,
    organizationId: link.organizationId,
    sessionId: options.sessionId,
  });
  return sessionView(session, await externalEmployeeIdFor(options.integration, session.employeeId));
}

export async function issueIntegrationViewerTicket(options: {
  integration: IntegrationContext;
  externalUserId: string;
  sessionId: string;
  context?: AuditContext;
}) {
  const { integration, externalUserId, context } = options;
  const { link, membership } = await authorizeViewer(integration, externalUserId, context);
  const session = await loadOwnedSession({
    integration,
    linkId: link.id,
    organizationId: link.organizationId,
    sessionId: options.sessionId,
  });

  const issued = await issueScreenLiveViewerTicket({
    organizationId: link.organizationId,
    sessionId: session.id,
    actorUserId: link.workzenUserId,
    actorRole: membership.role,
    integrationViewerLinkId: link.id,
    context,
  });

  await recordAuditEvent(
    {
      organizationId: link.organizationId,
      actorUserId: link.workzenUserId,
      targetEmployeeId: session.employeeId,
      action: 'SCREEN_LIVE_TICKET_ISSUED',
      entityType: 'SCREEN_LIVE_SESSION',
      entityId: session.id,
      metadata: {
        via: 'integration',
        viewerId: issued.viewer.id,
        ticketExpiresAt: issued.expiresAt.toISOString(),
        connectionId: integration.connection.id,
        clientId: integration.client.clientId,
        integrationViewerLinkId: link.id,
        externalOrganizationId: integration.connection.externalOrganizationId,
        externalUserId,
      },
    },
    { context },
  );

  // The ticket is single use and short lived. It is the only credential the browser receives.
  return {
    ticket: issued.ticket,
    expiresAt: issued.expiresAt.toISOString(),
    websocketPath: issued.websocketPath,
    viewerId: issued.viewer.id,
  };
}

export async function stopIntegrationLiveSession(options: {
  integration: IntegrationContext;
  externalUserId: string;
  sessionId: string;
  context?: AuditContext;
}) {
  const { integration, externalUserId, context } = options;
  const { link, membership } = await authorizeViewer(integration, externalUserId, context);
  const session = await loadOwnedSession({
    integration,
    linkId: link.id,
    organizationId: link.organizationId,
    sessionId: options.sessionId,
  });
  const result = await stopScreenLiveSession({
    organizationId: link.organizationId,
    sessionId: session.id,
    actorUserId: link.workzenUserId,
    actorRole: membership.role,
    context,
  });
  const row = await ScreenLiveSession.findByPk(session.id);
  return {
    session: sessionView(row ?? session, await externalEmployeeIdFor(integration, session.employeeId)),
    stopped: result.stopped,
  };
}
