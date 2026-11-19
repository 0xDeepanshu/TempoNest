import { Op, type Transaction } from 'sequelize';
import {
  EmployeeMonitoringPolicy,
  Membership,
  ScreenshotPolicy,
  ScreenshotRequest,
  User,
  sequelize,
} from '../../database';
import { logger } from '../../config/logger';
import { AppError } from '../../utils/errors';
import { agentHub } from '../../realtime/agentHub';
import { hasPermission, type PermissionSubject } from '../memberships/permissions';
import type { Role } from '../memberships/roles';
import { recordAuditEvent, type AuditContext } from './audit.service';
import {
  DEFAULT_CAPTURE_INTERVAL_MINUTES,
  SCHEDULED_CAPTURE_IDEMPOTENCY_PREFIX,
  SUPPORTED_CAPTURE_INTERVALS,
  type EmployeeMonitoringPolicy as EmployeeMonitoringPolicyModel,
} from './employeeMonitoringPolicy.model';
import { ACTIVE_SCREENSHOT_REQUEST_STATUSES } from './screenshotRequest.model';
import { screenshotStorage } from './storage';

export const EMPLOYEE_MONITORING_DISABLED = 'EMPLOYEE_MONITORING_POLICY_DISABLED';

type ActorSubject = Role | PermissionSubject;

type EmployeeMonitoringPolicySummary = {
  employeeId: string;
  enabled: boolean;
  scheduledCaptureEnabled: boolean;
  scheduledCaptureActive: boolean;
  captureIntervalMinutes: number;
  nextCaptureAt: Date | null;
  lastCaptureAt: Date | null;
  organizationEnabled: boolean;
  effectiveEnabled: boolean;
  updatedAt: Date | null;
  updatedBy: { id: string; name: string; email: string } | null;
};

type ScheduledCapturePolicySummary = {
  employeeId: string;
  name: string;
  email: string;
  scheduledCaptureEnabled: boolean;
  scheduledCaptureActive: boolean;
  captureIntervalMinutes: number;
  nextCaptureAt: Date | null;
  lastCaptureAt: Date | null;
};

function toSummary(
  employeeId: string,
  policy: EmployeeMonitoringPolicyModel | null,
  organizationEnabled: boolean,
): EmployeeMonitoringPolicySummary {
  const enabled = policy?.enabled ?? false;
  const scheduledCaptureEnabled = policy?.scheduledCaptureEnabled ?? false;
  const effectiveEnabled = enabled && organizationEnabled;
  return {
    employeeId,
    enabled,
    scheduledCaptureEnabled,
    scheduledCaptureActive: scheduledCaptureEnabled && effectiveEnabled,
    captureIntervalMinutes: policy?.captureIntervalMinutes ?? DEFAULT_CAPTURE_INTERVAL_MINUTES,
    nextCaptureAt: policy?.nextCaptureAt ?? null,
    lastCaptureAt: policy?.lastCaptureAt ?? null,
    organizationEnabled,
    effectiveEnabled,
    updatedAt: policy?.updatedAt ?? null,
    updatedBy: policy?.updatedBy
      ? {
          id: policy.updatedBy.id,
          name: policy.updatedBy.name,
          email: policy.updatedBy.email,
        }
      : null,
  };
}

function assertSupportedInterval(interval: number): void {
  if (!(SUPPORTED_CAPTURE_INTERVALS as readonly number[]).includes(interval)) {
    throw AppError.unprocessable(
      `Capture interval must be one of ${SUPPORTED_CAPTURE_INTERVALS.join(', ')} minutes`,
      'VALIDATION_ERROR',
      [{ path: 'body.captureIntervalMinutes', message: 'Unsupported capture interval' }],
    );
  }
}

function nextCaptureFrom(now: Date, intervalMinutes: number): Date {
  return new Date(now.getTime() + intervalMinutes * 60_000);
}

