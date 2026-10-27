import { Op, UniqueConstraintError } from 'sequelize';
import { DateTime } from 'luxon';
import {
  AuditEvent,
  DesktopAgent,
  Membership,
  Organization,
  Screenshot,
  ScreenshotPolicy,
  ScreenshotRequest,
  TimeSession,
  User,
  sequelize,
} from '../../database';
import { config } from '../../config/env';
import { logger } from '../../config/logger';
import {
  generateOpaqueToken,
  generateUuid,
  hashOpaqueToken,
} from '../../utils/crypto';
import { AppError } from '../../utils/errors';
import { paginate } from '../../utils/pagination';
import { serializeByKey } from '../../utils/serialize';
import { agentHub } from '../../realtime/agentHub';
import { isAgentOnline } from '../desktopAgents/desktopAgent.mapper';
import { isHeartbeatFresh } from '../timeTracking/timeSession.mapper';
import type { Role } from '../memberships/roles';
import type { DesktopAgent as DesktopAgentModel } from '../desktopAgents/desktopAgent.model';
import type { User as UserModel } from '../users/user.model';
import type { Screenshot as ScreenshotModel } from './screenshot.model';
import type {
  ScreenshotRequest as ScreenshotRequestModel,
  ScreenshotRequestStatus,
} from './screenshotRequest.model';
import {
  ACTIVE_SCREENSHOT_REQUEST_STATUSES,
  SCREENSHOT_REQUEST_STATUSES,
} from './screenshotRequest.model';
import { recordAuditEvent, type AuditContext } from './audit.service';
import { SCREENSHOT_AUDIT_ACTIONS } from './auditEvent.model';
import {
  assertEmployeePolicyAcknowledgement,
  assertScreenshotManageAllowed,
  assertScreenshotRequestAllowed,
  assertScreenshotViewAllowed,
  getOrCreateScreenshotPolicy,
} from './screenshotPolicy.service';
import {
  toScreenshotAuditEventSummary,
  toScreenshotPendingSummary,
  toScreenshotRequestCommand,
  toScreenshotRequestSummary,
  toScreenshotSummary,
} from './screenshot.mapper';
import { screenshotStorage } from './storage';
import { verifyScreenshotDownloadToken } from './screenshot.tokens';
import {
  assertExpectedContentType,
  assertScreenshotSize,
  isAllowedScreenshotContentType,
  normalizeContentType,
  SCREENSHOT_EXTENSIONS,
  validateUploadedScreenshot,
} from './screenshot.validation';

const REQUEST_INCLUDES = [
  { model: User, as: 'employee', required: false, attributes: ['id', 'name', 'email'] },
  { model: User, as: 'requestingAdmin', required: false, attributes: ['id', 'name', 'email'] },
  { model: DesktopAgent, as: 'desktopAgent', required: false },
  { model: TimeSession, as: 'timeSession', required: false },
  { model: Screenshot, as: 'screenshot', required: false },
];

const SCREENSHOT_INCLUDES = [
  { model: User, as: 'employee', required: false, attributes: ['id', 'name', 'email'] },
  { model: User, as: 'requestingAdmin', required: false, attributes: ['id', 'name', 'email'] },
];

function isActiveStatus(status: ScreenshotRequestStatus): boolean {
  return ACTIVE_SCREENSHOT_REQUEST_STATUSES.includes(status);
}

async function loadRequestWithAssociations(
  requestId: string,
  organizationId: string,
): Promise<ScreenshotRequestModel> {
  const request = await ScreenshotRequest.findOne({
    where: { id: requestId, organizationId },
    include: REQUEST_INCLUDES,
  });
  if (!request) {
    throw AppError.notFound('Screenshot request not found', 'SCREENSHOT_REQUEST_NOT_FOUND');
  }
  return request;
}

async function loadScreenshotWithAssociations(
  screenshotId: string,
  organizationId: string,
): Promise<ScreenshotModel> {
  const screenshot = await Screenshot.findOne({
    where: { id: screenshotId, organizationId },
    include: SCREENSHOT_INCLUDES,
  });
  if (!screenshot) {
    throw AppError.notFound('Screenshot not found', 'SCREENSHOT_NOT_FOUND');
  }
  return screenshot;
}

async function assertEmployeeInOrganization(
  organizationId: string,
  employeeId: string,
): Promise<UserModel> {
  const user = await User.findByPk(employeeId);
  if (!user || user.status !== 'ACTIVE') {
    throw AppError.notFound('Employee not found', 'EMPLOYEE_NOT_FOUND');
  }
  const membership = await Membership.findOne({
    where: { organizationId, userId: employeeId, status: 'ACTIVE' },
    attributes: ['id'],
  });
  if (!membership) {
    // Cross-organization employee IDs are deliberately indistinguishable from
    // non-existent employees.
    throw AppError.notFound('Employee not found', 'EMPLOYEE_NOT_FOUND');
  }
  return user;
}

async function deleteObjectAndClearKey(
  storageKey: string | null,
  requestId?: string,
): Promise<boolean> {
  if (!storageKey) return true;
  try {
    await screenshotStorage.deleteObject(storageKey);
    if (requestId) {
      await ScreenshotRequest.update(
        { storageKey: null },
        { where: { id: requestId } },
      );
    }
    return true;
  } catch (error) {
    logger.warn({ err: error }, 'failed to delete screenshot storage object');
    return false;
  }
}

