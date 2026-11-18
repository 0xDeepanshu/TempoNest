import { Op, UniqueConstraintError } from 'sequelize';
import {
  Membership,
  Organization,
  User,
  IntegrationEmployeeMapping,
} from '../../database';
import { AppError } from '../../utils/errors';
import { normalizeEmail } from '../../utils/email';
import { paginate } from '../../utils/pagination';
import { serializeByKey } from '../../utils/serialize';
import { recordAuditEvent, type AuditContext } from '../screenshots/audit.service';
import { toPublicUser } from '../memberships/membership.mapper';
import type { User as UserModel } from '../users/user.model';
import type { IntegrationConnection as IntegrationConnectionModel } from './integrationConnection.model';
import type { IntegrationEmployeeMapping as MappingModel } from './integrationEmployeeMapping.model';
import type {
  CreateIntegrationMappingInput,
  IntegrationEmployeeMatchInput,
  ResolveIntegrationMappingInput,
} from './integration.schemas';

export type IntegrationEmployeeView = {
  id: string;
  name: string;
  email: string;
};

export function toIntegrationEmployeeView(user: UserModel): IntegrationEmployeeView {
  const publicUser = toPublicUser(user);
  return { id: publicUser.id, name: publicUser.name, email: publicUser.email };
}

export function toMappingView(mapping: MappingModel) {
  return {
    id: mapping.id,
    connectionId: mapping.connectionId,
    externalEmployeeId: mapping.externalEmployeeId,
    externalEmployeeEmail: mapping.externalEmployeeEmail,
    status: mapping.status,
    matchMethod: mapping.matchMethod,
    conflictReason: mapping.conflictReason,
    // Identity is only exposed once the mapping has been verified. Pending and
    // conflicted rows intentionally reveal nothing about WorkZen accounts.
    employee:
      mapping.status === 'ACTIVE' && mapping.workzenUser
        ? toIntegrationEmployeeView(mapping.workzenUser)
        : null,
    resolvedAt: mapping.resolvedAt,
    createdAt: mapping.createdAt,
    updatedAt: mapping.updatedAt,
  };
}

const mappingUserInclude = {
  model: User,
  as: 'workzenUser',
  required: false,
  attributes: ['id', 'name', 'email'],
};

type MatchDecision = {
  status: 'ACTIVE' | 'PENDING' | 'CONFLICT';
  workzenUserId: string | null;
  workzenEmailSnapshot: string | null;
  matchMethod: 'AUTO_EMAIL' | 'MANUAL' | null;
  conflictReason: string | null;
};

async function decideMatch(options: {
  organizationId: string;
  connectionId: string;
  externalEmployeeId: string;
  input: IntegrationEmployeeMatchInput;
}): Promise<MatchDecision> {
  const { organizationId, connectionId, externalEmployeeId, input } = options;
  const email = normalizeEmail(input.email);

  const user = await User.findOne({ where: { email } });
  if (!user || user.status !== 'ACTIVE') {
    return {
      status: 'PENDING',
      workzenUserId: null,
      workzenEmailSnapshot: null,
      matchMethod: null,
      conflictReason: 'EMPLOYEE_NOT_FOUND',
    };
  }

  const membership = await Membership.findOne({
    where: { organizationId, userId: user.id, status: 'ACTIVE' },
    attributes: ['id'],
  });
  if (!membership) {
    return {
      status: 'PENDING',
      workzenUserId: null,
      workzenEmailSnapshot: null,
      matchMethod: null,
      conflictReason: 'EMPLOYEE_NOT_FOUND',
    };
  }

  // Someone else may already be linked to this WorkZen employee under another
  // external id. Never silently move an existing link.
  const otherMapping = await IntegrationEmployeeMapping.findOne({
    where: {
      connectionId,
      workzenUserId: user.id,
      status: 'ACTIVE',
      externalEmployeeId: { [Op.ne]: externalEmployeeId },
    },
    attributes: ['id', 'externalEmployeeId'],
  });
  if (otherMapping) {
    return {
      status: 'CONFLICT',
      workzenUserId: null,
      workzenEmailSnapshot: email,
      matchMethod: null,
      conflictReason: 'ALREADY_MAPPED',
    };
  }

  // A partner-supplied match is only a suggestion. WorkZen has no
  // authoritative mailbox verification, and an accepted invitation is not
  // proof either: invitation tokens are also returned to the inviter and
  // account creation does not verify the address. The partner's `emailVerified`
  // assertion is therefore never sufficient, so every link needs an audited
  // owner/admin decision (matchMethod MANUAL, resolvedByUserId recorded).
  return {
    status: 'PENDING',
    workzenUserId: null,
    workzenEmailSnapshot: email,
    matchMethod: null,
    conflictReason: 'MANUAL_APPROVAL_REQUIRED',
  };
}