async function assertEmployeeInOrganization(
  organizationId: string,
  employeeId: string,
  transaction?: Transaction,
): Promise<void> {
  const membership = await Membership.findOne({
    where: { organizationId, userId: employeeId, status: 'ACTIVE' },
    attributes: ['id'],
    ...(transaction ? { transaction } : {}),
  });
  if (!membership) {
    // Cross-organization employee IDs are deliberately indistinguishable from
    // employees that do not exist.
    throw AppError.notFound('Employee not found', 'EMPLOYEE_NOT_FOUND');
  }
}

async function loadPolicy(
  organizationId: string,
  employeeId: string,
  transaction?: Transaction,
): Promise<EmployeeMonitoringPolicyModel | null> {
  return EmployeeMonitoringPolicy.findOne({
    where: { organizationId, employeeId },
    include: [
      { model: User, as: 'updatedBy', required: false, attributes: ['id', 'name', 'email'] },
    ],
    ...(transaction ? { transaction } : {}),
  });
}

/**
 * Creates the default monitoring policy for a new or re-activated employee.
 * Callers run this inside the membership transaction so an employee never
 * exists without a policy row. Safe to call for an existing row.
 *
 * General monitoring is enabled so manual requests and live viewing keep
 * working under the existing policy. Scheduled capture is opt-in and starts
 * disabled for every new member.
 */
export async function createDefaultEmployeeMonitoringPolicy(options: {
  organizationId: string;
  employeeId: string;
  now?: Date;
  transaction?: Transaction;
}): Promise<void> {
  await EmployeeMonitoringPolicy.findOrCreate({
    where: {
      organizationId: options.organizationId,
      employeeId: options.employeeId,
    },
    defaults: {
      organizationId: options.organizationId,
      employeeId: options.employeeId,
      enabled: true,
      scheduledCaptureEnabled: false,
      captureIntervalMinutes: DEFAULT_CAPTURE_INTERVAL_MINUTES,
      nextCaptureAt: null,
      lastCaptureAt: null,
      updatedByUserId: null,
    },
    ...(options.transaction ? { transaction: options.transaction } : {}),
  });
}

async function isOrganizationMonitoringEnabled(
  organizationId: string,
  transaction?: Transaction,
): Promise<boolean> {
  const policy = await ScreenshotPolicy.findOne({
    where: { organizationId },
    attributes: ['enabled'],
    ...(transaction ? { transaction } : {}),
  });
  // The organization policy is created lazily by the global settings flow;
  // a missing row has the same meaning as an explicitly disabled policy.
  return policy?.enabled ?? false;
}

/** Missing rows mean the employee is not monitored. */
export async function isEmployeeMonitoringEnabled(
  organizationId: string,
  employeeId: string,
  transaction?: Transaction,
): Promise<boolean> {
  const policy = await EmployeeMonitoringPolicy.findOne({
    where: { organizationId, employeeId, enabled: true },
    attributes: ['id'],
    ...(transaction ? { transaction } : {}),
  });
  return policy !== null;
}

/** All employees in the organization whose individual policy is enabled. */
export async function listEmployeesWithMonitoringEnabled(
  organizationId: string,
  transaction?: Transaction,
): Promise<string[]> {
  const rows = await EmployeeMonitoringPolicy.findAll({
    where: { organizationId, enabled: true },
    attributes: ['employeeId'],
    ...(transaction ? { transaction } : {}),
  });
  return rows.map((row) => row.employeeId);
}

export async function assertEmployeeMonitoringEnabled(
  organizationId: string,
  employeeId: string,
  transaction?: Transaction,
): Promise<void> {
  if (!(await isEmployeeMonitoringEnabled(organizationId, employeeId, transaction))) {
    throw AppError.forbidden(
      'Screen monitoring is disabled for this employee by the organization owner',
      EMPLOYEE_MONITORING_DISABLED,
    );
  }
}

export const SCHEDULED_CAPTURE_DISABLED = 'SCHEDULED_CAPTURE_DISABLED';

/** Missing rows and rows with scheduled capture turned off are never captured. */
export async function isEmployeeScheduledCaptureEnabled(
  organizationId: string,
  employeeId: string,
  transaction?: Transaction,
): Promise<boolean> {
  const policy = await EmployeeMonitoringPolicy.findOne({
    where: {
      organizationId,
      employeeId,
      enabled: true,
      scheduledCaptureEnabled: true,
    },
    attributes: ['id'],
    ...(transaction ? { transaction } : {}),
  });
  return policy !== null;
}

