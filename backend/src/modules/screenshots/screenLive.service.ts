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
} from '../../database';
import { config } from '../../config/env';
import { logger } from '../../config/logger';
import { generateOpaqueToken, hashOpaqueToken } from '../../utils/crypto';
import { AppError } from '../../utils/errors';
import { serializeByKey } from '../../utils/serialize';
import { agentHub } from '../../realtime/agentHub';
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
export async function startScreenLiveSession(options: {
  organizationId: string;
  employeeId: string;
  actorUserId: string;
  actorRole: Role;
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
        await assertEmployeePolicyAcknowledgement(lockedPolicy, employeeId, transaction);

        const target = await resolveLiveTarget(organizationId, employeeId, now, transaction);

        // A concurrent request may have created the session while this one was
        // waiting for the employee lock. Reuse it instead of failing.
        const active = await ScreenLiveSession.findOne({
          where: { organizationId, employeeId, status: 'ACTIVE' },
          transaction,
          lock: transaction.LOCK.UPDATE,
        });
        if (active) {
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
      if (raced && isActiveScreenLiveSession(raced, now)) {
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

  const policy = await getOrCreateScreenshotPolicy(options.organizationId);
  try {
    assertScreenLiveViewAllowed(policy, options.actorRole);
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

  const policy = await getOrCreateScreenshotPolicy(viewer.organizationId);
  try {
    assertScreenLiveViewAllowed(policy, membership.role);
  } catch (error) {
    if (error instanceof AppError) return deny(error);
    throw error;
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
  return session ? toScreenLivePendingSession(session) : null;
}

async function terminationReasonFor(
  session: ScreenLiveSessionModel,
  now: Date,
  disabledOrganizations: Map<string, boolean>,
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
  let terminated = 0;

  for (const session of sessions) {
    const reason = await terminationReasonFor(session, now, disabledOrganizations);
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