async function applyMatch(options: {
  connection: IntegrationConnectionModel;
  input: IntegrationEmployeeMatchInput;
}): Promise<MappingModel> {
  const { connection, input } = options;
  const externalEmployeeId = input.externalEmployeeId;
  const email = normalizeEmail(input.email);

  return serializeByKey(
    `integration-match:${connection.id}:${externalEmployeeId}`,
    async () => {
      const existing = await IntegrationEmployeeMapping.findOne({
        where: { connectionId: connection.id, externalEmployeeId },
      });

      // An active link is stable: re-sending the match request is idempotent
      // and never rebinds an employee to a different WorkZen account.
      if (existing?.status === 'ACTIVE') {
        if (existing.externalEmployeeEmail !== email) {
          await existing.update({ externalEmployeeEmail: email });
        }
        return existing;
      }

      // An owner-revoked link stays revoked. The partner cannot resurrect it by
      // re-sending a match request; only a new manual decision could link it.
      if (existing?.status === 'REVOKED') {
        return existing;
      }

      const decision = await decideMatch({
        organizationId: connection.organizationId,
        connectionId: connection.id,
        externalEmployeeId,
        input,
      });

      const values = {
        externalEmployeeEmail: email,
        workzenUserId: decision.workzenUserId,
        workzenEmailSnapshot: decision.workzenEmailSnapshot,
        status: decision.status,
        matchMethod: decision.matchMethod,
        conflictReason: decision.conflictReason,
        resolvedAt: existing?.resolvedAt ?? null,
        resolvedByUserId: null,
      };

      let mapping: MappingModel;
      try {
        if (existing) {
          await existing.update(values);
          mapping = existing;
        } else {
          mapping = await IntegrationEmployeeMapping.create({
            connectionId: connection.id,
            organizationId: connection.organizationId,
            externalEmployeeId,
            ...values,
          });
        }
      } catch (error) {
        if (error instanceof UniqueConstraintError) {
          throw AppError.conflict(
            'This employee is already mapped for this connection',
            'EMPLOYEE_ALREADY_MAPPED',
          );
        }
        throw error;
      }

      return mapping;
    },
  );
}

export async function matchEmployees(options: {
  connection: IntegrationConnectionModel;
  employees: IntegrationEmployeeMatchInput[];
}) {
  const { connection, employees } = options;
  const results = [];

  for (const input of employees) {
    const mapping = await applyMatch({ connection, input });
    const reloaded =
      mapping.status === 'ACTIVE' && !mapping.workzenUser
        ? await IntegrationEmployeeMapping.findByPk(mapping.id, {
            include: [mappingUserInclude],
          })
        : mapping;
    results.push(toMappingView(reloaded ?? mapping));
  }

  return { matches: results };
}

export async function listMappedEmployees(options: {
  connection: IntegrationConnectionModel;
  page: number;
  limit: number;
  externalEmployeeId?: string;
}) {
  const where: Record<string, unknown> = {
    connectionId: options.connection.id,
    organizationId: options.connection.organizationId,
    status: 'ACTIVE',
    workzenUserId: { [Op.ne]: null },
  };
  if (options.externalEmployeeId) where.externalEmployeeId = options.externalEmployeeId;

  const result = await IntegrationEmployeeMapping.findAndCountAll({
    where,
    include: [mappingUserInclude],
    order: [
      ['externalEmployeeId', 'ASC'],
      ['id', 'ASC'],
    ],
    limit: options.limit,
    offset: (options.page - 1) * options.limit,
    distinct: true,
  });

  return paginate(
    result.rows.map((mapping) => toMappingView(mapping)),
    result.count,
    options.page,
    options.limit,
  );
}