export async function assertEmployeeScheduledCaptureEnabled(
  organizationId: string,
  employeeId: string,
  transaction?: Transaction,
): Promise<void> {
  if (!(await isEmployeeScheduledCaptureEnabled(organizationId, employeeId, transaction))) {
    throw AppError.forbidden(
      'Scheduled screenshot capture is disabled for this employee',
      SCHEDULED_CAPTURE_DISABLED,
    );
  }
}

export async function getEmployeeMonitoringPolicyView(options: {
  organizationId: string;
  employeeId: string;
  actor: ActorSubject;
}): Promise<EmployeeMonitoringPolicySummary> {
  if (!hasPermission(options.actor, 'screenshot:monitoring')) {
    throw AppError.forbidden(
      'Your role cannot view employee monitoring policies',
      'PERMISSION_DENIED',
    );
  }
  await assertEmployeeInOrganization(options.organizationId, options.employeeId);
  const [policy, organizationEnabled] = await Promise.all([
    loadPolicy(options.organizationId, options.employeeId),
    isOrganizationMonitoringEnabled(options.organizationId),
  ]);
  return toSummary(options.employeeId, policy, organizationEnabled);
}

/**
 * Cancels active requests through the existing CANCELLED lifecycle and stops
 * any pending agent capture. Historical screenshots and audit rows are never
 * removed. `scheduledOnly` limits the cleanup to server-scheduled requests, so
 * turning off the capture schedule never cancels an administrator's request.
 */
