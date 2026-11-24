import { Op, UniqueConstraintError, type Transaction } from 'sequelize';
import {
  DesktopAgent,
  Membership,
  Organization,
  ScreenLiveSession,
  ScreenLiveViewer,
  TimeSession,
  User,
  sequelize,
  IntegrationClient,
  IntegrationConnection,
  IntegrationCredential,
  IntegrationViewerLink,
} from '../../database';
import { config } from '../../config/env';
import { logger } from '../../config/logger';
import { generateOpaqueToken, hashOpaqueToken } from '../../utils/crypto';
import { AppError } from '../../utils/errors';
import { serializeByKey } from '../../utils/serialize';
import { agentHub } from '../../realtime/agentHub';
import { LIVE_INDICATOR_CAPABILITY } from '../../realtime/agentCapabilities';
import { isAgentOnline } from '../desktopAgents/desktopAgent.mapper';
import { hasPermission } from '../memberships/permissions';
import type { Role } from '../memberships/roles';
import { isHeartbeatFresh } from '../timeTracking/timeSession.mapper';
import type { DesktopAgent as DesktopAgentModel } from '../desktopAgents/desktopAgent.model';
import type {
  ScreenLiveSession as ScreenLiveSessionModel,
  ScreenLiveTerminationReason,
} from './screenLiveSession.model';
import { isActiveScreenLiveSession } from './screenLiveSession.model';
import type { ScreenLiveViewer as ScreenLiveViewerModel } from './screenLiveViewer.model';
import { recordAuditEvent, type AuditContext } from './audit.service';
import {
  assertEmployeePolicyAcknowledgement,
  getOrCreateScreenshotPolicy,
} from './screenshotPolicy.service';
import {
  assertEmployeeMonitoringEnabled,
  EMPLOYEE_MONITORING_DISABLED,
  isEmployeeMonitoringEnabled,
} from './employeeMonitoringPolicy.service';
import {
  toScreenLivePendingSession,
  toScreenLiveSessionSummary,
  toScreenLiveStartCommand,
  toScreenLiveViewerSummary,
} from './screenLive.mapper';
import { emitScreenLiveSessionEnded } from './screenLiveEvents';

const SESSION_INCLUDES = [
  { model: User, as: 'employee', required: false, attributes: ['id', 'name', 'email'] },
  { model: User, as: 'startedBy', required: false, attributes: ['id', 'name', 'email'] },
  { model: DesktopAgent, as: 'desktopAgent', required: false },
];

function isLiveCapable(role: Role): boolean {
  return hasPermission(role, 'screenshot:live');
}

function assertScreenLiveStartAllowed(
  policy: Awaited<ReturnType<typeof getOrCreateScreenshotPolicy>>,
  role: Role,
): void {
  if (!policy.enabled) {
    throw AppError.forbidden(
      'Live screen viewing is disabled by this organization',
      'SCREEN_LIVE_POLICY_DISABLED',
    );
  }
  if (!isLiveCapable(role)) {
    throw AppError.forbidden('Your role cannot view live screens', 'PERMISSION_DENIED');
  }
  if (!policy.requestRoles.includes(role)) {
    throw AppError.forbidden(
      'The monitoring policy does not permit your role to start live viewing',
      'SCREEN_LIVE_ROLE_NOT_ALLOWED',
    );
  }
}

function assertScreenLiveViewAllowed(
  policy: Awaited<ReturnType<typeof getOrCreateScreenshotPolicy>>,
  role: Role,
): void {
  if (!policy.enabled) {
    throw AppError.forbidden(
      'Live screen viewing is disabled by this organization',
      'SCREEN_LIVE_POLICY_DISABLED',
    );
  }
  if (!isLiveCapable(role)) {
    throw AppError.forbidden('Your role cannot view live screens', 'PERMISSION_DENIED');
  }
  if (!policy.viewRoles.includes(role)) {
    throw AppError.forbidden(
      'The monitoring policy does not permit your role to view live screens',
      'SCREEN_LIVE_ROLE_NOT_ALLOWED',
    );
  }
}

export async function loadScreenLiveSession(
  sessionId: string,
  organizationId: string,
): Promise<ScreenLiveSessionModel> {
  const session = await ScreenLiveSession.findOne({
    where: { id: sessionId, organizationId },
    include: SESSION_INCLUDES,
  });
  if (!session) {
    throw AppError.notFound('Live screen session not found', 'SCREEN_LIVE_SESSION_NOT_FOUND');
  }
  return session;
}

/**
 * Resolves the employee, active time session, and desktop agent that a live
 * session would attach to. The employee row is locked so concurrent start
 * attempts and time-session transitions serialize on the same record.
 */
async function resolveLiveTarget(
  organizationId: string,
  employeeId: string,
  now: Date,
  transaction?: Transaction,
) {
  const employee = await User.findByPk(employeeId, {
    ...(transaction ? { transaction, lock: transaction.LOCK.UPDATE } : {}),
    attributes: ['id', 'status'],
  });
  if (!employee || employee.status !== 'ACTIVE') {
    throw AppError.notFound('Employee not found', 'EMPLOYEE_NOT_FOUND');
  }

  const membership = await Membership.findOne({
    where: { organizationId, userId: employeeId, status: 'ACTIVE' },
    ...(transaction ? { transaction } : {}),
    attributes: ['id'],
  });
  if (!membership) {
    // Cross-organization identifiers are deliberately indistinguishable from
    // identifiers that do not exist.
    throw AppError.notFound('Employee not found', 'EMPLOYEE_NOT_FOUND');
  }

  const timeSession = await TimeSession.findOne({
    where: {
      organizationId,
      employeeId,
      status: 'ACTIVE',
      endedAt: null,
      desktopAgentId: { [Op.ne]: null },
    },
    ...(transaction ? { transaction, lock: transaction.LOCK.UPDATE } : {}),
    order: [['startedAt', 'DESC']],
  });
  if (
    !timeSession ||
    !timeSession.desktopAgentId ||
    !isHeartbeatFresh(timeSession.lastHeartbeatAt, now)
  ) {
    throw AppError.conflict(
      'The employee does not have an eligible active time session',
      'NO_ELIGIBLE_SCREEN_LIVE_SESSION',
    );
  }

  const agent = await DesktopAgent.findOne({
    where: {
      id: timeSession.desktopAgentId,
      organizationId,
      userId: employeeId,
      revokedAt: null,
    },
    ...(transaction ? { transaction } : {}),
  });
  if (!agent || agent.clientType !== 'ELECTRON') {
    throw AppError.conflict(
      'The employee does not have a valid desktop agent',
      'INVALID_SCREEN_LIVE_AGENT',
    );
  }

  return { employee, agent, timeSession };
}

async function isSessionTargetStillEligible(
  session: ScreenLiveSessionModel,
  now: Date,
): Promise<boolean> {
  const [timeSession, agent] = await Promise.all([
    TimeSession.findOne({
      where: {
        id: session.timeSessionId,
        organizationId: session.organizationId,
        employeeId: session.employeeId,
        status: 'ACTIVE',
        endedAt: null,
        desktopAgentId: session.desktopAgentId,
      },
      attributes: ['id', 'lastHeartbeatAt'],
    }),
    DesktopAgent.findOne({
      where: {
        id: session.desktopAgentId,
        organizationId: session.organizationId,
        userId: session.employeeId,
        revokedAt: null,
      },
      attributes: ['id', 'clientType'],
    }),
  ]);

  return Boolean(
    timeSession &&
      agent &&
      agent.clientType === 'ELECTRON' &&
      isHeartbeatFresh(timeSession.lastHeartbeatAt, now),
  );
}

