import type { Transaction } from 'sequelize';
import { ScreenshotPolicy, ScreenshotPolicyAcknowledgement, sequelize } from '../../database';
import { AppError } from '../../utils/errors';
import { hasPermission } from '../memberships/permissions';
import { ROLES, type Role } from '../memberships/roles';
import {
  DEFAULT_SCREENSHOT_DISCLOSURE_TEXT,
  DEFAULT_SCREENSHOT_REQUEST_ROLES,
  DEFAULT_SCREENSHOT_VIEW_ROLES,
  type ScreenshotPolicy as ScreenshotPolicyModel,
} from './screenshotPolicy.model';
import { recordAuditEvent, type AuditContext } from './audit.service';
import {
  toScreenshotPolicyDisclosure,
  toScreenshotPolicySummary,
} from './screenshot.mapper';

export type ScreenshotPolicyUpdateInput = {
  enabled?: boolean;
  requestRoles?: Role[];
  viewRoles?: Role[];
  requestCooldownSeconds?: number;
  retentionDays?: number;
  auditRetentionDays?: number;
  employeeAcknowledgementRequired?: boolean;
  disclosureVersion?: string;
  disclosureText?: string;
};

function validateRoleList(roles: Role[], field: 'requestRoles' | 'viewRoles'): void {
  if (roles.length === 0) {
    throw AppError.unprocessable(
      'At least one role is required',
      'VALIDATION_ERROR',
      [{ path: `body.${field}`, message: 'At least one role is required' }],
    );
  }
  if (new Set(roles).size !== roles.length) {
    throw AppError.unprocessable(
      'Roles must not contain duplicates',
      'VALIDATION_ERROR',
      [{ path: `body.${field}`, message: 'Roles must not contain duplicates' }],
    );
  }
  for (const role of roles) {
    if (!(ROLES as readonly string[]).includes(role)) {
      throw AppError.unprocessable(
        'Invalid role',
        'VALIDATION_ERROR',
        [{ path: `body.${field}`, message: `Invalid role: ${String(role)}` }],
      );
    }
  }
}

export async function getOrCreateScreenshotPolicy(
  organizationId: string,
  transaction?: Transaction,
): Promise<ScreenshotPolicyModel> {
  const [policy] = await ScreenshotPolicy.findOrCreate({
    where: { organizationId },
    defaults: {
      organizationId,
      enabled: false,
      requestRoles: [...DEFAULT_SCREENSHOT_REQUEST_ROLES],
      viewRoles: [...DEFAULT_SCREENSHOT_VIEW_ROLES],
      requestCooldownSeconds: 5,
      retentionDays: 30,
      auditRetentionDays: 365,
      employeeAcknowledgementRequired: false,
      disclosureVersion: 'v1',
      disclosureText: DEFAULT_SCREENSHOT_DISCLOSURE_TEXT,
    },
    ...(transaction ? { transaction } : {}),
  });
  return policy;
}

export function assertScreenshotRequestAllowed(
  policy: ScreenshotPolicyModel,
  role: Role,
): void {
  if (!policy.enabled) {
    throw AppError.forbidden(
      'Admin-initiated screenshots are disabled by this organization',
      'SCREENSHOT_POLICY_DISABLED',
    );
  }
  if (!hasPermission(role, 'screenshot:request')) {
    throw AppError.forbidden('Your role cannot request screenshots', 'PERMISSION_DENIED');
  }
  if (!policy.requestRoles.includes(role)) {
    throw AppError.forbidden(
      'The monitoring policy does not permit your role to request screenshots',
      'SCREENSHOT_ROLE_NOT_ALLOWED',
    );
  }
}

export function assertScreenshotViewAllowed(
  policy: ScreenshotPolicyModel,
  role: Role,
): void {
  if (!hasPermission(role, 'screenshot:read')) {
    throw AppError.forbidden('Your role cannot view screenshots', 'PERMISSION_DENIED');
  }
  if (!policy.viewRoles.includes(role)) {
    throw AppError.forbidden(
      'The monitoring policy does not permit your role to view screenshots',
      'SCREENSHOT_ROLE_NOT_ALLOWED',
    );
  }
}

export function assertScreenshotManageAllowed(
  policy: ScreenshotPolicyModel,
  role: Role,
): void {
  if (!hasPermission(role, 'screenshot:manage')) {
    throw AppError.forbidden('Your role cannot manage screenshot requests', 'PERMISSION_DENIED');
  }
  if (!policy.requestRoles.includes(role)) {
    throw AppError.forbidden(
      'The monitoring policy does not permit your role to manage screenshot requests',
      'SCREENSHOT_ROLE_NOT_ALLOWED',
    );
  }
}

export async function assertEmployeePolicyAcknowledgement(
  policy: ScreenshotPolicyModel,
  employeeId: string,
  transaction?: Transaction,
): Promise<void> {
  if (!policy.employeeAcknowledgementRequired) return;
  const acknowledgement = await ScreenshotPolicyAcknowledgement.findOne({
    where: {
      organizationId: policy.organizationId,
      employeeId,
      policyVersion: policy.disclosureVersion,
    },
    ...(transaction ? { transaction } : {}),
  });
  if (!acknowledgement) {
    throw AppError.conflict(
      'The employee must acknowledge the current screenshot monitoring disclosure before a screenshot can be requested',
      'SCREENSHOT_POLICY_ACKNOWLEDGEMENT_REQUIRED',
    );
  }
}