async function cancelActiveScreenshotRequestsForEmployee(options: {
  organizationId: string;
  employeeId: string;
  actorUserId: string;
  scheduledOnly?: boolean;
  context?: AuditContext;
}): Promise<void> {
  const failureCode = options.scheduledOnly
    ? SCHEDULED_CAPTURE_DISABLED
    : 'EMPLOYEE_MONITORING_DISABLED';
  const failureMessage = options.scheduledOnly
    ? 'Scheduled screenshot capture was disabled for this employee.'
    : 'Monitoring was disabled for this employee by the organization owner.';

  const active = await ScreenshotRequest.findAll({
    where: {
      organizationId: options.organizationId,
      employeeId: options.employeeId,
      status: { [Op.in]: ACTIVE_SCREENSHOT_REQUEST_STATUSES },
      ...(options.scheduledOnly
        ? { idempotencyKey: { [Op.like]: `${SCHEDULED_CAPTURE_IDEMPOTENCY_PREFIX}%` } }
        : {}),
    },
    attributes: ['id'],
  });

  for (const candidate of active) {
    const outcome = await sequelize.transaction(async (transaction) => {
      const request = await ScreenshotRequest.findByPk(candidate.id, {
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      if (
        !request ||
        request.organizationId !== options.organizationId ||
        request.employeeId !== options.employeeId ||
        !ACTIVE_SCREENSHOT_REQUEST_STATUSES.includes(request.status)
      ) {
        return null;
      }

      const previousStatus = request.status;
      const now = new Date();
      await request.update(
        {
          status: 'CANCELLED',
          cancelledAt: now,
          failureCode,
          failureMessage,
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
          metadata: {
            reason: failureCode,
            previousStatus,
            status: request.status,
          },
        },
        { transaction, context: options.context },
      );

      return {
        requestId: request.id,
        storageKey: request.storageKey,
        agentId: request.desktopAgentId,
      };
    });

    if (!outcome) continue;

    if (outcome.storageKey) {
      try {
        await screenshotStorage.deleteObject(outcome.storageKey);
        await ScreenshotRequest.update(
          { storageKey: null },
          { where: { id: outcome.requestId } },
        );
      } catch (error) {
        logger.warn(
          { err: error, requestId: outcome.requestId },
          'failed to delete screenshot storage for a cancelled employee request',
        );
      }
    }

    if (outcome.agentId) {
      agentHub.publishToAgent(outcome.agentId, {
        type: 'screenshot.cancelled',
        requestId: outcome.requestId,
        reason: failureCode,
        serverTime: new Date().toISOString(),
      });
    }
  }
}

export async function updateEmployeeMonitoringPolicy(options: {
  organizationId: string;
  employeeId: string;
  actorUserId: string;
  actor: ActorSubject;
  enabled?: boolean;
  scheduledCaptureEnabled?: boolean;
  captureIntervalMinutes?: number;
  context?: AuditContext;
}): Promise<EmployeeMonitoringPolicySummary> {
  if (!hasPermission(options.actor, 'screenshot:monitoring')) {
    throw AppError.forbidden(
      'Your role cannot change an employee monitoring policy',
      'PERMISSION_DENIED',
    );
  }
  if (
    options.enabled === undefined &&
    options.scheduledCaptureEnabled === undefined &&
    options.captureIntervalMinutes === undefined
  ) {
    throw AppError.unprocessable(
      'At least one policy field must be provided',
      'VALIDATION_ERROR',
      [
        {
          path: 'body',
          message: 'Provide enabled, scheduledCaptureEnabled and/or captureIntervalMinutes',
        },
      ],
    );
  }
  if (options.captureIntervalMinutes !== undefined) {
    assertSupportedInterval(options.captureIntervalMinutes);
  }

  const outcome = await sequelize.transaction(async (transaction) => {
    await assertEmployeeInOrganization(options.organizationId, options.employeeId, transaction);

    const [policy] = await EmployeeMonitoringPolicy.findOrCreate({
      where: {
        organizationId: options.organizationId,
        employeeId: options.employeeId,
      },
      defaults: {
        organizationId: options.organizationId,
        employeeId: options.employeeId,
        enabled: false,
        scheduledCaptureEnabled: false,
        captureIntervalMinutes: DEFAULT_CAPTURE_INTERVAL_MINUTES,
        nextCaptureAt: null,
        lastCaptureAt: null,
        updatedByUserId: null,
      },
      transaction,
    });

    const now = new Date();
    const previousEnabled = policy.enabled;
    const previousScheduledCaptureEnabled = policy.scheduledCaptureEnabled;
    const previousInterval = policy.captureIntervalMinutes;
    const nextEnabled = options.enabled ?? previousEnabled;
    const nextInterval = options.captureIntervalMinutes ?? previousInterval;

    // General monitoring off stops everything, so the schedule cannot outlive
    // it. Turning the general switch off also turns the schedule off; asking
    // explicitly to keep the schedule on is rejected below.
    let nextScheduledCaptureEnabled =
      options.scheduledCaptureEnabled ?? previousScheduledCaptureEnabled;
    if (!nextEnabled && options.scheduledCaptureEnabled === undefined) {
      nextScheduledCaptureEnabled = false;
    }

    if (nextScheduledCaptureEnabled && !nextEnabled) {
      throw AppError.unprocessable(
        'Scheduled capture requires general monitoring to be enabled',
        'VALIDATION_ERROR',
        [
          {
            path: 'body.scheduledCaptureEnabled',
            message: 'Enable monitoring before enabling scheduled capture',
          },
        ],
      );
    }

    // Automatic capture requires both switches. Only that combination owns a
    // pending slot; turning either switch off clears it.
    const previousActive = previousEnabled && previousScheduledCaptureEnabled;
    const nextActive = nextEnabled && nextScheduledCaptureEnabled;
    let nextCaptureAt = policy.nextCaptureAt;
    if (!nextActive) {
      nextCaptureAt = null;
    } else if (!previousActive || nextInterval !== previousInterval || !nextCaptureAt) {
      nextCaptureAt = nextCaptureFrom(now, nextInterval);
    }

    const enabledChanged = previousEnabled !== nextEnabled;
    const scheduledChanged = previousScheduledCaptureEnabled !== nextScheduledCaptureEnabled;
    const intervalChanged = previousInterval !== nextInterval;
    const previousNextCaptureAt = policy.nextCaptureAt;
    const scheduleChanged =
      (previousNextCaptureAt?.getTime() ?? null) !== (nextCaptureAt?.getTime() ?? null);

    if (enabledChanged || scheduledChanged || intervalChanged || scheduleChanged) {
      await policy.update(
        {
          enabled: nextEnabled,
          scheduledCaptureEnabled: nextScheduledCaptureEnabled,
          captureIntervalMinutes: nextInterval,
          nextCaptureAt,
          updatedByUserId: options.actorUserId,
        },
        { transaction },
      );

      await recordAuditEvent(
        {
          organizationId: options.organizationId,
          actorUserId: options.actorUserId,
          targetEmployeeId: options.employeeId,
          action: 'EMPLOYEE_MONITORING_POLICY_UPDATED',
          entityType: 'EMPLOYEE_MONITORING_POLICY',
          entityId: policy.id,
          metadata: {
            employeeId: options.employeeId,
            previousValue: previousEnabled,
            newValue: nextEnabled,
            previousScheduledCaptureEnabled,
            scheduledCaptureEnabled: nextScheduledCaptureEnabled,
            previousCaptureIntervalMinutes: previousInterval,
            captureIntervalMinutes: nextInterval,
            previousNextCaptureAt: previousNextCaptureAt?.toISOString() ?? null,
            nextCaptureAt: nextCaptureAt?.toISOString() ?? null,
            updatedByUserId: options.actorUserId,
            timestamp: now.toISOString(),
          },
        },
        { transaction, context: options.context },
      );
    }

    return {
      policy,
      organizationEnabled: await isOrganizationMonitoringEnabled(
        options.organizationId,
        transaction,
      ),
    };
  });

  if (!outcome.policy.enabled) {
    // General monitoring off stops everything, including scheduled captures.
    await cancelActiveScreenshotRequestsForEmployee({
      organizationId: options.organizationId,
      employeeId: options.employeeId,
      actorUserId: options.actorUserId,
      context: options.context,
    });
  } else if (!outcome.policy.scheduledCaptureEnabled) {
    // Only server-scheduled requests are cancelled here; manual requests stand.
    await cancelActiveScreenshotRequestsForEmployee({
      organizationId: options.organizationId,
      employeeId: options.employeeId,
      actorUserId: options.actorUserId,
      scheduledOnly: true,
      context: options.context,
    });
  }

  const updated = await loadPolicy(options.organizationId, options.employeeId);
  return toSummary(options.employeeId, updated, outcome.organizationEnabled);
}

/**
 * Overview for the owner/admin dashboard. Returns every active employee with
 * the effective scheduled-capture state so disabled employees are visible too.
 * Requires the dedicated monitoring permission; managers only see it once that
 * permission has been delegated.
 */
export async function listScheduledCaptureOverview(options: {
  organizationId: string;
  actor: ActorSubject;
}): Promise<ScheduledCapturePolicySummary[]> {
  if (!hasPermission(options.actor, 'screenshot:monitoring')) {
    throw AppError.forbidden(
      'Your role cannot view scheduled capture settings',
      'PERMISSION_DENIED',
    );
  }

  const [memberships, policies] = await Promise.all([
    Membership.findAll({
      where: { organizationId: options.organizationId, status: 'ACTIVE' },
      include: [{ model: User, as: 'user', required: true, attributes: ['id', 'name', 'email'] }],
      order: [['createdAt', 'ASC']],
    }),
    EmployeeMonitoringPolicy.findAll({ where: { organizationId: options.organizationId } }),
  ]);

  const byEmployee = new Map(policies.map((policy) => [policy.employeeId, policy]));

  return memberships.map((membership) => {
    const policy = byEmployee.get(membership.userId);
    const scheduledCaptureEnabled = policy?.scheduledCaptureEnabled ?? false;
    const enabled = policy?.enabled ?? false;
    return {
      employeeId: membership.userId,
      name: membership.user?.name ?? '',
      email: membership.user?.email ?? '',
      scheduledCaptureEnabled,
      scheduledCaptureActive: scheduledCaptureEnabled && enabled,
      captureIntervalMinutes: policy?.captureIntervalMinutes ?? DEFAULT_CAPTURE_INTERVAL_MINUTES,
      nextCaptureAt: policy?.nextCaptureAt ?? null,
      lastCaptureAt: policy?.lastCaptureAt ?? null,
    };
  });
}