async function deliverStartToAgent(
  session: ScreenLiveSessionModel,
): Promise<{ agentOnline: boolean; delivered: boolean }> {
  const agent = await DesktopAgent.findByPk(session.desktopAgentId);
  const delivered = agentHub.publishToAgent(
    session.desktopAgentId,
    toScreenLiveStartCommand(session),
  );
  return {
    agentOnline: agent ? isAgentOnline(agent) : false,
    delivered: delivered > 0,
  };
}

/**
 * Starts (or reuses) the single active live session for an employee. Creating a
 * session only produces a command for the desktop agent; no capture is
 * considered active until the agent connects to the binary stream endpoint.
 */
export type IntegrationSessionOrigin = {
  connectionId: string;
  viewerLinkId: string;
  externalOrganizationId: string;
  externalUserId: string;
  clientId: string;
};

export async function startScreenLiveSession(options: {
  organizationId: string;
  employeeId: string;
  actorUserId: string;
  actorRole: Role;
  /** Set only for sessions started through a verified integration viewer link. */
  integration?: IntegrationSessionOrigin;
  context?: AuditContext;
}): Promise<{
  session: ReturnType<typeof toScreenLiveSessionSummary>;
  reused: boolean;
  agentOnline: boolean;
  delivered: boolean;
}> {
  const { organizationId, employeeId, actorUserId, actorRole } = options;
  const now = new Date();

  const policy = await getOrCreateScreenshotPolicy(organizationId);
  try {
    assertScreenLiveStartAllowed(policy, actorRole);
    await assertEmployeeMonitoringEnabled(organizationId, employeeId);
  } catch (error) {
    if (error instanceof AppError) {
      await auditAccessDenied({
        organizationId,
        sessionId: null,
        actorUserId,
        targetEmployeeId: employeeId,
        reason: `START_${error.code}`,
        context: options.context,
      });
    }
    throw error;
  }
  await assertEmployeePolicyAcknowledgement(policy, employeeId);

  await expireScreenLiveSessionsForEmployee(organizationId, employeeId, now);

  const existing = await ScreenLiveSession.findOne({
    where: { organizationId, employeeId, status: 'ACTIVE' },
    include: SESSION_INCLUDES,
  });
  if (existing && isActiveScreenLiveSession(existing, now)) {
    if (await isSessionTargetStillEligible(existing, now)) {
      // Never hand an integration viewer a native session (it has no employee indicator), nor an
      // owner an integration session. Each kind only ever reuses its own.
      if (!sessionBelongsTo(existing, options.integration)) {
        throw AppError.conflict(
          'A live screen session is already running for this employee',
          'SCREEN_LIVE_SESSION_IN_USE',
        );
      }
      const delivery = await deliverStartToAgent(existing);
      return {
        session: toScreenLiveSessionSummary(existing),
        reused: true,
        ...delivery,
      };
    }
    await terminateScreenLiveSession({
      sessionId: existing.id,
      organizationId,
      reason: 'SESSION_ENDED',
    });
  }

  try {
    const result = await serializeByKey(`screen-live:${organizationId}:${employeeId}`, () =>
      sequelize.transaction(async (transaction) => {
        const lockedPolicy = await getOrCreateScreenshotPolicy(organizationId, transaction);
        assertScreenLiveStartAllowed(lockedPolicy, actorRole);
        await assertEmployeeMonitoringEnabled(organizationId, employeeId, transaction);
        await assertEmployeePolicyAcknowledgement(lockedPolicy, employeeId, transaction);

        const target = await resolveLiveTarget(organizationId, employeeId, now, transaction);

        // An integration viewer may only watch a screen whose desktop app can show the employee the
        // on-screen indicator. The capability comes from the agent's live connection, so an app that
        // is offline, or too old to advertise it, is refused rather than viewed silently.
        if (
          options.integration &&
          !agentHub.agentHasCapability(target.agent.id, LIVE_INDICATOR_CAPABILITY)
        ) {
          const online = agentHub.countForAgent(target.agent.id) > 0;
          throw AppError.conflict(
            online
              ? 'The employee desktop app must be updated before their screen can be viewed here'
              : 'The employee desktop app is not connected',
            online ? 'SCREEN_LIVE_INDICATOR_UNSUPPORTED' : 'SCREEN_LIVE_AGENT_OFFLINE',
          );
        }

        // A concurrent request may have created the session while this one was
        // waiting for the employee lock. Reuse it instead of failing.
        const active = await ScreenLiveSession.findOne({
          where: { organizationId, employeeId, status: 'ACTIVE' },
          transaction,
          lock: transaction.LOCK.UPDATE,
        });
        if (active) {
          // Never attach to a session that belongs to a different kind of viewer: an integration viewer
          // must not inherit a native session (no indicator) and the reverse.
          if (!sessionBelongsTo(active, options.integration)) {
            throw AppError.conflict(
              'A live screen session is already running for this employee',
              'SCREEN_LIVE_SESSION_IN_USE',
            );
          }
          return { sessionId: active.id, reused: true };
        }

        const session = await ScreenLiveSession.create(
          {
            organizationId,
            employeeId,
            desktopAgentId: target.agent.id,
            timeSessionId: target.timeSession.id,
            startedByUserId: actorUserId,
            status: 'ACTIVE',
            startedAt: now,
            expiresAt: new Date(
              now.getTime() + config.screenLive.maxSessionSeconds * 1000,
            ),
            ...(options.integration
              ? {
                  origin: 'INTEGRATION' as const,
                  integrationConnectionId: options.integration.connectionId,
                  integrationViewerLinkId: options.integration.viewerLinkId,
                  externalOrganizationId: options.integration.externalOrganizationId,
                  externalUserId: options.integration.externalUserId,
                }
              : {}),
          },
          { transaction },
        );

        await recordAuditEvent(
          {
            organizationId,
            actorUserId,
            targetEmployeeId: employeeId,
            action: 'SCREEN_LIVE_SESSION_STARTED',
            entityType: 'SCREEN_LIVE_SESSION',
            entityId: session.id,
            metadata: {
              desktopAgentId: target.agent.id,
              timeSessionId: target.timeSession.id,
              expiresAt: session.expiresAt.toISOString(),
              maxFps: config.screenLive.maxFps,
              maxFrameWidth: config.screenLive.maxFrameWidth,
              origin: options.integration ? 'INTEGRATION' : 'WORKZEN',
              ...(options.integration
                ? {
                    viewerUserId: actorUserId,
                    integrationConnectionId: options.integration.connectionId,
                    integrationViewerLinkId: options.integration.viewerLinkId,
                    integrationClientId: options.integration.clientId,
                    externalOrganizationId: options.integration.externalOrganizationId,
                    externalUserId: options.integration.externalUserId,
                    indicatorRequired: true,
                  }
                : {}),
            },
          },
          { transaction, context: options.context },
        );

        return { sessionId: session.id, reused: false };
      }),
    );

    const full = await loadScreenLiveSession(result.sessionId, organizationId);
    const delivery = await deliverStartToAgent(full);
    return {
      session: toScreenLiveSessionSummary(full),
      reused: result.reused,
      ...delivery,
    };
  } catch (error) {
    if (error instanceof UniqueConstraintError) {
      const raced = await ScreenLiveSession.findOne({
        where: { organizationId, employeeId, status: 'ACTIVE' },
        include: SESSION_INCLUDES,
      });
      if (raced && isActiveScreenLiveSession(raced, now) && sessionBelongsTo(raced, options.integration)) {
        const delivery = await deliverStartToAgent(raced);
        return {
          session: toScreenLiveSessionSummary(raced),
          reused: true,
          ...delivery,
        };
      }
    }
    throw error;
  }
}

