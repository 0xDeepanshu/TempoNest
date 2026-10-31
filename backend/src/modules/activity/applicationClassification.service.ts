import { sequelize, ApplicationActivity, ApplicationClassification } from '../../database';
import { AppError } from '../../utils/errors';
import { paginate } from '../../utils/pagination';
import { hasPermission, type PermissionSubject } from '../memberships/permissions';
import { recordAuditEvent, type AuditContext } from '../screenshots/audit.service';
import type {
  ApplicationClassification as ApplicationClassificationModel,
  ApplicationProductivityCategory,
} from './applicationClassification.model';
import type {
  ClassificationListQuery,
  CreateClassificationInput,
  UpdateClassificationInput,
} from './applicationClassification.schemas';

export function normalizeApplicationIdentifier(identifier: string): string {
  return identifier.trim().toLowerCase();
}

export function toClassificationSummary(classification: ApplicationClassificationModel) {
  return {
    id: classification.id,
    organizationId: classification.organizationId,
    applicationIdentifier: classification.applicationIdentifier,
    applicationName: classification.applicationName,
    category: classification.category,
    classified: classification.category !== 'UNCLASSIFIED',
    classifiedByUserId: classification.classifiedByUserId,
    notes: classification.notes,
    createdAt: classification.createdAt,
    updatedAt: classification.updatedAt,
  };
}

/** Case-insensitive catalog lookup used by reports. */
export async function loadClassificationCategories(
  organizationId: string,
): Promise<Map<string, ApplicationProductivityCategory>> {
  const rows = await ApplicationClassification.findAll({
    where: { organizationId },
    attributes: ['applicationIdentifier', 'category'],
  });
  return new Map(
    rows.map((row) => [normalizeApplicationIdentifier(row.applicationIdentifier), row.category]),
  );
}

export async function listApplicationClassifications(options: {
  organizationId: string;
  actorRole: PermissionSubject;
  query: ClassificationListQuery;
}) {
  if (!hasPermission(options.actorRole, 'report:read')) {
    throw AppError.forbidden('Your role cannot read application classifications', 'PERMISSION_DENIED');
  }

  const stored = await ApplicationClassification.findAll({
    where: { organizationId: options.organizationId },
    order: [
      ['applicationName', 'ASC'],
      ['applicationIdentifier', 'ASC'],
    ],
  });

  type Row = {
    classificationId: string | null;
    applicationIdentifier: string;
    applicationName: string;
    category: ApplicationProductivityCategory;
    classified: boolean;
    classifiedByUserId: string | null;
    notes: string | null;
    createdAt: Date | null;
    updatedAt: Date | null;
  };

  const rows = new Map<string, Row>();
  for (const classification of stored) {
    rows.set(normalizeApplicationIdentifier(classification.applicationIdentifier), {
      classificationId: classification.id,
      applicationIdentifier: classification.applicationIdentifier,
      applicationName: classification.applicationName,
      category: classification.category,
      classified: classification.category !== 'UNCLASSIFIED',
      classifiedByUserId: classification.classifiedByUserId,
      notes: classification.notes,
      createdAt: classification.createdAt,
      updatedAt: classification.updatedAt,
    });
  }

  if (options.query.includeObserved) {
    const observed = (await ApplicationActivity.findAll({
      attributes: [
        'applicationIdentifier',
        [sequelize.fn('MAX', sequelize.col('application_name')), 'applicationName'],
      ],
      where: { organizationId: options.organizationId },
      group: ['application_identifier'],
      raw: true,
    })) as unknown as Array<{ applicationIdentifier: string; applicationName: string }>;

    for (const activity of observed) {
      const key = normalizeApplicationIdentifier(activity.applicationIdentifier);
      if (rows.has(key)) continue;
      rows.set(key, {
        classificationId: null,
        applicationIdentifier: activity.applicationIdentifier,
        applicationName: activity.applicationName,
        category: 'UNCLASSIFIED',
        classified: false,
        classifiedByUserId: null,
        notes: null,
        createdAt: null,
        updatedAt: null,
      });
    }
  }

  const needle = options.query.q?.toLowerCase();
  const filtered = [...rows.values()]
    .filter((row) => (options.query.category ? row.category === options.query.category : true))
    .filter((row) =>
      needle
        ? row.applicationIdentifier.toLowerCase().includes(needle) ||
          row.applicationName.toLowerCase().includes(needle)
        : true,
    )
    .sort(
      (a, b) =>
        a.applicationName.localeCompare(b.applicationName) ||
        a.applicationIdentifier.localeCompare(b.applicationIdentifier),
    );

  const pageStart = (options.query.page - 1) * options.query.limit;
  const data = filtered.slice(pageStart, pageStart + options.query.limit).map((row) => ({
    ...row,
    category: row.category,
  }));

  return {
    ...paginate(data, filtered.length, options.query.page, options.query.limit),
    summary: {
      total: filtered.length,
      classified: filtered.filter((row) => row.classified).length,
      unclassified: filtered.filter((row) => !row.classified).length,
    },
  };
}