export async function getScreenshotPolicyView(organizationId: string) {
  const policy = await getOrCreateScreenshotPolicy(organizationId);
  return toScreenshotPolicySummary(policy);
}

export async function updateScreenshotPolicy(options: {
  organizationId: string;
  actorUserId: string;
  actorRole: Role;
  input: ScreenshotPolicyUpdateInput;
  context?: AuditContext;
}) {
  if (!hasPermission(options.actorRole, 'screenshot:policy')) {
    throw AppError.forbidden(
      'Your role cannot change the screenshot monitoring policy',
      'PERMISSION_DENIED',
    );
  }

  const policy = await sequelize.transaction(async (transaction) => {
    const policy = await getOrCreateScreenshotPolicy(options.organizationId, transaction);
    const nextRequestRoles = options.input.requestRoles ?? policy.requestRoles;
    const nextViewRoles = options.input.viewRoles ?? policy.viewRoles;
    validateRoleList(nextRequestRoles, 'requestRoles');
    validateRoleList(nextViewRoles, 'viewRoles');

    for (const role of nextRequestRoles) {
      if (!nextViewRoles.includes(role)) {
        throw AppError.unprocessable(
          'Every role allowed to request screenshots must also be allowed to view them',
          'VALIDATION_ERROR',
          [{ path: 'body.viewRoles', message: 'Request roles must be included in view roles' }],
        );
      }
    }

    const disclosureText = options.input.disclosureText ?? policy.disclosureText;
    if (!disclosureText.trim()) {
      throw AppError.unprocessable(
        'A monitoring disclosure is required',
        'VALIDATION_ERROR',
        [{ path: 'body.disclosureText', message: 'Disclosure text cannot be empty' }],
      );
    }
    const disclosureVersion = options.input.disclosureVersion ?? policy.disclosureVersion;
    if (
      disclosureText.trim() !== policy.disclosureText.trim() &&
      disclosureVersion === policy.disclosureVersion
    ) {
      const existingAcknowledgements = await ScreenshotPolicyAcknowledgement.count({
        where: {
          organizationId: options.organizationId,
          policyVersion: policy.disclosureVersion,
        },
        transaction,
      });
      if (existingAcknowledgements > 0) {
        throw AppError.unprocessable(
          'Changing the disclosure text requires a new disclosureVersion so employees can acknowledge the new text',
          'SCREENSHOT_DISCLOSURE_VERSION_REQUIRED',
          [
            {
              path: 'body.disclosureVersion',
              message: 'Provide a new disclosureVersion when changing acknowledged disclosure text',
            },
          ],
        );
      }
    }
    if ((options.input.enabled ?? policy.enabled) && !disclosureText.trim()) {
      throw AppError.unprocessable(
        'A monitoring disclosure is required before enabling screenshots',
        'SCREENSHOT_DISCLOSURE_REQUIRED',
      );
    }

    const changedFields = Object.keys(options.input).filter((key) => {
      const value = options.input[key as keyof ScreenshotPolicyUpdateInput];
      return value !== undefined;
    });
    await policy.update(
      {
        ...options.input,
        requestRoles: nextRequestRoles,
        viewRoles: nextViewRoles,
        disclosureText,
        disclosureVersion,
      },
      { transaction },
    );

    await recordAuditEvent(
      {
        organizationId: options.organizationId,
        actorUserId: options.actorUserId,
        action: 'SCREENSHOT_POLICY_UPDATED',
        entityType: 'SCREENSHOT_POLICY',
        entityId: policy.id,
        metadata: {
          changedFields,
          enabled: policy.enabled,
          requestRoles: policy.requestRoles,
          viewRoles: policy.viewRoles,
          retentionDays: policy.retentionDays,
          auditRetentionDays: policy.auditRetentionDays,
        },
      },
      { transaction, context: options.context },
    );

    return policy;
  });

  return policy;
}

export async function getEmployeeScreenshotPolicyDisclosure(
  organizationId: string,
  employeeId: string,
) {
  const policy = await getOrCreateScreenshotPolicy(organizationId);
  const acknowledgement = await ScreenshotPolicyAcknowledgement.findOne({
    where: {
      organizationId,
      employeeId,
      policyVersion: policy.disclosureVersion,
    },
  });
  return toScreenshotPolicyDisclosure(policy, acknowledgement?.acknowledgedAt ?? null);
}

export async function acknowledgeScreenshotPolicy(options: {
  organizationId: string;
  employeeId: string;
  context?: AuditContext;
}) {
  const policy = await getOrCreateScreenshotPolicy(options.organizationId);
  const [acknowledgement, created] = await ScreenshotPolicyAcknowledgement.findOrCreate({
    where: {
      organizationId: options.organizationId,
      employeeId: options.employeeId,
      policyVersion: policy.disclosureVersion,
    },
    defaults: {
      organizationId: options.organizationId,
      employeeId: options.employeeId,
      policyVersion: policy.disclosureVersion,
      acknowledgedAt: new Date(),
    },
  });

  if (created) {
    await recordAuditEvent(
      {
        organizationId: options.organizationId,
        actorUserId: options.employeeId,
        targetEmployeeId: options.employeeId,
        action: 'SCREENSHOT_POLICY_ACKNOWLEDGED',
        entityType: 'SCREENSHOT_POLICY',
        entityId: policy.id,
        metadata: { policyVersion: policy.disclosureVersion },
      },
      { context: options.context },
    );
  }

  return toScreenshotPolicyDisclosure(policy, acknowledgement.acknowledgedAt);
}