async function auditAccessDenied(options: {
  organizationId: string;
  sessionId: string | null;
  actorUserId?: string | null;
  targetEmployeeId?: string | null;
  reason: string;
  context?: AuditContext;
}): Promise<void> {
  try {
    await recordAuditEvent(
      {
        organizationId: options.organizationId,
        actorUserId: options.actorUserId ?? null,
        targetEmployeeId: options.targetEmployeeId ?? null,
        action: 'SCREEN_LIVE_ACCESS_DENIED',
        entityType: 'SCREEN_LIVE_SESSION',
        entityId: options.sessionId,
        metadata: { reason: options.reason },
      },
      { context: options.context },
    );
  } catch (error) {
    logger.warn({ err: error }, 'failed to record live screen access denial');
  }
}

/**
 * Issues a short-lived, single-use viewer ticket. Only the HMAC hash is stored;
 * the plaintext ticket is returned exactly once and consumed on WebSocket
 * connect.
 */
export async function issueScreenLiveViewerTicket(options: {
  organizationId: string;
  sessionId: string;
  actorUserId: string;
  actorRole: Role;
  /** Set only for integration viewers: the verified link the session must belong to. */
  integrationViewerLinkId?: string;
  context?: AuditContext;
}): Promise<{
  ticket: string;
  expiresAt: Date;
  websocketPath: string;
  session: ReturnType<typeof toScreenLiveSessionSummary>;
  viewer: ReturnType<typeof toScreenLiveViewerSummary>;
}> {
  const now = new Date();
  const session = await loadScreenLiveSession(options.sessionId, options.organizationId);

  const ticketDenial = integrationTicketDenial(session, options.integrationViewerLinkId);
  if (ticketDenial) {
    await auditAccessDenied({
      organizationId: options.organizationId,
      sessionId: session.id,
      actorUserId: options.actorUserId,
      targetEmployeeId: session.employeeId,
      reason: ticketDenial.code,
      context: options.context,
    });
    throw ticketDenial;
  }

  const policy = await getOrCreateScreenshotPolicy(options.organizationId);
  try {
    assertScreenLiveViewAllowed(policy, options.actorRole);
    await assertEmployeeMonitoringEnabled(options.organizationId, session.employeeId);
  } catch (error) {
    await auditAccessDenied({
      organizationId: options.organizationId,
      sessionId: session.id,
      actorUserId: options.actorUserId,
      targetEmployeeId: session.employeeId,
      reason: error instanceof AppError ? error.code : 'POLICY_DENIED',
      context: options.context,
    });
    throw error;
  }

  if (!isActiveScreenLiveSession(session, now)) {
    if (session.status === 'ACTIVE') {
      await terminateScreenLiveSession({
        sessionId: session.id,
        organizationId: options.organizationId,
        reason: 'EXPIRED',
      });
    }
    throw AppError.conflict(
      'This live screen session has ended',
      'SCREEN_LIVE_SESSION_NOT_ACTIVE',
    );
  }

  const timeSession = await TimeSession.findOne({
    where: {
      id: session.timeSessionId,
      organizationId: options.organizationId,
      employeeId: session.employeeId,
      status: 'ACTIVE',
      endedAt: null,
    },
    attributes: ['id'],
  });
  if (!timeSession) {
    await terminateScreenLiveSession({
      sessionId: session.id,
      organizationId: options.organizationId,
      reason: 'SESSION_ENDED',
    });
    throw AppError.conflict(
      'The employee work session is no longer active',
      'SCREEN_LIVE_TIME_SESSION_ENDED',
    );
  }

  const ticket = generateOpaqueToken();
  const expiresAt = new Date(
    Math.min(
      now.getTime() + config.screenLive.viewerTicketTtlSeconds * 1000,
      session.expiresAt.getTime(),
    ),
  );
  const viewer = await ScreenLiveViewer.create({
    organizationId: options.organizationId,
    screenLiveSessionId: session.id,
    userId: options.actorUserId,
    ticketHash: hashOpaqueToken(ticket, config.auth.tokenPepper),
    ticketExpiresAt: expiresAt,
  });

  return {
    ticket,
    expiresAt,
    websocketPath: `${config.apiPrefix}${config.screenLive.viewerPath}`,
    session: toScreenLiveSessionSummary(session),
    viewer: toScreenLiveViewerSummary(viewer),
  };
}

/**
 * Validates and burns a viewer ticket. This is the WebSocket handshake path:
 * authorization is re-checked against durable state so a suspended
 * organization, disabled policy, or ended session cannot be observed through a
 * previously issued ticket.
 */