export async function listConnectionMappings(options: {
  organizationId: string;
  connectionId: string;
  page: number;
  limit: number;
  status?: string;
  externalEmployeeId?: string;
}) {
  const where: Record<string, unknown> = {
    organizationId: options.organizationId,
    connectionId: options.connectionId,
  };
  if (options.status) where.status = options.status;
  if (options.externalEmployeeId) where.externalEmployeeId = options.externalEmployeeId;

  const result = await IntegrationEmployeeMapping.findAndCountAll({
    where,
    include: [mappingUserInclude],
    order: [
      ['createdAt', 'DESC'],
      ['id', 'ASC'],
    ],
    limit: options.limit,
    offset: (options.page - 1) * options.limit,
    distinct: true,
  });

  return paginate(
    result.rows.map((mapping) => toMappingView(mapping)),
    result.count,
    options.page,
    options.limit,
  );
}

/**
 * Resolve an ACTIVE mapping for one WorkZen employee under a connection. Used
 * by the data API and the webhook outbox: an employee that has not been mapped
 * is never readable and never generates webhooks.
 */
export async function findActiveMapping(
  connectionId: string,
  workzenUserId: string,
): Promise<MappingModel | null> {
  return IntegrationEmployeeMapping.findOne({
    where: { connectionId, workzenUserId, status: 'ACTIVE' },
  });
}

export async function findActiveMappingByExternalId(
  connectionId: string,
  externalEmployeeId: string,
): Promise<MappingModel | null> {
  return IntegrationEmployeeMapping.findOne({
    where: { connectionId, externalEmployeeId, status: 'ACTIVE', workzenUserId: { [Op.ne]: null } },
  });
}

async function assertLinkableEmployee(
  organizationId: string,
  workzenUserId: string,
): Promise<UserModel> {
  const user = await User.findOne({ where: { id: workzenUserId } });
  if (!user || user.status !== 'ACTIVE') {
    throw AppError.notFound('Employee not found in this organization', 'EMPLOYEE_NOT_FOUND');
  }
  const membership = await Membership.findOne({
    where: { organizationId, userId: workzenUserId, status: 'ACTIVE' },
    attributes: ['id'],
  });
  if (!membership) {
    throw AppError.notFound('Employee not found in this organization', 'EMPLOYEE_NOT_FOUND');
  }
  return user;
}

async function assertEmployeeNotMappedElsewhere(options: {
  connectionId: string;
  workzenUserId: string;
  mappingId?: string;
}): Promise<void> {
  const existing = await IntegrationEmployeeMapping.findOne({
    where: {
      connectionId: options.connectionId,
      workzenUserId: options.workzenUserId,
      status: 'ACTIVE',
      ...(options.mappingId ? { id: { [Op.ne]: options.mappingId } } : {}),
    },
    attributes: ['id'],
  });
  if (existing) {
    throw AppError.conflict(
      'This WorkZen employee is already mapped for this integration',
      'EMPLOYEE_ALREADY_MAPPED',
    );
  }
}

export async function createManualMapping(options: {
  organizationId: string;
  connectionId: string;
  input: CreateIntegrationMappingInput;
  actorUserId: string;
  context?: AuditContext;
}) {
  const { organizationId, connectionId, input, actorUserId, context } = options;
  const user = await assertLinkableEmployee(organizationId, input.workzenUserId);

  return serializeByKey(
    `integration-match:${connectionId}:${input.externalEmployeeId}`,
    async () => {
      const existingExternal = await IntegrationEmployeeMapping.findOne({
        where: { connectionId, externalEmployeeId: input.externalEmployeeId },
      });
      if (existingExternal?.status === 'ACTIVE') {
        throw AppError.conflict(
          'This external employee is already mapped',
          'EMPLOYEE_ALREADY_MAPPED',
        );
      }
      await assertEmployeeNotMappedElsewhere({
        connectionId,
        workzenUserId: user.id,
        mappingId: existingExternal?.id,
      });

      const values = {
        organizationId,
        connectionId,
        externalEmployeeId: input.externalEmployeeId,
        externalEmployeeEmail: input.externalEmployeeEmail
          ? normalizeEmail(input.externalEmployeeEmail)
          : existingExternal?.externalEmployeeEmail ?? null,
        workzenUserId: user.id,
        workzenEmailSnapshot: user.email,
        status: 'ACTIVE' as const,
        matchMethod: 'MANUAL' as const,
        conflictReason: null,
        resolvedByUserId: actorUserId,
        resolvedAt: new Date(),
        notes: input.notes ?? null,
      };

      let mapping: MappingModel;
      if (existingExternal) {
        await existingExternal.update(values);
        mapping = existingExternal;
      } else {
        mapping = await IntegrationEmployeeMapping.create(values);
      }

      await recordAuditEvent(
        {
          organizationId,
          actorUserId,
          targetEmployeeId: user.id,
          action: 'INTEGRATION_MAPPING_CREATED',
          entityType: 'INTEGRATION_EMPLOYEE_MAPPING',
          entityId: mapping.id,
          metadata: {
            connectionId,
            externalEmployeeId: input.externalEmployeeId,
          },
        },
        { context },
      );

      return toMappingView(
        (await IntegrationEmployeeMapping.findByPk(mapping.id, {
          include: [mappingUserInclude],
        })) ?? mapping,
      );
    },
  );
}

