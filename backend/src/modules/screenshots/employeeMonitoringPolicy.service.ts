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
import { hasPermission } from '../memberships/permissions';
import type { Role } from '../memberships/roles';
import { recordAuditEvent, type AuditContext } from './audit.service';
import type { EmployeeMonitoringPolicy as EmployeeMonitoringPolicyModel } from './employeeMonitoringPolicy.model';
import { ACTIVE_SCREENSHOT_REQUEST_STATUSES } from './screenshotRequest.model';
import { screenshotStorage } from './storage';

export const EMPLOYEE_MONITORING_DISABLED = 'EMPLOYEE_MONITORING_POLICY_DISABLED';

type EmployeeMonitoringPolicySummary = {
  employeeId: string;
  enabled: boolean;
  organizationEnabled: boolean;
  effectiveEnabled: boolean;
  updatedAt: Date | null;
  updatedBy: { id: string; name: string; email: string } | null;
};

function toSummary(
  employeeId: string,
  policy: EmployeeMonitoringPolicyModel | null,
  organizationEnabled: boolean,
): EmployeeMonitoringPolicySummary {
  const enabled = policy?.enabled ?? false;
  return {
    employeeId,
    enabled,
    organizationEnabled,
    effectiveEnabled: enabled && organizationEnabled,
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

export async function getEmployeeMonitoringPolicyView(options: {
  organizationId: string;
  employeeId: string;
  actorRole: Role;
}): Promise<EmployeeMonitoringPolicySummary> {
  if (!hasPermission(options.actorRole, 'screenshot:policy')) {
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
 * removed by disabling monitoring.
 */
async function cancelActiveScreenshotRequestsForEmployee(options: {
  organizationId: string;
  employeeId: string;
  actorUserId: string;
  context?: AuditContext;
}): Promise<void> {
  const active = await ScreenshotRequest.findAll({
    where: {
      organizationId: options.organizationId,
      employeeId: options.employeeId,
      status: { [Op.in]: ACTIVE_SCREENSHOT_REQUEST_STATUSES },
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
          failureCode: 'EMPLOYEE_MONITORING_DISABLED',
          failureMessage: 'Monitoring was disabled for this employee by the organization owner.',
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
            reason: 'EMPLOYEE_MONITORING_DISABLED',
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
        reason: 'EMPLOYEE_MONITORING_DISABLED',
        serverTime: new Date().toISOString(),
      });
    }
  }
}

export async function updateEmployeeMonitoringPolicy(options: {
  organizationId: string;
  employeeId: string;
  actorUserId: string;
  actorRole: Role;
  enabled: boolean;
  context?: AuditContext;
}): Promise<EmployeeMonitoringPolicySummary> {
  if (options.actorRole !== 'OWNER' || !hasPermission(options.actorRole, 'screenshot:policy')) {
    throw AppError.forbidden(
      'Only an organization owner can change an employee monitoring policy',
      'PERMISSION_DENIED',
    );
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
        updatedByUserId: null,
      },
      transaction,
    });

    const previousValue = policy.enabled;
    if (previousValue !== options.enabled) {
      await policy.update(
        {
          enabled: options.enabled,
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
            previousValue,
            newValue: options.enabled,
            updatedByUserId: options.actorUserId,
            timestamp: new Date().toISOString(),
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
    // Idempotent cleanup also covers a request that raced with a previous
    // disable, without touching completed/historical captures.
    await cancelActiveScreenshotRequestsForEmployee({
      organizationId: options.organizationId,
      employeeId: options.employeeId,
      actorUserId: options.actorUserId,
      context: options.context,
    });
  }

  const updated = await loadPolicy(options.organizationId, options.employeeId);
  return toSummary(options.employeeId, updated, outcome.organizationEnabled);
}