export async function consumeScreenLiveViewerTicket(
  ticket: string,
  context?: AuditContext,
): Promise<{
  viewer: ReturnType<typeof toScreenLiveViewerSummary>;
  session: ReturnType<typeof toScreenLiveSessionSummary>;
  organizationId: string;
  employeeId: string;
  role: Role;
  userId: string;
}> {
  const now = new Date();
  const ticketHash = hashOpaqueToken(ticket, config.auth.tokenPepper);
  const viewer = await ScreenLiveViewer.findOne({
    where: { ticketHash },
    include: [
      { model: ScreenLiveSession, as: 'session', required: true, include: SESSION_INCLUDES },
    ],
  });

  if (!viewer || !viewer.session) {
    throw new AppError(401, 'SCREEN_LIVE_TICKET_INVALID', 'Live screen ticket is invalid');
  }

  const session = viewer.session;
  const deny = async (error: AppError): Promise<never> => {
    await auditAccessDenied({
      organizationId: viewer.organizationId,
      sessionId: viewer.screenLiveSessionId,
      actorUserId: viewer.userId,
      targetEmployeeId: session.employeeId,
      reason: error.code,
      context,
    });
    throw error;
  };

  if (
    !viewer.ticketExpiresAt ||
    viewer.ticketExpiresAt.getTime() <= now.getTime()
  ) {
    return deny(
      new AppError(410, 'SCREEN_LIVE_TICKET_EXPIRED', 'Live screen ticket has expired'),
    );
  }
  if (!isActiveScreenLiveSession(session, now)) {
    if (session.status === 'ACTIVE') {
      await terminateScreenLiveSession({
        sessionId: session.id,
        organizationId: session.organizationId,
        reason: 'EXPIRED',
      });
    }
    return deny(
      new AppError(409, 'SCREEN_LIVE_SESSION_ENDED', 'This live screen session has ended'),
    );
  }

  const [user, membership, organization] = await Promise.all([
    User.findByPk(viewer.userId, { attributes: ['id', 'status'] }),
    Membership.findOne({
      where: { organizationId: viewer.organizationId, userId: viewer.userId },
      attributes: ['id', 'role', 'status'],
    }),
    Organization.findOne({
      where: { id: viewer.organizationId, status: 'ACTIVE', deletedAt: null },
      attributes: ['id'],
    }),
  ]);

  if (!user || user.status !== 'ACTIVE') {
    return deny(new AppError(403, 'ACCOUNT_DISABLED', 'Account disabled'));
  }
  if (!membership || membership.status !== 'ACTIVE') {
    return deny(new AppError(403, 'MEMBERSHIP_INACTIVE', 'Membership is not active'));
  }
  if (!organization) {
    return deny(
      new AppError(403, 'ORGANIZATION_SUSPENDED', 'Organization is suspended'),
    );
  }

  if (session.origin === 'INTEGRATION') {
    // No viewer may join an integration session until the employee's indicator is confirmed, and the
    // viewer must be the verified owner the session was started for.
    if (!session.indicatorConfirmedAt) {
      return deny(
        new AppError(
          409,
          'SCREEN_LIVE_INDICATOR_NOT_CONFIRMED',
          'The employee indicator has not been confirmed yet',
        ),
      );
    }
    if (viewer.userId !== session.startedByUserId) {
      return deny(new AppError(403, 'SCREEN_LIVE_SESSION_FOREIGN', 'This session belongs to another viewer'));
    }
    const failure = await evaluateIntegrationSessionAuthorization(session, now);
    if (failure) {
      await enforceIntegrationFailure(session, failure);
      return deny(
        new AppError(403, 'SCREEN_LIVE_ACCESS_REVOKED', 'Access to this live session was revoked'),
      );
    }
  }

  const policy = await getOrCreateScreenshotPolicy(viewer.organizationId);
  try {
    assertScreenLiveViewAllowed(policy, membership.role);
  } catch (error) {
    if (error instanceof AppError) return deny(error);
    throw error;
  }
  if (!(await isEmployeeMonitoringEnabled(viewer.organizationId, session.employeeId))) {
    return deny(
      new AppError(
        403,
        EMPLOYEE_MONITORING_DISABLED,
        'Screen monitoring is disabled for this employee',
      ),
    );
  }

  const timeSession = await TimeSession.findOne({
    where: {
      id: session.timeSessionId,
      organizationId: session.organizationId,
      employeeId: session.employeeId,
      status: 'ACTIVE',
      endedAt: null,
    },
    attributes: ['id', 'lastHeartbeatAt'],
  });
  if (!timeSession) {
    await terminateScreenLiveSession({
      sessionId: session.id,
      organizationId: session.organizationId,
      reason: 'SESSION_ENDED',
    });
    return deny(
      new AppError(409, 'SCREEN_LIVE_TIME_SESSION_ENDED', 'The work session has ended'),
    );
  }
  if (!isHeartbeatFresh(timeSession.lastHeartbeatAt, now)) {
    await terminateScreenLiveSession({
      sessionId: session.id,
      organizationId: session.organizationId,
      reason: 'SESSION_ENDED',
    });
    return deny(
      new AppError(409, 'SCREEN_LIVE_TIME_SESSION_ENDED', 'The work session is no longer active'),
    );
  }

  const agent = await DesktopAgent.findOne({
    where: {
      id: session.desktopAgentId,
      organizationId: session.organizationId,
      userId: session.employeeId,
      revokedAt: null,
    },
    attributes: ['id', 'clientType'],
  });
  if (!agent || agent.clientType !== 'ELECTRON') {
    await terminateScreenLiveSession({
      sessionId: session.id,
      organizationId: session.organizationId,
      reason: 'AGENT_REVOKED',
    });
    return deny(
      new AppError(403, 'AGENT_REVOKED', 'The desktop agent is no longer authorized'),
    );
  }

  const consumed = await sequelize.transaction(async (transaction) => {
    const locked = await ScreenLiveViewer.findByPk(viewer.id, {
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!locked || locked.ticketHash !== ticketHash) {
      throw new AppError(
        401,
        'SCREEN_LIVE_TICKET_INVALID',
        'Live screen ticket is invalid or already used',
      );
    }
    if (!locked.ticketExpiresAt || locked.ticketExpiresAt.getTime() <= now.getTime()) {
      throw new AppError(410, 'SCREEN_LIVE_TICKET_EXPIRED', 'Live screen ticket has expired');
    }

    await locked.update(
      {
        ticketHash: null,
        ticketExpiresAt: null,
        joinedAt: locked.joinedAt ?? now,
        leftAt: null,
        lastSeenAt: now,
        disconnectedReason: null,
      },
      { transaction },
    );

    await recordAuditEvent(
      {
        organizationId: locked.organizationId,
        actorUserId: locked.userId,
        targetEmployeeId: session.employeeId,
        action: 'SCREEN_LIVE_VIEWER_JOINED',
        entityType: 'SCREEN_LIVE_SESSION',
        entityId: session.id,
        metadata: { viewerId: locked.id, role: membership.role },
      },
      { transaction, context },
    );

    return locked;
  });

  return {
    viewer: toScreenLiveViewerSummary(consumed),
    session: toScreenLiveSessionSummary(session),
    organizationId: consumed.organizationId,
    employeeId: session.employeeId,
    role: membership.role,
    userId: consumed.userId,
  };
}

/**
 * Re-checks a connected viewer during the relay sweep. A suspended
 * organization, lost membership, disabled policy, or ended session closes an
 * already-open stream instead of waiting for the next explicit action.
 */
export async function canScreenLiveViewerContinue(viewerId: string): Promise<boolean> {
  const now = new Date();
  const viewer = await ScreenLiveViewer.findByPk(viewerId, {
    include: [{ model: ScreenLiveSession, as: 'session', required: true }],
  });
  if (!viewer || !viewer.session || viewer.leftAt) return false;
  if (!isActiveScreenLiveSession(viewer.session, now)) return false;

  // The agent must still be authorized and the work session must still be
  // heartbeating; otherwise a frozen device could keep streaming until expiry.
  if (!(await isSessionTargetStillEligible(viewer.session, now))) return false;

  if (viewer.session.origin === 'INTEGRATION') {
    const failure = await evaluateIntegrationSessionAuthorization(viewer.session, now);
    if (failure) {
      await enforceIntegrationFailure(viewer.session, failure);
      return false;
    }
  }

  const [user, membership, organization] = await Promise.all([
    User.findByPk(viewer.userId, { attributes: ['id', 'status'] }),
    Membership.findOne({
      where: { organizationId: viewer.organizationId, userId: viewer.userId },
      attributes: ['id', 'role', 'status'],
    }),
    Organization.findOne({
      where: { id: viewer.organizationId, status: 'ACTIVE', deletedAt: null },
      attributes: ['id'],
    }),
  ]);
  if (!user || user.status !== 'ACTIVE') return false;
  if (!membership || membership.status !== 'ACTIVE' || !organization) return false;

  const policy = await getOrCreateScreenshotPolicy(viewer.organizationId);
  try {
    assertScreenLiveViewAllowed(policy, membership.role);
  } catch {
    return false;
  }
  if (!(await isEmployeeMonitoringEnabled(viewer.organizationId, viewer.session.employeeId))) {
    return false;
  }
  return true;
}

export async function touchScreenLiveViewer(viewerId: string, now = new Date()): Promise<void> {
  await ScreenLiveViewer.update(
    { lastSeenAt: now },
    { where: { id: viewerId, leftAt: null } },
  );
}

/**
 * Marks a viewer as disconnected and reports how many viewers remain, so the
 * relay can apply its reconnect grace period before ending the session.
 */
export async function markScreenLiveViewerLeft(options: {
  viewerId: string;
  reason: string;
  context?: AuditContext;
}): Promise<{ sessionId: string; remainingViewers: number }> {
  const now = new Date();
  return sequelize.transaction(async (transaction) => {
    const viewer = await ScreenLiveViewer.findByPk(options.viewerId, {
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!viewer) {
      return { sessionId: '', remainingViewers: 0 };
    }

    if (!viewer.leftAt) {
      await viewer.update(
        {
          leftAt: now,
          lastSeenAt: now,
          disconnectedReason: options.reason.slice(0, 64),
        },
        { transaction },
      );
      await recordAuditEvent(
        {
          organizationId: viewer.organizationId,
          actorUserId: viewer.userId,
          action: 'SCREEN_LIVE_VIEWER_LEFT',
          entityType: 'SCREEN_LIVE_SESSION',
          entityId: viewer.screenLiveSessionId,
          metadata: { viewerId: viewer.id, reason: options.reason.slice(0, 64) },
        },
        { transaction, context: options.context },
      );
    }

    const remainingViewers = await ScreenLiveViewer.count({
      where: {
        screenLiveSessionId: viewer.screenLiveSessionId,
        joinedAt: { [Op.ne]: null },
        leftAt: null,
      },
      transaction,
    });

    return { sessionId: viewer.screenLiveSessionId, remainingViewers };
  });
}

async function persistTermination(
  sessionId: string,
  organizationId: string | null,
  reason: ScreenLiveTerminationReason,
  context?: AuditContext,
  metadata: Record<string, unknown> = {},
): Promise<{
  session: ScreenLiveSessionModel;
  agentId: string;
  organizationId: string;
  employeeId: string;
} | null> {
  const now = new Date();
  return sequelize.transaction(async (transaction) => {
    const session = await ScreenLiveSession.findOne({
      where: {
        id: sessionId,
        ...(organizationId ? { organizationId } : {}),
      },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!session || session.status !== 'ACTIVE') return null;

    await session.update(
      { status: 'ENDED', endedAt: now, terminationReason: reason },
      { transaction },
    );
    await ScreenLiveViewer.update(
      { leftAt: now, lastSeenAt: now, disconnectedReason: reason },
      {
        where: { screenLiveSessionId: session.id, leftAt: null },
        transaction,
      },
    );
    await recordAuditEvent(
      {
        organizationId: session.organizationId,
        targetEmployeeId: session.employeeId,
        action: 'SCREEN_LIVE_SESSION_STOPPED',
        entityType: 'SCREEN_LIVE_SESSION',
        entityId: session.id,
        metadata: {
          ...metadata,
          reason,
          desktopAgentId: session.desktopAgentId,
          timeSessionId: session.timeSessionId,
        },
      },
      { transaction, context },
    );

    return {
      session,
      agentId: session.desktopAgentId,
      organizationId: session.organizationId,
      employeeId: session.employeeId,
    };
  });
}

/**
 * Terminates a session exactly once. The database transition commits before
 * the agent notification and relay event, so a transport failure cannot leave
 * a session marked active.
 */
export async function terminateScreenLiveSession(options: {
  sessionId: string;
  organizationId?: string | null;
  reason: ScreenLiveTerminationReason;
  context?: AuditContext;
  metadata?: Record<string, unknown>;
}): Promise<ReturnType<typeof toScreenLiveSessionSummary> | null> {
  const outcome = await persistTermination(
    options.sessionId,
    options.organizationId ?? null,
    options.reason,
    options.context,
    options.metadata,
  );
  if (!outcome) return null;

  emitScreenLiveSessionEnded({
    sessionId: outcome.session.id,
    organizationId: outcome.organizationId,
    agentId: outcome.agentId,
    reason: options.reason,
  });
  agentHub.publishToAgent(outcome.agentId, {
    type: 'screen.live.stop',
    liveSessionId: outcome.session.id,
    reason: options.reason,
    serverTime: new Date().toISOString(),
  });

  return toScreenLiveSessionSummary(outcome.session);
}

async function terminateActiveSessionsWhere(
  where: Record<string, unknown>,
  reason: ScreenLiveTerminationReason,
): Promise<number> {
  let terminated = 0;
  for (;;) {
    const sessions = await ScreenLiveSession.findAll({
      where: { ...where, status: 'ACTIVE' },
      attributes: ['id', 'organizationId'],
      limit: 500,
    });
    if (sessions.length === 0) return terminated;

    for (const session of sessions) {
      if (
        await terminateScreenLiveSession({
          sessionId: session.id,
          organizationId: session.organizationId,
          reason,
        })
      ) {
        terminated += 1;
      }
    }
    if (sessions.length < 500) return terminated;
  }
}

/**
 * Ends every live session attached to an agent whose authorization was
 * withdrawn. Called by agent revocation so an already-streaming desktop cannot
 * keep its session alive until the next sweep.
 */
export async function terminateActiveScreenLiveSessionsForAgent(
  agentId: string,
  reason: ScreenLiveTerminationReason = 'AGENT_REVOKED',
): Promise<number> {
  return terminateActiveSessionsWhere({ desktopAgentId: agentId }, reason);
}

/**
 * Ends every live session in an organization after a suspension, deletion, or
 * monitoring-policy change. Capture is stopped on the agent and viewers are
 * closed through the relay event.
 */
export async function terminateActiveScreenLiveSessionsForOrganization(
  organizationId: string,
  reason: ScreenLiveTerminationReason = 'ORGANIZATION_SUSPENDED',
): Promise<number> {
  return terminateActiveSessionsWhere({ organizationId }, reason);
}

/**
 * Ends every active integration-origin live session for a revoked viewer link or a closed
 * integration connection. Capture stops on the agent and viewers are closed through the relay event,
 * exactly as for any other termination. Existing WorkZen-origin sessions are never matched.
 */
export async function terminateActiveScreenLiveSessionsForIntegration(
  scope: { integrationConnectionId: string } | { integrationViewerLinkId: string },
  reason: Extract<ScreenLiveTerminationReason, 'VIEWER_LINK_REVOKED' | 'INTEGRATION_DISCONNECTED'>,
): Promise<number> {
  return terminateActiveSessionsWhere({ ...scope, origin: 'INTEGRATION' }, reason);
}

/**
 * Ends the live session for one employee when their individual monitoring
 * policy is disabled. Other employees in the organization are unaffected.
 */
export async function terminateActiveScreenLiveSessionsForEmployee(
  organizationId: string,
  employeeId: string,
  reason: ScreenLiveTerminationReason = 'POLICY_DISABLED',
): Promise<number> {
  return terminateActiveSessionsWhere({ organizationId, employeeId }, reason);
}

export async function stopScreenLiveSession(options: {
  organizationId: string;
  sessionId: string;
  actorUserId: string;
  actorRole: Role;
  context?: AuditContext;
}): Promise<{
  session: ReturnType<typeof toScreenLiveSessionSummary>;
  stopped: boolean;
}> {
  if (!isLiveCapable(options.actorRole)) {
    throw AppError.forbidden('Your role cannot stop live screens', 'PERMISSION_DENIED');
  }

  const existing = await loadScreenLiveSession(options.sessionId, options.organizationId);
  if (existing.status !== 'ACTIVE') {
    return { session: toScreenLiveSessionSummary(existing), stopped: false };
  }

  const policy = await getOrCreateScreenshotPolicy(options.organizationId);
  if (!policy.requestRoles.includes(options.actorRole)) {
    throw AppError.forbidden(
      'The monitoring policy does not permit your role to stop live viewing',
      'SCREEN_LIVE_ROLE_NOT_ALLOWED',
    );
  }

  await terminateScreenLiveSession({
    sessionId: existing.id,
    organizationId: options.organizationId,
    reason: 'VIEWER_STOPPED',
    context: options.context,
  });

  const full = await loadScreenLiveSession(existing.id, options.organizationId);
  return { session: toScreenLiveSessionSummary(full), stopped: true };
}

export async function failScreenLiveSession(options: {
  organizationId: string;
  sessionId: string;
  employeeId: string;
  agentId: string;
  code: string;
  message?: string | null;
  context?: AuditContext;
}): Promise<ReturnType<typeof toScreenLiveSessionSummary> | null> {
  const code = options.code.trim().toUpperCase();
  if (!/^[A-Z0-9_]{1,64}$/.test(code)) {
    throw AppError.unprocessable(
      'Failure code must contain only A-Z, 0-9, and underscores',
      'VALIDATION_ERROR',
      [{ path: 'code', message: 'Invalid failure code' }],
    );
  }

  const session = await ScreenLiveSession.findOne({
    where: {
      id: options.sessionId,
      organizationId: options.organizationId,
      employeeId: options.employeeId,
      desktopAgentId: options.agentId,
    },
  });
  if (!session) {
    throw AppError.notFound('Live screen session not found', 'SCREEN_LIVE_SESSION_NOT_FOUND');
  }

  // The agent owns the failure detail; only a bounded, non-secret message is
  // retained in the audit trail.
  return terminateScreenLiveSession({
    sessionId: session.id,
    organizationId: options.organizationId,
    reason: 'AGENT_FAILED',
    context: options.context,
    metadata: {
      failureCode: code,
      failureMessage: options.message?.trim().slice(0, 500) || null,
    },
  });
}

/**
 * Authorizes the desktop agent's binary stream connection. Only the agent that
 * owns the active session may attach, and the underlying work session must
 * still be running.
 */
export async function authorizeScreenLiveAgentStream(options: {
  organizationId: string;
  sessionId: string;
  employeeId: string;
  agentId: string;
}): Promise<ScreenLiveSessionModel> {
  const now = new Date();
  const session = await ScreenLiveSession.findOne({
    where: {
      id: options.sessionId,
      organizationId: options.organizationId,
      employeeId: options.employeeId,
      desktopAgentId: options.agentId,
      status: 'ACTIVE',
    },
  });
  if (!session) {
    throw AppError.notFound(
      'Live screen session not found',
      'SCREEN_LIVE_SESSION_NOT_FOUND',
    );
  }
  if (!isActiveScreenLiveSession(session, now)) {
    await terminateScreenLiveSession({
      sessionId: session.id,
      organizationId: session.organizationId,
      reason: 'EXPIRED',
    });
    throw AppError.gone('This live screen session has ended', 'SCREEN_LIVE_SESSION_ENDED');
  }

  const timeSession = await TimeSession.findOne({
    where: {
      id: session.timeSessionId,
      organizationId: session.organizationId,
      employeeId: session.employeeId,
      status: 'ACTIVE',
      endedAt: null,
    },
    attributes: ['id', 'lastHeartbeatAt'],
  });
  if (!timeSession) {
    await terminateScreenLiveSession({
      sessionId: session.id,
      organizationId: session.organizationId,
      reason: 'SESSION_ENDED',
    });
    throw AppError.conflict(
      'The employee work session has ended',
      'SCREEN_LIVE_TIME_SESSION_ENDED',
    );
  }
  if (!isHeartbeatFresh(timeSession.lastHeartbeatAt, now)) {
    await terminateScreenLiveSession({
      sessionId: session.id,
      organizationId: session.organizationId,
      reason: 'SESSION_ENDED',
    });
    throw AppError.conflict(
      'The employee work session is no longer active',
      'SCREEN_LIVE_TIME_SESSION_ENDED',
    );
  }

  const [agent, organization] = await Promise.all([
    DesktopAgent.findOne({
      where: {
        id: session.desktopAgentId,
        organizationId: session.organizationId,
        userId: session.employeeId,
        revokedAt: null,
      },
      attributes: ['id', 'clientType'],
    }),
    Organization.findOne({
      where: { id: session.organizationId, status: 'ACTIVE', deletedAt: null },
      attributes: ['id'],
    }),
  ]);
  if (!agent || agent.clientType !== 'ELECTRON') {
    await terminateScreenLiveSession({
      sessionId: session.id,
      organizationId: session.organizationId,
      reason: 'AGENT_REVOKED',
    });
    throw AppError.forbidden(
      'The desktop agent is no longer authorized',
      'AGENT_REVOKED',
    );
  }
  if (!organization) {
    await terminateScreenLiveSession({
      sessionId: session.id,
      organizationId: session.organizationId,
      reason: 'ORGANIZATION_SUSPENDED',
    });
    throw AppError.forbidden('Organization is suspended', 'ORGANIZATION_SUSPENDED');
  }

  if (!(await isEmployeeMonitoringEnabled(session.organizationId, session.employeeId))) {
    await terminateScreenLiveSession({
      sessionId: session.id,
      organizationId: session.organizationId,
      reason: 'POLICY_DISABLED',
    });
    throw AppError.forbidden(
      'Screen monitoring is disabled for this employee',
      EMPLOYEE_MONITORING_DISABLED,
    );
  }

  if (session.origin === 'INTEGRATION') {
    const failure = await evaluateIntegrationSessionAuthorization(session, now);
    if (failure) {
      await enforceIntegrationFailure(session, failure);
      throw AppError.forbidden('Access to this live session was revoked', 'SCREEN_LIVE_ACCESS_REVOKED');
    }
  }

  return session;
}

/**
 * Returns the active session for a reconnecting agent so capture can resume
 * without waiting for the admin to start a new session.
 */
export async function getPendingScreenLiveSessionForAgent(
  organizationId: string,
  agent: DesktopAgentModel,
) {
  const now = new Date();
  await expireScreenLiveSessions(now);

  const session = await ScreenLiveSession.findOne({
    where: {
      organizationId,
      employeeId: agent.userId,
      desktopAgentId: agent.id,
      status: 'ACTIVE',
      expiresAt: { [Op.gt]: now },
    },
  });
  if (!session) return null;

  if (!(await isEmployeeMonitoringEnabled(organizationId, agent.userId))) {
    await terminateScreenLiveSession({
      sessionId: session.id,
      organizationId,
      reason: 'POLICY_DISABLED',
    });
    return null;
  }

  return toScreenLivePendingSession(session);
}

async function terminationReasonFor(
  session: ScreenLiveSessionModel,
  now: Date,
  disabledOrganizations: Map<string, boolean>,
  disabledEmployees: Map<string, boolean>,
): Promise<ScreenLiveTerminationReason | null> {
  if (session.expiresAt.getTime() <= now.getTime()) return 'EXPIRED';

  const [organization, agent, timeSession] = await Promise.all([
    Organization.findByPk(session.organizationId, { attributes: ['id', 'status', 'deletedAt'] }),
    DesktopAgent.findByPk(session.desktopAgentId, { attributes: ['id', 'revokedAt'] }),
    TimeSession.findByPk(session.timeSessionId, {
      attributes: ['id', 'status', 'endedAt'],
    }),
  ]);

  if (!organization || organization.deletedAt || organization.status !== 'ACTIVE') {
    return 'ORGANIZATION_SUSPENDED';
  }
  if (!agent || agent.revokedAt) return 'AGENT_REVOKED';
  if (!timeSession || timeSession.endedAt || timeSession.status !== 'ACTIVE') {
    return 'SESSION_ENDED';
  }

  if (!disabledOrganizations.has(session.organizationId)) {
    const policy = await getOrCreateScreenshotPolicy(session.organizationId);
    disabledOrganizations.set(session.organizationId, !policy.enabled);
  }
  if (disabledOrganizations.get(session.organizationId)) return 'POLICY_DISABLED';

  const employeeKey = `${session.organizationId}:${session.employeeId}`;
  if (!disabledEmployees.has(employeeKey)) {
    disabledEmployees.set(
      employeeKey,
      !(await isEmployeeMonitoringEnabled(session.organizationId, session.employeeId)),
    );
  }
  if (disabledEmployees.get(employeeKey)) return 'POLICY_DISABLED';

  return null;
}

async function expireSessionsWhere(
  where: Record<string, unknown>,
  now: Date,
): Promise<number> {
  const sessions = await ScreenLiveSession.findAll({
    where: { ...where, status: 'ACTIVE' },
    limit: 500,
  });
  const disabledOrganizations = new Map<string, boolean>();
  const disabledEmployees = new Map<string, boolean>();
  let terminated = 0;

  for (const session of sessions) {
    const reason = await terminationReasonFor(
      session,
      now,
      disabledOrganizations,
      disabledEmployees,
    );
    if (!reason) continue;
    if (
      await terminateScreenLiveSession({
        sessionId: session.id,
        organizationId: session.organizationId,
        reason,
      })
    ) {
      terminated += 1;
    }
  }
  return terminated;
}

export async function expireScreenLiveSessions(now = new Date()): Promise<number> {
  return expireSessionsWhere({}, now);
}

async function expireScreenLiveSessionsForEmployee(
  organizationId: string,
  employeeId: string,
  now: Date,
): Promise<number> {
  return expireSessionsWhere({ organizationId, employeeId }, now);
}

export async function runScreenLiveMaintenance(now = new Date()): Promise<{
  sessionsTerminated: number;
}> {
  return { sessionsTerminated: await expireScreenLiveSessions(now) };
}

// --- Integration (partner-viewer) sessions ------------------------------------------------------

function sessionBelongsTo(
  session: Pick<ScreenLiveSessionModel, 'origin' | 'integrationViewerLinkId'>,
  integration: IntegrationSessionOrigin | undefined,
): boolean {
  if (integration) {
    return (
      session.origin === 'INTEGRATION' &&
      session.integrationViewerLinkId === integration.viewerLinkId
    );
  }
  return session.origin !== 'INTEGRATION';
}

function integrationTicketDenial(
  session: Pick<ScreenLiveSessionModel, 'origin' | 'integrationViewerLinkId' | 'indicatorConfirmedAt'>,
  linkId: string | undefined,
): AppError | null {
  if (session.origin !== 'INTEGRATION') {
    return linkId
      ? new AppError(403, 'SCREEN_LIVE_SESSION_FOREIGN', 'This session does not belong to that viewer')
      : null;
  }
  if (!linkId || session.integrationViewerLinkId !== linkId) {
    return new AppError(403, 'SCREEN_LIVE_SESSION_FOREIGN', 'This session belongs to another viewer');
  }
  if (!session.indicatorConfirmedAt) {
    return new AppError(
      409,
      'SCREEN_LIVE_INDICATOR_NOT_CONFIRMED',
      'The employee indicator has not been confirmed yet',
    );
  }
  return null;
}

/**
 * When each running integration session was last positively re-authorized, in this process. Frames of an
 * integration session are forwarded only while that is recent (see `isIntegrationSessionVerified`), so if
 * re-authorization stops working, for example because the database is unreachable, streaming stops after
 * the verification window instead of continuing on the last good answer.
 */
const integrationVerifiedAt = new Map<string, number>();

/** Three revalidation intervals: one missed or failed pass is tolerated, a prolonged outage is not. */
export function integrationVerificationWindowMs(): number {
  return config.screenLive.integrationRevalidateMs * 3;
}

export function isIntegrationSessionVerified(sessionId: string, now = Date.now()): boolean {
  const at = integrationVerifiedAt.get(sessionId);
  return at !== undefined && now - at <= integrationVerificationWindowMs();
}

export type IntegrationSessionFailure = {
  reason: ScreenLiveTerminationReason;
  code: string;
  /** Set when the linked owner is no longer eligible, so the link itself is withdrawn. */
  revokeLinkId?: string;
};

/**
 * Everything that must still hold for an integration session to keep streaming. It is evaluated from
 * durable state on a fixed timer (`revalidateIntegrationScreenLiveSessions`), when a viewer joins, on
 * every viewer revalidation and when the agent attaches its stream, so revocation never depends on
 * somebody making another API call.
 */
export async function evaluateIntegrationSessionAuthorization(
  session: ScreenLiveSessionModel,
  now = new Date(),
): Promise<IntegrationSessionFailure | null> {
  if (session.origin !== 'INTEGRATION') return null;
  // The feature switches are part of the authorization. Turning either off (a restart with the flag
  // false) ends every running integration session on the next pass and refuses new streams.
  if (!config.integrations.enabled || !config.integrations.liveScreensEnabled) {
    return { reason: 'FEATURE_DISABLED', code: 'LIVE_SCREENS_DISABLED' };
  }
  if (!isActiveScreenLiveSession(session, now)) {
    return { reason: 'EXPIRED', code: 'SCREEN_LIVE_SESSION_ENDED' };
  }

  const link = session.integrationViewerLinkId
    ? await IntegrationViewerLink.findByPk(session.integrationViewerLinkId)
    : null;
  if (
    !link ||
    link.status !== 'ACTIVE' ||
    link.connectionId !== session.integrationConnectionId ||
    link.organizationId !== session.organizationId ||
    link.workzenUserId !== session.startedByUserId
  ) {
    return { reason: 'VIEWER_LINK_REVOKED', code: 'VIEWER_LINK_REVOKED' };
  }

  const connection = session.integrationConnectionId
    ? await IntegrationConnection.findByPk(session.integrationConnectionId, {
        include: [{ model: IntegrationClient, as: 'client', required: true }],
      })
    : null;
  if (!connection || connection.status !== 'ACTIVE' || connection.client?.status !== 'ACTIVE') {
    return { reason: 'INTEGRATION_DISCONNECTED', code: 'INTEGRATION_CONNECTION_INACTIVE' };
  }
  const credentials = await IntegrationCredential.findAll({
    where: { connectionId: connection.id, revokedAt: null },
    attributes: ['scopes'],
  });
  if (!credentials.some((credential) => credential.scopes.includes('screens:live'))) {
    return { reason: 'INTEGRATION_DISCONNECTED', code: 'INTEGRATION_SCOPE_DENIED' };
  }

  const [user, membership, organization] = await Promise.all([
    User.findByPk(link.workzenUserId, { attributes: ['id', 'status'] }),
    Membership.findOne({
      where: { organizationId: session.organizationId, userId: link.workzenUserId },
      attributes: ['id', 'role', 'status'],
    }),
    Organization.findOne({
      where: { id: session.organizationId, status: 'ACTIVE', deletedAt: null },
      attributes: ['id'],
    }),
  ]);
  if (
    !user ||
    user.status !== 'ACTIVE' ||
    !membership ||
    membership.status !== 'ACTIVE' ||
    membership.role !== 'OWNER' ||
    !hasPermission(membership.role, 'screenshot:live') ||
    !organization
  ) {
    // Demoted, suspended, removed or no longer allowed live screens: the link ends for good.
    return {
      reason: 'VIEWER_LINK_REVOKED',
      code: 'VIEWER_IDENTITY_INELIGIBLE',
      revokeLinkId: link.id,
    };
  }

  const policy = await getOrCreateScreenshotPolicy(session.organizationId);
  try {
    assertScreenLiveStartAllowed(policy, membership.role);
    assertScreenLiveViewAllowed(policy, membership.role);
  } catch {
    return { reason: 'POLICY_DISABLED', code: 'SCREEN_LIVE_POLICY_DISABLED' };
  }
  if (!(await isEmployeeMonitoringEnabled(session.organizationId, session.employeeId))) {
    return { reason: 'POLICY_DISABLED', code: EMPLOYEE_MONITORING_DISABLED };
  }

  // The window runs from the later of the start and the last change to the flag (a dropped stream
  // clears it), so a reconnecting app gets the same time to confirm again as a new session does.
  const unconfirmedSince = Math.max(session.startedAt.getTime(), session.updatedAt.getTime());
  if (
    !session.indicatorConfirmedAt &&
    now.getTime() - unconfirmedSince > config.screenLive.indicatorConfirmTimeoutMs
  ) {
    return { reason: 'INDICATOR_UNAVAILABLE', code: 'SCREEN_LIVE_INDICATOR_TIMEOUT' };
  }
  integrationVerifiedAt.set(session.id, now.getTime());
  return null;
}

/** Ends the session (stopping capture and closing every viewer) and withdraws the link if needed. */
export async function enforceIntegrationFailure(
  session: Pick<ScreenLiveSessionModel, 'id' | 'organizationId'>,
  failure: IntegrationSessionFailure,
): Promise<void> {
  if (failure.revokeLinkId) {
    const [changed] = await IntegrationViewerLink.update(
      {
        status: 'REVOKED',
        revokedAt: new Date(),
        revokeReason: 'IDENTITY_NO_LONGER_ELIGIBLE',
      },
      { where: { id: failure.revokeLinkId, status: 'ACTIVE' } },
    );
    if (changed > 0) {
      await recordAuditEvent({
        organizationId: session.organizationId,
        actorUserId: null,
        action: 'INTEGRATION_VIEWER_LINK_REVOKED',
        entityType: 'INTEGRATION_VIEWER_LINK',
        entityId: failure.revokeLinkId,
        metadata: { reason: 'IDENTITY_NO_LONGER_ELIGIBLE', detectedBy: 'live_revalidation' },
      });
    }
  }
  await terminateScreenLiveSession({
    sessionId: session.id,
    organizationId: session.organizationId,
    reason: failure.reason,
    metadata: { code: failure.code, detectedBy: 'live_revalidation' },
  });
  if (failure.revokeLinkId) {
    await terminateActiveScreenLiveSessionsForIntegration(
      { integrationViewerLinkId: failure.revokeLinkId },
      'VIEWER_LINK_REVOKED',
    );
  }
}

/**
 * Re-authorizes every active integration session. Run on a fixed timer no longer than
 * `SCREEN_LIVE_INTEGRATION_REVALIDATE_SECONDS` (hard maximum 15 s), so a revoked link, a demoted or
 * suspended owner, a lost permission, a closed connection or a disabled policy ends a running stream
 * without any API call. A transient database error never ends a healthy session; the next tick retries.
 */
export async function revalidateIntegrationScreenLiveSessions(now = new Date()): Promise<number> {
  let ended = 0;
  const sessions = await ScreenLiveSession.findAll({
    where: { origin: 'INTEGRATION', status: 'ACTIVE' },
    limit: 500,
  });
  const running = new Set(sessions.map((session) => session.id));
  for (const id of [...integrationVerifiedAt.keys()]) {
    if (!running.has(id)) integrationVerifiedAt.delete(id);
  }
  for (const session of sessions) {
    try {
      const failure = await evaluateIntegrationSessionAuthorization(session, now);
      if (failure) {
        await enforceIntegrationFailure(session, failure);
        ended += 1;
      }
    } catch (error) {
      logger.warn(
        { err: error, sessionId: session.id },
        'integration live session revalidation failed; retrying on the next tick',
      );
    }
  }
  return ended;
}

/**
 * Records the employee agent's statement about its on-screen indicator for an integration session.
 * Frames are forwarded only while this is set (see screenLiveRelay).
 */
export async function setScreenLiveIndicatorState(options: {
  sessionId: string;
  organizationId: string;
  agentId: string;
  visible: boolean;
  context?: AuditContext;
}): Promise<boolean> {
  const session = await ScreenLiveSession.findOne({
    where: {
      id: options.sessionId,
      organizationId: options.organizationId,
      desktopAgentId: options.agentId,
      origin: 'INTEGRATION',
      status: 'ACTIVE',
    },
  });
  if (!session) return false;
  const was = session.indicatorConfirmedAt !== null;
  await session.update({ indicatorConfirmedAt: options.visible ? new Date() : null });
  if (was !== options.visible) {
    await recordAuditEvent(
      {
        organizationId: session.organizationId,
        actorUserId: session.employeeId,
        targetEmployeeId: session.employeeId,
        action: options.visible ? 'SCREEN_LIVE_INDICATOR_CONFIRMED' : 'SCREEN_LIVE_INDICATOR_HIDDEN',
        entityType: 'SCREEN_LIVE_SESSION',
        entityId: session.id,
        metadata: {
          desktopAgentId: session.desktopAgentId,
          viewerUserId: session.startedByUserId,
          integrationViewerLinkId: session.integrationViewerLinkId,
        },
      },
      { context: options.context },
    );
  }
  return true;
}