export async function createApplicationClassification(options: {
  organizationId: string;
  actorUserId: string;
  actorRole: PermissionSubject;
  input: CreateClassificationInput;
  context?: AuditContext;
}) {
  if (!hasPermission(options.actorRole, 'classification:manage')) {
    throw AppError.forbidden(
      'Your role cannot manage application classifications',
      'PERMISSION_DENIED',
    );
  }

  const identifier = normalizeApplicationIdentifier(options.input.applicationIdentifier);
  const applicationName = options.input.applicationName ?? options.input.applicationIdentifier;

  try {
    return await sequelize.transaction(async (transaction) => {
      const existing = await ApplicationClassification.findOne({
        where: { organizationId: options.organizationId, applicationIdentifier: identifier },
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      if (existing) {
        throw AppError.conflict(
          'This application already has a classification in this organization',
          'CLASSIFICATION_EXISTS',
        );
      }

      const classification = await ApplicationClassification.create(
        {
          organizationId: options.organizationId,
          applicationIdentifier: identifier,
          applicationName,
          category: options.input.category,
          classifiedByUserId: options.actorUserId,
          notes: options.input.notes ?? null,
        },
        { transaction },
      );

      await recordAuditEvent(
        {
          organizationId: options.organizationId,
          actorUserId: options.actorUserId,
          action: 'APPLICATION_CLASSIFICATION_CREATED',
          entityType: 'APPLICATION_CLASSIFICATION',
          entityId: classification.id,
          metadata: {
            applicationIdentifier: classification.applicationIdentifier,
            applicationName: classification.applicationName,
            category: classification.category,
          },
        },
        { transaction, context: options.context },
      );

      return toClassificationSummary(classification);
    });
  } catch (error) {
    if (error instanceof AppError) throw error;
    // A concurrent create may lose the unique constraint race.
    const existing = await ApplicationClassification.findOne({
      where: { organizationId: options.organizationId, applicationIdentifier: identifier },
    });
    if (existing) {
      throw AppError.conflict(
        'This application already has a classification in this organization',
        'CLASSIFICATION_EXISTS',
      );
    }
    throw error;
  }
}

export async function updateApplicationClassification(options: {
  organizationId: string;
  classificationId: string;
  actorUserId: string;
  actorRole: PermissionSubject;
  input: UpdateClassificationInput;
  context?: AuditContext;
}) {
  if (!hasPermission(options.actorRole, 'classification:manage')) {
    throw AppError.forbidden(
      'Your role cannot manage application classifications',
      'PERMISSION_DENIED',
    );
  }

  return sequelize.transaction(async (transaction) => {
    const classification = await ApplicationClassification.findOne({
      where: { id: options.classificationId, organizationId: options.organizationId },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!classification) {
      throw AppError.notFound('Application classification not found', 'CLASSIFICATION_NOT_FOUND');
    }

    const previousCategory = classification.category;
    await classification.update(
      {
        ...(options.input.applicationName !== undefined
          ? { applicationName: options.input.applicationName }
          : {}),
        ...(options.input.category !== undefined ? { category: options.input.category } : {}),
        ...(options.input.notes !== undefined ? { notes: options.input.notes } : {}),
        classifiedByUserId: options.actorUserId,
      },
      { transaction },
    );

    await recordAuditEvent(
      {
        organizationId: options.organizationId,
        actorUserId: options.actorUserId,
        action: 'APPLICATION_CLASSIFICATION_UPDATED',
        entityType: 'APPLICATION_CLASSIFICATION',
        entityId: classification.id,
        metadata: {
          applicationIdentifier: classification.applicationIdentifier,
          previousCategory,
          category: classification.category,
          applicationName: classification.applicationName,
        },
      },
      { transaction, context: options.context },
    );

    return toClassificationSummary(classification);
  });
}