async function markRequestExpired(
  requestId: string,
  now: Date,
  mode: 'request' | 'upload',
): Promise<boolean> {
  const outcome = await sequelize.transaction(async (transaction) => {
    const request = await ScreenshotRequest.findByPk(requestId, {
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!request || !isActiveStatus(request.status)) return null;

    if (mode === 'request' && request.expiresAt.getTime() > now.getTime()) return null;
    if (
      mode === 'upload' &&
      (!request.uploadExpiresAt || request.uploadExpiresAt.getTime() > now.getTime())
    ) {
      return null;
    }

    const failureCode = mode === 'request' ? 'REQUEST_TIMEOUT' : 'UPLOAD_TIMEOUT';
    await request.update(
      {
        status: 'EXPIRED',
        failureCode,
        failureMessage:
          mode === 'request'
            ? 'The screenshot request expired before the agent completed it.'
            : 'The upload authorization expired before the agent uploaded a screenshot.',
        uploadTokenHash: null,
        uploadExpiresAt: null,
      },
      { transaction },
    );

    await recordAuditEvent(
      {
        organizationId: request.organizationId,
        actorUserId: null,
        targetEmployeeId: request.employeeId,
        action: 'SCREENSHOT_REQUEST_EXPIRED',
        entityId: request.id,
        screenshotRequestId: request.id,
        metadata: { failureCode, mode },
      },
      { transaction },
    );

    return { storageKey: request.storageKey };
  });

  if (!outcome) return false;
  await deleteObjectAndClearKey(outcome.storageKey, requestId);
  return true;
}

export async function expireOverdueRequests(now = new Date()): Promise<number> {
  const overdue = await ScreenshotRequest.findAll({
    where: {
      status: { [Op.in]: ACTIVE_SCREENSHOT_REQUEST_STATUSES },
      expiresAt: { [Op.lte]: now },
    },
    attributes: ['id'],
    limit: 1000,
  });

  let expired = 0;
  for (const request of overdue) {
    if (await markRequestExpired(request.id, now, 'request')) expired += 1;
  }
  return expired;
}

async function expireOverdueRequestsForEmployee(
  organizationId: string,
  employeeId: string,
  now = new Date(),
): Promise<void> {
  const overdue = await ScreenshotRequest.findAll({
    where: {
      organizationId,
      employeeId,
      status: { [Op.in]: ACTIVE_SCREENSHOT_REQUEST_STATUSES },
      expiresAt: { [Op.lte]: now },
    },
    attributes: ['id'],
  });
  for (const request of overdue) {
    await markRequestExpired(request.id, now, 'request');
  }
}

export async function cleanupAbandonedUploads(now = new Date()): Promise<number> {
  const candidates = await ScreenshotRequest.findAll({
    where: {
      status: 'CLAIMED',
      uploadExpiresAt: { [Op.lte]: now },
      expiresAt: { [Op.gt]: now },
    },
    attributes: ['id', 'storageKey'],
    limit: 500,
  });

  let cleaned = 0;
  for (const candidate of candidates) {
    // If bytes are already in private storage, leave the request for the
    // authenticated completion call until the request itself expires.
    if (candidate.storageKey) {
      try {
        const stored = await screenshotStorage.statObject(candidate.storageKey);
        if (stored) continue;
      } catch (error) {
        logger.warn({ err: error }, 'failed to inspect abandoned screenshot upload');
        continue;
      }
    }
    if (await markRequestExpired(candidate.id, now, 'upload')) cleaned += 1;
  }
  return cleaned;
}

export async function cleanupExpiredScreenshots(now = new Date()): Promise<number> {
  const expired = await Screenshot.findAll({
    where: { retentionExpiresAt: { [Op.lte]: now } },
    limit: 500,
  });

  let deleted = 0;
  for (const screenshot of expired) {
    try {
      await screenshotStorage.deleteObject(screenshot.storageKey);
      await sequelize.transaction(async (transaction) => {
        const current = await Screenshot.findByPk(screenshot.id, {
          transaction,
          lock: transaction.LOCK.UPDATE,
        });
        if (!current) return;

        await current.destroy({ transaction });
        await ScreenshotRequest.update(
          { storageKey: null },
          { where: { id: current.screenshotRequestId }, transaction },
        );
        await recordAuditEvent(
          {
            organizationId: current.organizationId,
            actorUserId: null,
            targetEmployeeId: current.employeeId,
            action: 'SCREENSHOT_DELETED',
            entityType: 'SCREENSHOT',
            entityId: current.id,
            screenshotRequestId: current.screenshotRequestId,
            screenshotId: null,
            metadata: {
              screenshotId: current.id,
              reason: 'RETENTION_EXPIRED',
              retentionExpiresAt: current.retentionExpiresAt.toISOString(),
            },
          },
          { transaction },
        );
      });
      deleted += 1;
    } catch (error) {
      logger.warn({ err: error, screenshotId: screenshot.id }, 'failed to delete expired screenshot');
    }
  }
  return deleted;
}

/**
 * Removes objects that could not be deleted during cancel/fail/expire. The
 * terminal request row remains as evidence, but no private bytes are retained.
 */
export async function cleanupTerminalRequestObjects(limit = 200): Promise<number> {
  const candidates = await ScreenshotRequest.findAll({
    where: {
      status: { [Op.in]: ['FAILED', 'EXPIRED', 'CANCELLED'] },
      storageKey: { [Op.ne]: null },
    },
    attributes: ['id', 'storageKey'],
    limit,
  });
  let cleaned = 0;
  for (const request of candidates) {
    if (await deleteObjectAndClearKey(request.storageKey, request.id)) cleaned += 1;
  }
  return cleaned;
}

export async function cleanupAuditEvents(now = new Date()): Promise<number> {
  const policies = await ScreenshotPolicy.findAll();
  let deleted = 0;
  for (const policy of policies) {
    const cutoff = new Date(now.getTime() - policy.auditRetentionDays * 86_400_000);
    deleted += await AuditEvent.destroy({
      where: {
        organizationId: policy.organizationId,
        action: { [Op.in]: [...SCREENSHOT_AUDIT_ACTIONS] },
        createdAt: { [Op.lt]: cutoff },
      },
    });
  }
  return deleted;
}

export async function runScreenshotMaintenance(now = new Date()): Promise<{
  requestsExpired: number;
  abandonedUploads: number;
  screenshotsDeleted: number;
  orphanedObjectsDeleted: number;
  auditEventsDeleted: number;
}> {
  const requestsExpired = await expireOverdueRequests(now);
  const abandonedUploads = await cleanupAbandonedUploads(now);
  const screenshotsDeleted = await cleanupExpiredScreenshots(now);
  const orphanedObjectsDeleted = await cleanupTerminalRequestObjects();
  const auditEventsDeleted = await cleanupAuditEvents(now);
  return {
    requestsExpired,
    abandonedUploads,
    screenshotsDeleted,
    orphanedObjectsDeleted,
    auditEventsDeleted,
  };
}

export async function createScreenshotRequest(options: {
  organizationId: string;
  employeeId: string;
  actorUserId: string;
  actorRole: Role;
  idempotencyKey?: string | null;
  context?: AuditContext;
}): Promise<{
  request: ScreenshotRequestModel;
  replayed: boolean;
  agentOnline: boolean;
  delivered: boolean;
}> {
  const { organizationId, employeeId, actorUserId, actorRole, idempotencyKey } = options;
  const now = new Date();

  if (idempotencyKey) {
    const existing = await ScreenshotRequest.findOne({
      where: { organizationId, requestingAdminId: actorUserId, idempotencyKey },
      include: REQUEST_INCLUDES,
    });
    if (existing) {
      if (existing.employeeId !== employeeId) {
        throw AppError.conflict(
          'This idempotency key was already used for a different employee',
          'IDEMPOTENCY_KEY_REUSED',
        );
      }
      return {
        request: existing,
        replayed: true,
        agentOnline: existing.desktopAgent ? isAgentOnline(existing.desktopAgent, now) : false,
        delivered: false,
      };
    }
  }

  await expireOverdueRequestsForEmployee(organizationId, employeeId, now);

  try {
    const result = await serializeByKey(`screenshot:${organizationId}:${employeeId}`, () =>
      sequelize.transaction(async (transaction) => {
        // Lock the employee row so request creation is serialized with other
        // screenshot requests (and time-session transitions for this user).
        const employee = await User.findByPk(employeeId, {
          transaction,
          lock: transaction.LOCK.UPDATE,
          attributes: ['id', 'status'],
        });
        if (!employee || employee.status !== 'ACTIVE') {
          throw AppError.notFound('Employee not found', 'EMPLOYEE_NOT_FOUND');
        }
        const membership = await Membership.findOne({
          where: { organizationId, userId: employeeId, status: 'ACTIVE' },
          transaction,
          attributes: ['id'],
        });
        if (!membership) {
          throw AppError.notFound('Employee not found', 'EMPLOYEE_NOT_FOUND');
        }

        // Re-check inside the serialized transaction so concurrent retries with
        // the same key replay the winner instead of reporting a duplicate
        // pending request.
        if (idempotencyKey) {
          const existing = await ScreenshotRequest.findOne({
            where: { organizationId, requestingAdminId: actorUserId, idempotencyKey },
            transaction,
            lock: transaction.LOCK.UPDATE,
          });
          if (existing) {
            if (existing.employeeId !== employeeId) {
              throw AppError.conflict(
                'This idempotency key was already used for a different employee',
                'IDEMPOTENCY_KEY_REUSED',
              );
            }
            return { request: existing, agent: null, replayed: true };
          }
        }

        const policy = await getOrCreateScreenshotPolicy(organizationId, transaction);
        assertScreenshotRequestAllowed(policy, actorRole);
        await assertEmployeePolicyAcknowledgement(policy, employeeId, transaction);

        const activeForEmployee = await ScreenshotRequest.findOne({
          where: {
            organizationId,
            employeeId,
            status: { [Op.in]: ACTIVE_SCREENSHOT_REQUEST_STATUSES },
          },
          transaction,
          lock: transaction.LOCK.UPDATE,
        });
        if (activeForEmployee) {
          throw AppError.conflict(
            'This employee already has a pending screenshot request',
            'SCREENSHOT_REQUEST_PENDING',
          );
        }

        if (policy.requestCooldownSeconds > 0) {
          const cooldownStart = new Date(
            now.getTime() - policy.requestCooldownSeconds * 1000,
          );
          const recent = await ScreenshotRequest.findOne({
            where: {
              organizationId,
              requestingAdminId: actorUserId,
              requestedAt: { [Op.gt]: cooldownStart },
            },
            transaction,
            attributes: ['id'],
          });
          if (recent) {
            throw AppError.tooManyRequests(
              'Please wait before requesting another screenshot',
              'SCREENSHOT_REQUEST_COOLDOWN',
            );
          }
        }

        const session = await TimeSession.findOne({
          where: {
            organizationId,
            employeeId,
            status: 'ACTIVE',
            endedAt: null,
            desktopAgentId: { [Op.ne]: null },
          },
          transaction,
          lock: transaction.LOCK.UPDATE,
          order: [['startedAt', 'DESC']],
        });
        if (!session || !session.desktopAgentId || !isHeartbeatFresh(session.lastHeartbeatAt, now)) {
          throw AppError.conflict(
            'The employee does not have an eligible active time session',
            'NO_ELIGIBLE_SCREENSHOT_SESSION',
          );
        }

        const agent = await DesktopAgent.findOne({
          where: {
            id: session.desktopAgentId,
            organizationId,
            userId: employeeId,
            revokedAt: null,
          },
          transaction,
        });
        if (!agent) {
          throw AppError.conflict(
            'The employee does not have a valid desktop agent',
            'INVALID_SCREENSHOT_AGENT',
          );
        }
        // Mobile devices share the agent registry, but screenshots are only
        // captured by the Electron desktop agent.
        if (agent.clientType !== 'ELECTRON') {
          throw AppError.conflict(
            'The employee does not have an eligible active time session',
            'NO_ELIGIBLE_SCREENSHOT_SESSION',
          );
        }

        const request = await ScreenshotRequest.create(
          {
            organizationId,
            employeeId,
            requestingAdminId: actorUserId,
            desktopAgentId: agent.id,
            timeSessionId: session.id,
            status: 'PENDING',
            requestedAt: now,
            expiresAt: new Date(now.getTime() + config.screenshots.requestTtlSeconds * 1000),
            idempotencyKey: idempotencyKey ?? null,
          },
          { transaction },
        );

        await recordAuditEvent(
          {
            organizationId,
            actorUserId,
            targetEmployeeId: employeeId,
            action: 'SCREENSHOT_REQUEST_CREATED',
            entityId: request.id,
            screenshotRequestId: request.id,
            metadata: {
              sessionId: session.id,
              desktopAgentId: agent.id,
              expiresAt: request.expiresAt.toISOString(),
              policyVersion: policy.disclosureVersion,
            },
          },
          { transaction, context: options.context },
        );

        return { request, agent, replayed: false };
      }),
    );

    const full = await loadRequestWithAssociations(result.request.id, organizationId);
    if (!result.agent) {
      return {
        request: full,
        replayed: true,
        agentOnline: full.desktopAgent ? isAgentOnline(full.desktopAgent, now) : false,
        delivered: false,
      };
    }

    const delivered = agentHub.publishToAgent(result.agent.id, toScreenshotRequestCommand(full)) > 0;

    return {
      request: full,
      replayed: false,
      agentOnline: isAgentOnline(result.agent, now),
      delivered,
    };
  } catch (error) {
    if (error instanceof UniqueConstraintError) {
      if (idempotencyKey) {
        const existing = await ScreenshotRequest.findOne({
          where: { organizationId, requestingAdminId: actorUserId, idempotencyKey },
          include: REQUEST_INCLUDES,
        });
        if (existing) {
          if (existing.employeeId !== employeeId) {
            throw AppError.conflict(
              'This idempotency key was already used for a different employee',
              'IDEMPOTENCY_KEY_REUSED',
            );
          }
          return {
            request: existing,
            replayed: true,
            agentOnline: existing.desktopAgent
              ? isAgentOnline(existing.desktopAgent, now)
              : false,
            delivered: false,
          };
        }
      }
      throw AppError.conflict(
        'This employee already has a pending screenshot request',
        'SCREENSHOT_REQUEST_PENDING',
      );
    }
    throw error;
  }
}

export async function listScreenshotRequestsForEmployee(options: {
  organizationId: string;
  employeeId: string;
  actorRole: Role;
  page: number;
  limit: number;
  status?: ScreenshotRequestStatus;
}): Promise<ReturnType<typeof paginate<ReturnType<typeof toScreenshotRequestSummary>>>> {
  await assertEmployeeInOrganization(options.organizationId, options.employeeId);
  const policy = await getOrCreateScreenshotPolicy(options.organizationId);
  assertScreenshotViewAllowed(policy, options.actorRole);
  await expireOverdueRequestsForEmployee(options.organizationId, options.employeeId);

  const where: Record<string, unknown> = {
    organizationId: options.organizationId,
    employeeId: options.employeeId,
  };
  if (options.status) where.status = options.status;

  const result = await ScreenshotRequest.findAndCountAll({
    where,
    include: REQUEST_INCLUDES,
    order: [
      ['requestedAt', 'DESC'],
      ['id', 'ASC'],
    ],
    limit: options.limit,
    offset: (options.page - 1) * options.limit,
    distinct: true,
  });

  return paginate(
    result.rows.map((request) => toScreenshotRequestSummary(request)),
    result.count,
    options.page,
    options.limit,
  );
}

export async function listScreenshotRequestsForOrganization(options: {
  organizationId: string;
  actorRole: Role;
  page: number;
  limit: number;
  employeeId?: string;
  status?: ScreenshotRequestStatus;
}): Promise<ReturnType<typeof paginate<ReturnType<typeof toScreenshotRequestSummary>>>> {
  const policy = await getOrCreateScreenshotPolicy(options.organizationId);
  assertScreenshotViewAllowed(policy, options.actorRole);
  await expireOverdueRequests();

  const where: Record<string, unknown> = { organizationId: options.organizationId };
  if (options.employeeId) where.employeeId = options.employeeId;
  if (options.status) where.status = options.status;

  const result = await ScreenshotRequest.findAndCountAll({
    where,
    include: REQUEST_INCLUDES,
    order: [
      ['requestedAt', 'DESC'],
      ['id', 'ASC'],
    ],
    limit: options.limit,
    offset: (options.page - 1) * options.limit,
    distinct: true,
  });

  return paginate(
    result.rows.map((request) => toScreenshotRequestSummary(request)),
    result.count,
    options.page,
    options.limit,
  );
}

export async function getScreenshotRequestForAdmin(options: {
  organizationId: string;
  requestId: string;
  actorRole: Role;
}) {
  const policy = await getOrCreateScreenshotPolicy(options.organizationId);
  assertScreenshotViewAllowed(policy, options.actorRole);
  await markRequestExpiredIfOverdue(options.requestId, options.organizationId);
  return toScreenshotRequestSummary(
    await loadRequestWithAssociations(options.requestId, options.organizationId),
  );
}

async function markRequestExpiredIfOverdue(requestId: string, organizationId: string): Promise<void> {
  const request = await ScreenshotRequest.findOne({
    where: { id: requestId, organizationId },
    attributes: ['id', 'status', 'expiresAt'],
  });
  if (
    request &&
    isActiveStatus(request.status) &&
    request.expiresAt.getTime() <= Date.now()
  ) {
    await markRequestExpired(request.id, new Date(), 'request');
  }
}

export async function cancelScreenshotRequest(options: {
  organizationId: string;
  requestId: string;
  actorUserId: string;
  actorRole: Role;
  context?: AuditContext;
}) {
  const policy = await getOrCreateScreenshotPolicy(options.organizationId);
  assertScreenshotManageAllowed(policy, options.actorRole);
  await markRequestExpiredIfOverdue(options.requestId, options.organizationId);

  const now = new Date();
  const outcome = await sequelize.transaction(async (transaction) => {
    const request = await ScreenshotRequest.findOne({
      where: { id: options.requestId, organizationId: options.organizationId },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!request) {
      throw AppError.notFound('Screenshot request not found', 'SCREENSHOT_REQUEST_NOT_FOUND');
    }
    if (!isActiveStatus(request.status)) {
      throw AppError.conflict(
        'This screenshot request can no longer be cancelled',
        'SCREENSHOT_REQUEST_NOT_CANCELLABLE',
      );
    }

    await request.update(
      {
        status: 'CANCELLED',
        cancelledAt: now,
        failureCode: 'CANCELLED',
        failureMessage: 'The requesting administrator cancelled this screenshot request.',
        uploadTokenHash: null,
        uploadExpiresAt: null,
      },
      { transaction },
    );

    await recordAuditEvent(
      {
        organizationId: request.organizationId,
        actorUserId: options.actorUserId,
        targetEmployeeId: request.employeeId,
        action: 'SCREENSHOT_REQUEST_CANCELLED',
        entityId: request.id,
        screenshotRequestId: request.id,
        metadata: { status: request.status },
      },
      { transaction, context: options.context },
    );

    return { request, storageKey: request.storageKey, agentId: request.desktopAgentId };
  });

  await deleteObjectAndClearKey(outcome.storageKey, outcome.request.id);
  if (outcome.agentId) {
    agentHub.publishToAgent(outcome.agentId, {
      type: 'screenshot.cancelled',
      requestId: outcome.request.id,
      reason: 'CANCELLED',
      serverTime: now.toISOString(),
    });
  }

  return toScreenshotRequestSummary(
    await loadRequestWithAssociations(outcome.request.id, options.organizationId),
  );
}

export async function getPendingScreenshotRequestsForAgent(
  organizationId: string,
  agent: DesktopAgentModel,
) {
  const now = new Date();
  await expireOverdueRequests(now);
  const requests = await ScreenshotRequest.findAll({
    where: {
      organizationId,
      employeeId: agent.userId,
      desktopAgentId: agent.id,
      status: { [Op.in]: ACTIVE_SCREENSHOT_REQUEST_STATUSES },
      expiresAt: { [Op.gt]: now },
    },
    order: [['requestedAt', 'ASC']],
  });
  return requests.map(toScreenshotPendingSummary);
}

export async function acknowledgeScreenshotRequest(options: {
  organizationId: string;
  requestId: string;
  employeeId: string;
  agentId: string;
  context?: AuditContext;
}) {
  const now = new Date();
  const existing = await ScreenshotRequest.findOne({
    where: {
      id: options.requestId,
      organizationId: options.organizationId,
      employeeId: options.employeeId,
      desktopAgentId: options.agentId,
    },
  });
  if (!existing) {
    throw AppError.notFound('Screenshot request not found', 'SCREENSHOT_REQUEST_NOT_FOUND');
  }
  if (isActiveStatus(existing.status) && existing.expiresAt.getTime() <= now.getTime()) {
    await markRequestExpired(existing.id, now, 'request');
    throw AppError.conflict('Screenshot request has expired', 'SCREENSHOT_REQUEST_EXPIRED');
  }
  if (!isActiveStatus(existing.status)) {
    throw AppError.conflict(
      `Screenshot request is ${existing.status}`,
      'SCREENSHOT_REQUEST_NOT_ACTIVE',
    );
  }

  if (!existing.acknowledgedAt) {
    await existing.update({ acknowledgedAt: now });
    await recordAuditEvent(
      {
        organizationId: existing.organizationId,
        actorUserId: existing.employeeId,
        targetEmployeeId: existing.employeeId,
        action: 'SCREENSHOT_REQUEST_ACKNOWLEDGED',
        entityId: existing.id,
        screenshotRequestId: existing.id,
        metadata: { desktopAgentId: existing.desktopAgentId },
      },
      { context: options.context },
    );
  }
  return {
    requestId: existing.id,
    status: existing.status,
    acknowledgedAt: existing.acknowledgedAt ?? now,
    expiresAt: existing.expiresAt,
  };
}

async function buildUploadAuthorization(
  organizationId: string,
  request: ScreenshotRequestModel,
  uploadToken: string,
) {
  if (!request.storageKey || !request.expectedContentType || !request.uploadExpiresAt) {
    throw AppError.internal('Screenshot upload authorization is incomplete', 'SCREENSHOT_STORAGE_ERROR');
  }
  const target = await screenshotStorage.createUploadTarget({
    objectKey: request.storageKey,
    contentType: request.expectedContentType,
    expiresAt: request.uploadExpiresAt,
    uploadToken,
  });
  return {
    method: target.method,
    url: target.url,
    headers: target.headers,
    requiredHeaders: target.requiresApiAuth
      ? { 'X-Organization-Id': organizationId }
      : {},
    requiresAgentAuth: target.requiresApiAuth,
    expiresAt: target.expiresAt,
    maxBytes: config.screenshots.maxBytes,
    contentType: request.expectedContentType,
  };
}

export async function claimScreenshotRequest(options: {
  organizationId: string;
  requestId: string;
  employeeId: string;
  agentId: string;
  contentType?: string | null;
  context?: AuditContext;
}) {
  const now = new Date();
  const policy = await getOrCreateScreenshotPolicy(options.organizationId);
  if (!policy.enabled) {
    throw AppError.forbidden(
      'Admin-initiated screenshots are disabled by this organization',
      'SCREENSHOT_POLICY_DISABLED',
    );
  }

  const existing = await ScreenshotRequest.findOne({
    where: {
      id: options.requestId,
      organizationId: options.organizationId,
      employeeId: options.employeeId,
      desktopAgentId: options.agentId,
    },
  });
  if (!existing) {
    throw AppError.notFound('Screenshot request not found', 'SCREENSHOT_REQUEST_NOT_FOUND');
  }
  if (isActiveStatus(existing.status) && existing.expiresAt.getTime() <= now.getTime()) {
    await markRequestExpired(existing.id, now, 'request');
    throw AppError.conflict('Screenshot request has expired', 'SCREENSHOT_REQUEST_EXPIRED');
  }
  if (existing.status === 'CLAIMED') {
    throw AppError.conflict('Screenshot request has already been claimed', 'SCREENSHOT_ALREADY_CLAIMED');
  }
  if (existing.status === 'COMPLETED') {
    throw AppError.conflict(
      'This screenshot request was already completed',
      'SCREENSHOT_ALREADY_COMPLETED',
    );
  }
  if (existing.status === 'EXPIRED') {
    throw AppError.conflict('Screenshot request has expired', 'SCREENSHOT_REQUEST_EXPIRED');
  }
  if (existing.status !== 'PENDING') {
    throw AppError.conflict(
      `Screenshot request is ${existing.status}`,
      'SCREENSHOT_REQUEST_NOT_ACTIVE',
    );
  }

  const requestedType =
    normalizeContentType(options.contentType) ??
    normalizeContentType(existing.expectedContentType) ??
    'image/png';
  if (!isAllowedScreenshotContentType(requestedType)) {
    throw new AppError(415, 'UNSUPPORTED_SCREENSHOT_TYPE', 'Unsupported screenshot image type');
  }
  const extension = SCREENSHOT_EXTENSIONS[requestedType] ?? 'bin';
  const uploadToken = generateOpaqueToken();
  const uploadExpiresAt = new Date(
    Math.min(
      now.getTime() + config.screenshots.uploadTtlSeconds * 1000,
      existing.expiresAt.getTime(),
    ),
  );
  const storageKey = `organizations/${options.organizationId}/screenshots/${existing.id}/${generateUuid()}.${extension}`;

  const outcome = await sequelize.transaction(async (transaction) => {
    const request = await ScreenshotRequest.findOne({
      where: {
        id: options.requestId,
        organizationId: options.organizationId,
        employeeId: options.employeeId,
        desktopAgentId: options.agentId,
      },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!request) {
      throw AppError.notFound('Screenshot request not found', 'SCREENSHOT_REQUEST_NOT_FOUND');
    }
    if (request.status === 'CLAIMED') {
      throw AppError.conflict(
        'Screenshot request has already been claimed',
        'SCREENSHOT_ALREADY_CLAIMED',
      );
    }
    if (request.status === 'COMPLETED') {
      throw AppError.conflict(
        'This screenshot request was already completed',
        'SCREENSHOT_ALREADY_COMPLETED',
      );
    }
    if (request.status === 'EXPIRED') {
      throw AppError.conflict('Screenshot request has expired', 'SCREENSHOT_REQUEST_EXPIRED');
    }
    if (request.status !== 'PENDING') {
      throw AppError.conflict(
        `Screenshot request is ${request.status}`,
        'SCREENSHOT_REQUEST_NOT_ACTIVE',
      );
    }
    if (request.expiresAt.getTime() <= now.getTime()) {
      throw AppError.conflict('Screenshot request has expired', 'SCREENSHOT_REQUEST_EXPIRED');
    }

    const linkedSession = request.timeSessionId
      ? await TimeSession.findOne({
          where: {
            id: request.timeSessionId,
            organizationId: request.organizationId,
            employeeId: request.employeeId,
            desktopAgentId: request.desktopAgentId,
          },
          transaction,
        })
      : null;
    if (!linkedSession || linkedSession.status !== 'ACTIVE' || linkedSession.endedAt) {
      throw AppError.conflict(
        'The linked time session is no longer active',
        'SCREENSHOT_SESSION_NOT_ACTIVE',
      );
    }

    await request.update(
      {
        status: 'CLAIMED',
        claimedAt: now,
        expectedContentType: requestedType,
        storageKey,
        uploadTokenHash: hashOpaqueToken(uploadToken, config.auth.tokenPepper),
        uploadExpiresAt,
      },
      { transaction },
    );

    await recordAuditEvent(
      {
        organizationId: request.organizationId,
        actorUserId: request.employeeId,
        targetEmployeeId: request.employeeId,
        action: 'SCREENSHOT_REQUEST_CLAIMED',
        entityId: request.id,
        screenshotRequestId: request.id,
        metadata: {
          desktopAgentId: request.desktopAgentId,
          contentType: requestedType,
          uploadExpiresAt: uploadExpiresAt.toISOString(),
        },
      },
      { transaction, context: options.context },
    );

    return request;
  });

  return {
    requestId: outcome.id,
    status: outcome.status,
    claimedAt: outcome.claimedAt,
    expiresAt: outcome.expiresAt,
    upload: await buildUploadAuthorization(options.organizationId, outcome, uploadToken),
  };
}

export async function reauthorizeScreenshotUpload(options: {
  organizationId: string;
  requestId: string;
  employeeId: string;
  agentId: string;
  contentType?: string | null;
}) {
  const now = new Date();

  // With direct-to-S3 uploads the API never sees the PUT, so a successful
  // upload cannot clear uploadedAt. If the object already exists, the agent
  // must call complete rather than overwrite it with a fresh authorization.
  const current = await ScreenshotRequest.findOne({
    where: {
      id: options.requestId,
      organizationId: options.organizationId,
      employeeId: options.employeeId,
      desktopAgentId: options.agentId,
    },
    attributes: ['id', 'status', 'uploadedAt', 'storageKey'],
  });
  if (!current) {
    throw AppError.notFound('Screenshot request not found', 'SCREENSHOT_REQUEST_NOT_FOUND');
  }
  if (current.status === 'CLAIMED' && !current.uploadedAt && current.storageKey) {
    const existingObject = await screenshotStorage.statObject(current.storageKey);
    if (existingObject) {
      throw AppError.conflict(
        'The screenshot has already been uploaded',
        'SCREENSHOT_ALREADY_UPLOADED',
      );
    }
  }

  const uploadToken = generateOpaqueToken();
  const uploadExpiresAt = new Date(now.getTime() + config.screenshots.uploadTtlSeconds * 1000);

  const outcome = await sequelize.transaction(async (transaction) => {
    const request = await ScreenshotRequest.findOne({
      where: {
        id: options.requestId,
        organizationId: options.organizationId,
        employeeId: options.employeeId,
        desktopAgentId: options.agentId,
      },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!request) {
      throw AppError.notFound('Screenshot request not found', 'SCREENSHOT_REQUEST_NOT_FOUND');
    }
    if (request.status !== 'CLAIMED') {
      throw AppError.conflict(
        `Screenshot request is ${request.status}`,
        'SCREENSHOT_REQUEST_NOT_ACTIVE',
      );
    }
    if (request.uploadedAt) {
      throw AppError.conflict('The screenshot has already been uploaded', 'SCREENSHOT_ALREADY_UPLOADED');
    }
    if (request.expiresAt.getTime() <= now.getTime()) {
      throw AppError.conflict('Screenshot request has expired', 'SCREENSHOT_REQUEST_EXPIRED');
    }

    const requestedType = normalizeContentType(options.contentType) ?? request.expectedContentType;
    if (!isAllowedScreenshotContentType(requestedType)) {
      throw new AppError(415, 'UNSUPPORTED_SCREENSHOT_TYPE', 'Unsupported screenshot image type');
    }
    const nextUploadExpiry = new Date(
      Math.min(uploadExpiresAt.getTime(), request.expiresAt.getTime()),
    );
    await request.update(
      {
        expectedContentType: requestedType,
        uploadTokenHash: hashOpaqueToken(uploadToken, config.auth.tokenPepper),
        uploadExpiresAt: nextUploadExpiry,
      },
      { transaction },
    );
    return request;
  });

  return {
    requestId: outcome.id,
    status: outcome.status,
    upload: await buildUploadAuthorization(options.organizationId, outcome, uploadToken),
  };
}

export async function storeScreenshotUpload(options: {
  organizationId: string;
  agent: DesktopAgentModel;
  uploadToken: string;
  body: Buffer;
  contentType: string | null;
}) {
  const now = new Date();
  const tokenHash = hashOpaqueToken(options.uploadToken, config.auth.tokenPepper);
  const request = await ScreenshotRequest.findOne({
    where: {
      organizationId: options.organizationId,
      employeeId: options.agent.userId,
      desktopAgentId: options.agent.id,
      uploadTokenHash: tokenHash,
    },
  });
  if (!request) {
    throw AppError.notFound('Upload authorization is invalid', 'UPLOAD_AUTHORIZATION_INVALID');
  }
  if (request.status !== 'CLAIMED') {
    throw AppError.conflict(
      `Screenshot request is ${request.status}`,
      'SCREENSHOT_REQUEST_NOT_ACTIVE',
    );
  }
  if (
    !request.uploadExpiresAt ||
    request.uploadExpiresAt.getTime() <= now.getTime()
  ) {
    throw AppError.gone('Upload authorization has expired', 'UPLOAD_AUTHORIZATION_EXPIRED');
  }
  if (request.expiresAt.getTime() <= now.getTime()) {
    await markRequestExpired(request.id, now, 'request');
    throw AppError.conflict('Screenshot request has expired', 'SCREENSHOT_REQUEST_EXPIRED');
  }

  const contentType = normalizeContentType(options.contentType);
  const validatedContentType = validateUploadedScreenshot({
    contentType,
    expectedContentType: request.expectedContentType,
    sizeBytes: options.body.length,
    prefix: options.body.subarray(0, 16),
  });
  if (!request.storageKey) {
    throw AppError.internal('Screenshot request has no storage key', 'SCREENSHOT_STORAGE_ERROR');
  }

  let wroteObject = false;
  try {
    const written = await sequelize.transaction(async (transaction) => {
      const locked = await ScreenshotRequest.findByPk(request.id, {
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      if (!locked || locked.status !== 'CLAIMED') {
        throw AppError.conflict(
          'Screenshot request is no longer active',
          'SCREENSHOT_REQUEST_NOT_ACTIVE',
        );
      }
      if (locked.uploadedAt) {
        throw AppError.conflict(
          'The screenshot has already been uploaded',
          'SCREENSHOT_ALREADY_UPLOADED',
        );
      }
      if (!locked.uploadExpiresAt || locked.uploadExpiresAt.getTime() <= now.getTime()) {
        throw AppError.gone(
          'Upload authorization has expired',
          'UPLOAD_AUTHORIZATION_EXPIRED',
        );
      }
      if (!locked.storageKey) {
        throw AppError.internal('Screenshot request has no storage key', 'SCREENSHOT_STORAGE_ERROR');
      }

      // The object key comes from the locked request row, never from the
      // client. A successful upload consumes the one-time token.
      const stored = await screenshotStorage.putObject({
        objectKey: locked.storageKey,
        body: options.body,
        contentType: validatedContentType,
      });
      wroteObject = true;
      await locked.update(
        {
          uploadedAt: now,
          uploadedSize: stored.sizeBytes,
          uploadedContentType: validatedContentType,
          uploadTokenHash: null,
          uploadExpiresAt: null,
        },
        { transaction },
      );
      return stored;
    });

    return {
      requestId: request.id,
      uploadedAt: now,
      sizeBytes: written.sizeBytes,
      contentType: validatedContentType,
    };
  } catch (error) {
    // Only remove the object when this request actually wrote it. A concurrent
    // duplicate upload must not delete the winner's bytes after its own
    // transaction is rejected.
    if (wroteObject && request.storageKey) {
      await screenshotStorage.deleteObject(request.storageKey).catch(() => undefined);
    }
    throw error;
  }
}

export async function completeScreenshotRequest(options: {
  organizationId: string;
  requestId: string;
  employeeId: string;
  agentId: string;
  captureTimestamp?: string | null;
  context?: AuditContext;
}) {
  const now = new Date();
  const existing = await ScreenshotRequest.findOne({
    where: {
      id: options.requestId,
      organizationId: options.organizationId,
      employeeId: options.employeeId,
      desktopAgentId: options.agentId,
    },
  });
  if (!existing) {
    throw AppError.notFound('Screenshot request not found', 'SCREENSHOT_REQUEST_NOT_FOUND');
  }
  if (existing.status === 'COMPLETED') {
    throw AppError.conflict(
      'This screenshot request was already completed',
      'SCREENSHOT_ALREADY_COMPLETED',
    );
  }
  if (isActiveStatus(existing.status) && existing.expiresAt.getTime() <= now.getTime()) {
    await markRequestExpired(existing.id, now, 'request');
    throw AppError.conflict('Screenshot request has expired', 'SCREENSHOT_REQUEST_EXPIRED');
  }
  if (existing.status !== 'CLAIMED') {
    throw AppError.conflict(
      `Screenshot request is ${existing.status}`,
      'SCREENSHOT_REQUEST_NOT_ACTIVE',
    );
  }
  if (!existing.storageKey) {
    throw AppError.conflict('No screenshot has been uploaded', 'SCREENSHOT_UPLOAD_NOT_FOUND');
  }

  const captureTimestamp = parseCaptureTimestamp(
    options.captureTimestamp,
    existing.claimedAt ?? existing.requestedAt,
    now,
  );
  const policy = await getOrCreateScreenshotPolicy(options.organizationId);

  const stored = await screenshotStorage.statObject(existing.storageKey);
  if (!stored) {
    throw AppError.conflict('No screenshot has been uploaded', 'SCREENSHOT_UPLOAD_NOT_FOUND');
  }
  // Check the size before issuing a range read; S3 rejects an empty range.
  assertScreenshotSize(stored.sizeBytes);
  const prefix = await screenshotStorage.readPrefix(existing.storageKey, 16);
  const storedContentType = normalizeContentType(stored.contentType ?? existing.uploadedContentType);
  const validatedContentType = validateUploadedScreenshot({
    contentType: storedContentType,
    expectedContentType: existing.expectedContentType,
    sizeBytes: stored.sizeBytes,
    prefix,
  });
  if (existing.uploadedSize !== null && existing.uploadedSize !== stored.sizeBytes) {
    throw AppError.conflict(
      'The uploaded screenshot changed before completion',
      'SCREENSHOT_FILE_CHANGED',
    );
  }

  const outcome = await sequelize.transaction(async (transaction) => {
    const request = await ScreenshotRequest.findOne({
      where: {
        id: options.requestId,
        organizationId: options.organizationId,
        employeeId: options.employeeId,
        desktopAgentId: options.agentId,
      },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!request) {
      throw AppError.notFound('Screenshot request not found', 'SCREENSHOT_REQUEST_NOT_FOUND');
    }
    if (request.status === 'COMPLETED') {
      throw AppError.conflict(
        'This screenshot request was already completed',
        'SCREENSHOT_ALREADY_COMPLETED',
      );
    }
    if (request.status !== 'CLAIMED') {
      throw AppError.conflict(
        `Screenshot request is ${request.status}`,
        'SCREENSHOT_REQUEST_NOT_ACTIVE',
      );
    }
    if (request.expiresAt.getTime() <= now.getTime()) {
      throw AppError.conflict('Screenshot request has expired', 'SCREENSHOT_REQUEST_EXPIRED');
    }
    if (!request.storageKey) {
      throw AppError.conflict('No screenshot has been uploaded', 'SCREENSHOT_UPLOAD_NOT_FOUND');
    }

    const retentionExpiresAt = new Date(
      now.getTime() + policy.retentionDays * 86_400_000,
    );
    const screenshot = await Screenshot.create(
      {
        organizationId: request.organizationId,
        employeeId: request.employeeId,
        timeSessionId: request.timeSessionId,
        screenshotRequestId: request.id,
        requestingAdminId: request.requestingAdminId,
        capturedAt: captureTimestamp,
        storageKey: request.storageKey,
        contentType: validatedContentType,
        fileSizeBytes: stored.sizeBytes,
        retentionExpiresAt,
      },
      { transaction },
    );

    await request.update(
      {
        status: 'COMPLETED',
        completedAt: now,
        uploadTokenHash: null,
        uploadExpiresAt: null,
      },
      { transaction },
    );

    await recordAuditEvent(
      {
        organizationId: request.organizationId,
        actorUserId: request.employeeId,
        targetEmployeeId: request.employeeId,
        action: 'SCREENSHOT_REQUEST_COMPLETED',
        entityType: 'SCREENSHOT',
        entityId: screenshot.id,
        screenshotRequestId: request.id,
        screenshotId: screenshot.id,
        metadata: {
          desktopAgentId: request.desktopAgentId,
          contentType: validatedContentType,
          fileSizeBytes: stored.sizeBytes,
          retentionExpiresAt: retentionExpiresAt.toISOString(),
        },
      },
      { transaction, context: options.context },
    );

    return screenshot;
  });

  return toScreenshotSummary(outcome);
}

export async function failScreenshotRequest(options: {
  organizationId: string;
  requestId: string;
  employeeId: string;
  agentId: string;
  code: string;
  message?: string | null;
  context?: AuditContext;
}) {
  const code = options.code.trim().toUpperCase();
  if (!/^[A-Z0-9_]{1,64}$/.test(code)) {
    throw AppError.unprocessable(
      'Failure code must contain only A-Z, 0-9, and underscores',
      'VALIDATION_ERROR',
      [{ path: 'body.code', message: 'Invalid failure code' }],
    );
  }
  const safeMessage = options.message?.trim().slice(0, 500) || null;
  const now = new Date();

  const existing = await ScreenshotRequest.findOne({
    where: {
      id: options.requestId,
      organizationId: options.organizationId,
      employeeId: options.employeeId,
      desktopAgentId: options.agentId,
    },
  });
  if (!existing) {
    throw AppError.notFound('Screenshot request not found', 'SCREENSHOT_REQUEST_NOT_FOUND');
  }
  if (isActiveStatus(existing.status) && existing.expiresAt.getTime() <= now.getTime()) {
    await markRequestExpired(existing.id, now, 'request');
    throw AppError.conflict('Screenshot request has expired', 'SCREENSHOT_REQUEST_EXPIRED');
  }

  const outcome = await sequelize.transaction(async (transaction) => {
    const request = await ScreenshotRequest.findOne({
      where: {
        id: options.requestId,
        organizationId: options.organizationId,
        employeeId: options.employeeId,
        desktopAgentId: options.agentId,
      },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!request) {
      throw AppError.notFound('Screenshot request not found', 'SCREENSHOT_REQUEST_NOT_FOUND');
    }
    if (!isActiveStatus(request.status)) {
      throw AppError.conflict(
        `Screenshot request is ${request.status}`,
        'SCREENSHOT_REQUEST_NOT_ACTIVE',
      );
    }

    await request.update(
      {
        status: 'FAILED',
        failureCode: code,
        failureMessage: safeMessage,
        uploadTokenHash: null,
        uploadExpiresAt: null,
      },
      { transaction },
    );

    await recordAuditEvent(
      {
        organizationId: request.organizationId,
        actorUserId: request.employeeId,
        targetEmployeeId: request.employeeId,
        action: 'SCREENSHOT_REQUEST_FAILED',
        entityId: request.id,
        screenshotRequestId: request.id,
        metadata: { code, message: safeMessage, desktopAgentId: request.desktopAgentId },
      },
      { transaction, context: options.context },
    );

    return { request, storageKey: request.storageKey };
  });

  await deleteObjectAndClearKey(outcome.storageKey, outcome.request.id);
  return toScreenshotRequestSummary(
    await loadRequestWithAssociations(outcome.request.id, options.organizationId),
  );
}

function parseCaptureTimestamp(
  value: string | null | undefined,
  claimedAt: Date,
  now: Date,
): Date {
  if (!value) return now;
  const parsed = DateTime.fromISO(value, { setZone: true });
  if (!parsed.isValid) {
    throw AppError.unprocessable(
      'Capture timestamp must be a valid ISO-8601 timestamp',
      'VALIDATION_ERROR',
      [{ path: 'body.captureTimestamp', message: 'Invalid timestamp' }],
    );
  }
  const date = parsed.toJSDate();
  if (date.getTime() < claimedAt.getTime() - 5 * 60_000) {
    throw AppError.unprocessable(
      'Capture timestamp predates the claim',
      'INVALID_CAPTURE_TIMESTAMP',
      [{ path: 'body.captureTimestamp', message: 'Timestamp is too far in the past' }],
    );
  }
  if (date.getTime() > now.getTime() + 60_000) {
    throw AppError.unprocessable(
      'Capture timestamp is in the future',
      'INVALID_CAPTURE_TIMESTAMP',
      [{ path: 'body.captureTimestamp', message: 'Timestamp is in the future' }],
    );
  }
  return date;
}

export async function listScreenshotsForAdmin(options: {
  organizationId: string;
  actorRole: Role;
  page: number;
  limit: number;
  employeeId?: string;
  sessionId?: string;
  from?: Date;
  to?: Date;
}) {
  const policy = await getOrCreateScreenshotPolicy(options.organizationId);
  assertScreenshotViewAllowed(policy, options.actorRole);
  await expireOverdueRequests();

  const where: Record<string, unknown> = {
    organizationId: options.organizationId,
    retentionExpiresAt: { [Op.gt]: new Date() },
  };
  if (options.employeeId) where.employeeId = options.employeeId;
  if (options.sessionId) where.timeSessionId = options.sessionId;
  if (options.from || options.to) {
    const capturedAt: Record<symbol, Date> = {};
    if (options.from) capturedAt[Op.gte] = options.from;
    if (options.to) capturedAt[Op.lte] = options.to;
    where.capturedAt = capturedAt;
  }

  const result = await Screenshot.findAndCountAll({
    where,
    include: SCREENSHOT_INCLUDES,
    order: [
      ['capturedAt', 'DESC'],
      ['id', 'ASC'],
    ],
    limit: options.limit,
    offset: (options.page - 1) * options.limit,
    distinct: true,
  });

  return paginate(
    result.rows.map(toScreenshotSummary),
    result.count,
    options.page,
    options.limit,
  );
}

export async function listScreenshotAuditEventsForAdmin(options: {
  organizationId: string;
  actorRole: Role;
  page: number;
  limit: number;
  employeeId?: string;
  requestId?: string;
  action?: (typeof SCREENSHOT_AUDIT_ACTIONS)[number];
  from?: Date;
  to?: Date;
}) {
  const policy = await getOrCreateScreenshotPolicy(options.organizationId);
  assertScreenshotViewAllowed(policy, options.actorRole);

  const where: Record<string, unknown> = {
    organizationId: options.organizationId,
    action: options.action ?? { [Op.in]: [...SCREENSHOT_AUDIT_ACTIONS] },
  };
  if (options.employeeId) where.targetEmployeeId = options.employeeId;
  if (options.requestId) where.screenshotRequestId = options.requestId;
  if (options.from || options.to) {
    const createdAt: Record<symbol, Date> = {};
    if (options.from) createdAt[Op.gte] = options.from;
    if (options.to) createdAt[Op.lte] = options.to;
    where.createdAt = createdAt;
  }

  const result = await AuditEvent.findAndCountAll({
    where,
    include: [
      { model: User, as: 'actor', required: false, attributes: ['id', 'name', 'email'] },
      {
        model: User,
        as: 'targetEmployee',
        required: false,
        attributes: ['id', 'name', 'email'],
      },
    ],
    order: [
      ['createdAt', 'DESC'],
      ['id', 'ASC'],
    ],
    limit: options.limit,
    offset: (options.page - 1) * options.limit,
    distinct: true,
  });

  return paginate(
    result.rows.map(toScreenshotAuditEventSummary),
    result.count,
    options.page,
    options.limit,
  );
}

export async function getScreenshotForAdmin(options: {
  organizationId: string;
  screenshotId: string;
  actorRole: Role;
}) {
  const policy = await getOrCreateScreenshotPolicy(options.organizationId);
  assertScreenshotViewAllowed(policy, options.actorRole);
  const screenshot = await loadScreenshotWithAssociations(
    options.screenshotId,
    options.organizationId,
  );
  if (screenshot.retentionExpiresAt.getTime() <= Date.now()) {
    throw AppError.notFound('Screenshot not found', 'SCREENSHOT_NOT_FOUND');
  }
  return toScreenshotSummary(screenshot);
}

export async function createScreenshotAccess(options: {
  organizationId: string;
  screenshotId: string;
  actorUserId: string;
  actorRole: Role;
  context?: AuditContext;
}) {
  const policy = await getOrCreateScreenshotPolicy(options.organizationId);
  assertScreenshotViewAllowed(policy, options.actorRole);
  const screenshot = await loadScreenshotWithAssociations(
    options.screenshotId,
    options.organizationId,
  );
  if (screenshot.retentionExpiresAt.getTime() <= Date.now()) {
    throw AppError.notFound('Screenshot not found', 'SCREENSHOT_NOT_FOUND');
  }

  const expiresAt = new Date(Date.now() + config.screenshots.downloadTtlSeconds * 1000);
  const access = await screenshotStorage.createDownloadUrl({
    screenshotId: screenshot.id,
    organizationId: options.organizationId,
    actorUserId: options.actorUserId,
    objectKey: screenshot.storageKey,
    expiresAt,
  });

  await recordAuditEvent(
    {
      organizationId: options.organizationId,
      actorUserId: options.actorUserId,
      targetEmployeeId: screenshot.employeeId,
      action: 'SCREENSHOT_ACCESS_GRANTED',
      entityType: 'SCREENSHOT',
      entityId: screenshot.id,
      screenshotRequestId: screenshot.screenshotRequestId,
      screenshotId: screenshot.id,
      metadata: {
        expiresAt: access.expiresAt.toISOString(),
        storageDriver: screenshotStorage.driver,
      },
    },
    { context: options.context },
  );

  return {
    screenshot: toScreenshotSummary(screenshot),
    url: access.url,
    expiresAt: access.expiresAt,
  };
}

export async function openScreenshotFile(token: string, context?: AuditContext) {
  const verified = verifyScreenshotDownloadToken(token);
  if (!verified) {
    throw AppError.notFound('Screenshot link is invalid or expired', 'SCREENSHOT_LINK_INVALID');
  }

  // A valid signature is not enough if the tenant was suspended after the link
  // was minted. Short-lived links must not outlive organization access.
  const organization = await Organization.findOne({
    where: { id: verified.organizationId, status: 'ACTIVE', deletedAt: null },
    attributes: ['id'],
  });
  if (!organization) {
    throw AppError.notFound('Screenshot not found', 'SCREENSHOT_NOT_FOUND');
  }

  const screenshot = await Screenshot.findOne({
    where: { id: verified.screenshotId, organizationId: verified.organizationId },
  });
  if (!screenshot || screenshot.retentionExpiresAt.getTime() <= Date.now()) {
    throw AppError.notFound('Screenshot not found', 'SCREENSHOT_NOT_FOUND');
  }

  const object = await screenshotStorage.openObject(screenshot.storageKey);
  if (!object) {
    throw AppError.notFound('Screenshot not found', 'SCREENSHOT_NOT_FOUND');
  }

  await recordAuditEvent(
    {
      organizationId: screenshot.organizationId,
      actorUserId: verified.actorUserId,
      targetEmployeeId: screenshot.employeeId,
      action: 'SCREENSHOT_VIEWED',
      entityType: 'SCREENSHOT',
      entityId: screenshot.id,
      screenshotRequestId: screenshot.screenshotRequestId,
      screenshotId: screenshot.id,
      metadata: { source: 'SIGNED_URL' },
    },
    { context },
  );

  return {
    stream: object.stream,
    sizeBytes: object.sizeBytes,
    contentType: screenshot.contentType,
  };
}

export const SCREENSHOT_STATUS_VALUES = SCREENSHOT_REQUEST_STATUSES;