export async function resolveMapping(options: {
  organizationId: string;
  connectionId: string;
  mappingId: string;
  input: ResolveIntegrationMappingInput;
  actorUserId: string;
  context?: AuditContext;
}) {
  const { organizationId, connectionId, mappingId, input, actorUserId, context } = options;

  const mapping = await IntegrationEmployeeMapping.findOne({
    where: { id: mappingId, organizationId, connectionId },
    include: [mappingUserInclude],
  });
  if (!mapping) {
    throw AppError.notFound('Employee mapping not found', 'MAPPING_NOT_FOUND');
  }

  if (input.action === 'LINK') {
    const userId = input.workzenUserId;
    if (!userId) {
      throw AppError.badRequest('workzenUserId is required', 'WORKZEN_USER_REQUIRED');
    }
    if (mapping.status === 'ACTIVE' && mapping.workzenUserId === userId) {
      return toMappingView(mapping);
    }
    if (mapping.status === 'REVOKED') {
      throw AppError.conflict(
        'This mapping was revoked and cannot be linked again',
        'MAPPING_REVOKED',
      );
    }

    const user = await assertLinkableEmployee(organizationId, userId);
    await assertEmployeeNotMappedElsewhere({
      connectionId,
      workzenUserId: user.id,
      mappingId: mapping.id,
    });

    await mapping.update({
      workzenUserId: user.id,
      workzenEmailSnapshot: user.email,
      status: 'ACTIVE',
      matchMethod: 'MANUAL',
      conflictReason: null,
      resolvedByUserId: actorUserId,
      resolvedAt: new Date(),
      notes: input.notes ?? mapping.notes,
    });

    await recordAuditEvent(
      {
        organizationId,
        actorUserId,
        targetEmployeeId: user.id,
        action: 'INTEGRATION_MAPPING_LINKED',
        entityType: 'INTEGRATION_EMPLOYEE_MAPPING',
        entityId: mapping.id,
        metadata: { connectionId, externalEmployeeId: mapping.externalEmployeeId },
      },
      { context },
    );
  } else {
    if (mapping.status === 'REVOKED') {
      return toMappingView(mapping);
    }

    const previousWorkzenUserId = mapping.workzenUserId;
    const revoking = input.action === 'REVOKE';
    await mapping.update({
      status: 'REVOKED',
      workzenUserId: null,
      workzenEmailSnapshot: null,
      matchMethod: null,
      conflictReason: revoking ? 'REVOKED' : mapping.conflictReason ?? 'REJECTED',
      resolvedByUserId: actorUserId,
      resolvedAt: new Date(),
      notes: input.notes ?? mapping.notes,
    });

    await recordAuditEvent(
      {
        organizationId,
        actorUserId,
        targetEmployeeId: previousWorkzenUserId,
        action: revoking ? 'INTEGRATION_MAPPING_REVOKED' : 'INTEGRATION_MAPPING_REJECTED',
        entityType: 'INTEGRATION_EMPLOYEE_MAPPING',
        entityId: mapping.id,
        metadata: { connectionId, externalEmployeeId: mapping.externalEmployeeId },
      },
      { context },
    );
  }

  const reloaded = await IntegrationEmployeeMapping.findByPk(mapping.id, {
    include: [mappingUserInclude],
  });
  return toMappingView(reloaded ?? mapping);
}

export async function organizationExists(organizationId: string): Promise<boolean> {
  const organization = await Organization.findByPk(organizationId, { attributes: ['id'] });
  return Boolean(organization);
}
