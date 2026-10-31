import { Op, Transaction, UniqueConstraintError } from 'sequelize';
import { DateTime, IANAZone } from 'luxon';
import {
  AttendanceCorrectionRequest,
  Break,
  TimeSession,
  User,
  sequelize,
} from '../../database';
import { AppError } from '../../utils/errors';
import { paginate } from '../../utils/pagination';
import { serializeByKey } from '../../utils/serialize';
import {
  hasPermission,
  isSelfScoped,
  type PermissionSubject,
} from '../memberships/permissions';
import { ensureEmployee } from '../reporting/reporting.service';
import { recordAuditEvent, type AuditContext } from '../screenshots/audit.service';
import { toAttendanceCorrectionSummary } from './attendance.mapper';
import type { Role } from '../memberships/roles';
import type { Organization as OrganizationModel } from '../organizations/organization.model';
import type { TimeSession as TimeSessionModel } from '../timeTracking/timeSession.model';
import type { Break as BreakModel } from '../timeTracking/break.model';
import type {
  AttendanceCorrectionListQuery,
  CreateAttendanceCorrectionInput,
} from './attendance.schemas';
import type {
  AttendanceCorrectionRequest as AttendanceCorrectionModel,
  CorrectionRequestType,
  CorrectionSnapshot,
  RequestedBreak,
} from './attendanceCorrection.model';

const correctionIncludes = [
  { model: User, as: 'employee', required: false, attributes: ['id', 'name', 'email'] },
  { model: User, as: 'reviewer', required: false, attributes: ['id', 'name', 'email'] },
];

type NormalizedBreak = {
  startedAt: Date;
  endedAt: Date;
  stored: RequestedBreak;
};

function zoneFor(timezone: string): string {
  return IANAZone.isValidZone(timezone) ? timezone : 'UTC';
}

async function lockEmployee(transaction: Transaction, employeeId: string): Promise<void> {
  // Lock ordering matches time session mutations: employee, then the
  // affected session/correction. This serializes approval with online
  // start/stop/break writes across multiple application instances.
  await User.findByPk(employeeId, {
    transaction,
    lock: Transaction.LOCK.UPDATE,
    attributes: ['id'],
  });
}

function localDateFor(value: Date, timezone: string): string | null {
  return DateTime.fromJSDate(value, { zone: zoneFor(timezone) }).toISODate();
}

function assertRequestInterval(startedAt: Date, endedAt: Date, now = new Date()): void {
  if (
    Number.isNaN(startedAt.getTime()) ||
    Number.isNaN(endedAt.getTime()) ||
    startedAt.getTime() >= endedAt.getTime()
  ) {
    throw AppError.unprocessable(
      'Correction start must be before its end',
      'INVALID_CORRECTION_INTERVAL',
    );
  }
  if (startedAt.getTime() > now.getTime() || endedAt.getTime() > now.getTime()) {
    throw AppError.unprocessable(
      'A correction cannot include future time',
      'CORRECTION_IN_FUTURE',
    );
  }
}

function assertStoredInterval(startedAt: Date, endedAt: Date): void {
  if (
    Number.isNaN(startedAt.getTime()) ||
    Number.isNaN(endedAt.getTime()) ||
    startedAt.getTime() >= endedAt.getTime()
  ) {
    throw AppError.conflict(
      'The stored correction interval is invalid and cannot be applied',
      'CORRECTION_INVALID',
    );
  }
}

function normalizeRequestedBreaks(
  input: RequestedBreak[],
  sessionStart: Date,
  sessionEnd: Date,
): NormalizedBreak[] {
  const parsed = input
    .map((brk) => ({
      startedAt: new Date(brk.startedAt),
      endedAt: new Date(brk.endedAt),
    }))
    .sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());

  const normalized: NormalizedBreak[] = [];
  let previousEnd: Date | null = null;

  for (const brk of parsed) {
    if (
      Number.isNaN(brk.startedAt.getTime()) ||
      Number.isNaN(brk.endedAt.getTime()) ||
      brk.startedAt.getTime() >= brk.endedAt.getTime()
    ) {
      throw AppError.unprocessable(
        'Each break must have startedAt before endedAt',
        'INVALID_CORRECTION_BREAKS',
      );
    }
    if (
      brk.startedAt.getTime() < sessionStart.getTime() ||
      brk.endedAt.getTime() > sessionEnd.getTime()
    ) {
      throw AppError.unprocessable(
        'Requested breaks must fall inside the corrected session',
        'INVALID_CORRECTION_BREAKS',
      );
    }
    if (previousEnd && brk.startedAt.getTime() < previousEnd.getTime()) {
      throw AppError.unprocessable(
        'Requested breaks cannot overlap each other',
        'INVALID_CORRECTION_BREAKS',
      );
    }

    normalized.push({
      startedAt: brk.startedAt,
      endedAt: brk.endedAt,
      stored: {
        startedAt: brk.startedAt.toISOString(),
        endedAt: brk.endedAt.toISOString(),
      },
    });
    previousEnd = brk.endedAt;
  }

  return normalized;
}

function normalizeStoredBreaks(
  input: RequestedBreak[],
  sessionStart: Date,
  sessionEnd: Date,
): NormalizedBreak[] {
  try {
    return normalizeRequestedBreaks(input, sessionStart, sessionEnd);
  } catch (error) {
    if (error instanceof AppError) {
      throw AppError.conflict(
        'The stored correction breaks are invalid and cannot be applied',
        'CORRECTION_INVALID',
      );
    }
    throw error;
  }
}

function snapshotFor(
  session: TimeSessionModel,
  breaks: BreakModel[],
  overrides: Partial<{ startedAt: Date; endedAt: Date; status: string; source: string }> = {},
): CorrectionSnapshot {
  return {
    sessionId: session.id,
    startedAt: (overrides.startedAt ?? session.startedAt).toISOString(),
    endedAt: (overrides.endedAt ?? session.endedAt)?.toISOString() ?? null,
    status: overrides.status ?? session.status,
    source: overrides.source ?? session.source,
    breaks: [...breaks]
      .sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime())
      .map((brk) => ({
        id: brk.id,
        startedAt: brk.startedAt.toISOString(),
        endedAt: brk.endedAt?.toISOString() ?? null,
        status: brk.status,
      })),
  };
}

function requestedSnapshot(input: {
  startedAt: Date;
  endedAt: Date;
  breaks: RequestedBreak[];
}) {
  return {
    startedAt: input.startedAt.toISOString(),
    endedAt: input.endedAt.toISOString(),
    breaks: [...input.breaks]
      .sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt))
      .map((brk) => ({ startedAt: brk.startedAt, endedAt: brk.endedAt })),
  };
}

async function loadCorrection(
  organizationId: string,
  correctionId: string,
  employeeId?: string,
) {
  const where: Record<string, unknown> = { id: correctionId, organizationId };
  if (employeeId) where.employeeId = employeeId;

  const correction = await AttendanceCorrectionRequest.findOne({
    where,
    include: correctionIncludes,
  });
  if (!correction) {
    throw AppError.notFound('Attendance correction not found', 'CORRECTION_NOT_FOUND');
  }
  return correction;
}

async function loadLockedSession(
  transaction: Transaction,
  organizationId: string,
  employeeId: string,
  sessionId: string,
): Promise<{ session: TimeSessionModel; breaks: BreakModel[] }> {
  const session = await TimeSession.findOne({
    where: { id: sessionId, organizationId, employeeId },
    transaction,
    lock: Transaction.LOCK.UPDATE,
  });
  if (!session) {
    throw AppError.notFound('Time session not found', 'SESSION_NOT_FOUND');
  }

  const breaks = await Break.findAll({
    where: { timeSessionId: session.id },
    order: [
      ['startedAt', 'ASC'],
      ['id', 'ASC'],
    ],
    transaction,
    lock: Transaction.LOCK.UPDATE,
  });

  session.breaks = breaks;
  return { session, breaks };
}

async function assertNoSessionOverlap(options: {
  transaction: Transaction;
  organizationId: string;
  employeeId: string;
  startedAt: Date;
  endedAt: Date;
  excludeSessionId?: string;
}): Promise<void> {
  const where: Record<string | symbol, unknown> = {
    organizationId: options.organizationId,
    employeeId: options.employeeId,
    startedAt: { [Op.lt]: options.endedAt },
    [Op.or]: [{ endedAt: null }, { endedAt: { [Op.gt]: options.startedAt } }],
  };
  if (options.excludeSessionId) where.id = { [Op.ne]: options.excludeSessionId };

  const overlaps = await TimeSession.findAll({
    where,
    transaction: options.transaction,
    lock: Transaction.LOCK.UPDATE,
    order: [['startedAt', 'ASC']],
  });
  if (overlaps.length === 0) return;

  const startsBeforeExisting = overlaps.some(
    (session) => options.startedAt.getTime() < session.startedAt.getTime(),
  );
  if (startsBeforeExisting) {
    throw AppError.conflict(
      'The requested time conflicts with an earlier work session. Please check your attendance history.',
      'CORRECTION_BEFORE_EXISTING_SESSION',
    );
  }

  throw AppError.conflict(
    'This correction overlaps with another recorded work session. Please adjust the start and end times.',
    'CORRECTION_OVERLAPS_EXISTING_SESSION',
  );
}

async function findPendingCorrection(options: {
  transaction: Transaction;
  organizationId: string;
  employeeId: string;
  startedAt: Date;
  endedAt: Date;
  timeSessionId?: string;
}): Promise<AttendanceCorrectionModel | null> {
  if (options.timeSessionId) {
    const forSession = await AttendanceCorrectionRequest.findOne({
      where: {
        organizationId: options.organizationId,
        employeeId: options.employeeId,
        timeSessionId: options.timeSessionId,
        status: 'PENDING',
      },
      transaction: options.transaction,
      lock: Transaction.LOCK.UPDATE,
    });
    if (forSession) return forSession;
  }

  return AttendanceCorrectionRequest.findOne({
    where: {
      organizationId: options.organizationId,
      employeeId: options.employeeId,
      status: 'PENDING',
      requestedStartedAt: { [Op.lt]: options.endedAt },
      requestedEndedAt: { [Op.gt]: options.startedAt },
    },
    transaction: options.transaction,
    lock: Transaction.LOCK.UPDATE,
  });
}

export async function createAttendanceCorrection(options: {
  organization: OrganizationModel;
  employeeId: string;
  input: CreateAttendanceCorrectionInput;
  context?: AuditContext;
}) {
  const { organization, employeeId, input, context } = options;
  const startedAt = new Date(input.startedAt);
  const endedAt = new Date(input.endedAt);
  assertRequestInterval(startedAt, endedAt);

  const requestedBreaks = normalizeRequestedBreaks(input.breaks, startedAt, endedAt);
  const storedBreaks = requestedBreaks.map((brk) => brk.stored);

  try {
    const correctionId = await serializeByKey(`employee:${employeeId}`, () =>
      sequelize.transaction(async (transaction) => {
        await lockEmployee(transaction, employeeId);
        let target:
          | { session: TimeSessionModel; breaks: BreakModel[]; snapshot: CorrectionSnapshot }
          | undefined;
        let requestType: CorrectionRequestType = 'CREATE_SESSION';

        if (input.sessionId) {
          requestType = 'UPDATE_SESSION';
          const loaded = await loadLockedSession(
            transaction,
            organization.id,
            employeeId,
            input.sessionId,
          );
          if (!loaded.session.endedAt || loaded.session.status !== 'STOPPED') {
            throw AppError.conflict(
              'Only stopped sessions can be corrected',
              'SESSION_NOT_CLOSED',
            );
          }

          const originalWorkDate = localDateFor(
            loaded.session.startedAt,
            organization.timezone,
          );
          if (input.workDate !== originalWorkDate) {
            throw AppError.unprocessable(
              'workDate must match the original session work date',
              'WORK_DATE_MISMATCH',
            );
          }

          target = {
            session: loaded.session,
            breaks: loaded.breaks,
            snapshot: snapshotFor(loaded.session, loaded.breaks),
          };
        } else {
          const requestedWorkDate = localDateFor(startedAt, organization.timezone);
          if (input.workDate !== requestedWorkDate) {
            throw AppError.unprocessable(
              'workDate must match the requested session work date',
              'WORK_DATE_MISMATCH',
            );
          }
        }

        const pending = await findPendingCorrection({
          transaction,
          organizationId: organization.id,
          employeeId,
          startedAt,
          endedAt,
          timeSessionId: input.sessionId,
        });
        if (pending) {
          throw AppError.conflict(
            'A pending attendance correction already overlaps this request',
            'CORRECTION_ALREADY_PENDING',
          );
        }

        await assertNoSessionOverlap({
          transaction,
          organizationId: organization.id,
          employeeId,
          startedAt,
          endedAt,
          excludeSessionId: input.sessionId,
        });

        const correction = await AttendanceCorrectionRequest.create(
          {
            organizationId: organization.id,
            employeeId,
            timeSessionId: input.sessionId ?? null,
            requestType,
            workDate: input.workDate,
            requestedStartedAt: startedAt,
            requestedEndedAt: endedAt,
            requestedBreaks: storedBreaks,
            reason: input.reason,
            status: 'PENDING',
            originalSnapshot: target?.snapshot ?? null,
          },
          { transaction },
        );

        await recordAuditEvent(
          {
            organizationId: organization.id,
            actorUserId: employeeId,
            targetEmployeeId: employeeId,
            action: 'ATTENDANCE_CORRECTION_REQUESTED',
            entityType: 'ATTENDANCE_CORRECTION',
            entityId: correction.id,
            metadata: {
              requestType,
              workDate: input.workDate,
              sessionId: input.sessionId ?? null,
              original: target?.snapshot ?? null,
              requested: requestedSnapshot({
                startedAt,
                endedAt,
                breaks: storedBreaks,
              }),
              reason: input.reason,
            },
          },
          { transaction, context },
        );

        return correction.id;
      }),
    );

    return toAttendanceCorrectionSummary(await loadCorrection(organization.id, correctionId));
  } catch (error) {
    if (error instanceof UniqueConstraintError) {
      throw AppError.conflict(
        'A pending attendance correction already exists for this session',
        'CORRECTION_ALREADY_PENDING',
      );
    }
    throw error;
  }
}

export async function listAttendanceCorrections(options: {
  organization: OrganizationModel;
  actorUserId: string;
  actorRole: Role | PermissionSubject;
  query: AttendanceCorrectionListQuery;
}) {
  const { organization, actorUserId, actorRole, query } = options;

  // Only an organization-scoped reviewer may read other employees' requests.
  // Everyone else — including ORGANIZATION-scoped roles without
  // correction:review — sees exactly their own history.
  const teamScope =
    hasPermission(actorRole, 'correction:review') && !isSelfScoped(actorRole);

  const where: Record<string | symbol, unknown> = { organizationId: organization.id };
  if (!teamScope) {
    where.employeeId = actorUserId;
  } else if (query.employeeId) {
    await ensureEmployee(organization.id, query.employeeId);
    where.employeeId = query.employeeId;
  }

  if (query.status) where.status = query.status;
  if (query.from || query.to) {
    where.workDate = {
      ...(query.from ? { [Op.gte]: query.from } : {}),
      ...(query.to ? { [Op.lte]: query.to } : {}),
    };
  }

  const result = await AttendanceCorrectionRequest.findAndCountAll({
    where,
    include: correctionIncludes,
    order: [
      ['createdAt', 'DESC'],
      ['id', 'ASC'],
    ],
    limit: query.limit,
    offset: (query.page - 1) * query.limit,
    distinct: true,
  });

  return paginate(
    result.rows.map((correction) => toAttendanceCorrectionSummary(correction)),
    result.count,
    query.page,
    query.limit,
  );
}

export async function getAttendanceCorrectionForActor(options: {
  organization: OrganizationModel;
  correctionId: string;
  actorUserId: string;
  actorRole: Role | PermissionSubject;
}) {
  const { organization, correctionId, actorUserId, actorRole } = options;
  const teamScope =
    hasPermission(actorRole, 'correction:review') && !isSelfScoped(actorRole);

  // Non-reviewers only receive their own correction; someone else's ID is
  // reported as not found instead of confirming that the record exists.
  const correction = await loadCorrection(
    organization.id,
    correctionId,
    teamScope ? undefined : actorUserId,
  );
  return toAttendanceCorrectionSummary(correction);
}

export async function approveAttendanceCorrection(options: {
  organization: OrganizationModel;
  correctionId: string;
  reviewerUserId: string;
  note?: string;
  context?: AuditContext;
}) {
  const { organization, correctionId, reviewerUserId, note, context } = options;
  const header = await AttendanceCorrectionRequest.findOne({
    where: { id: correctionId, organizationId: organization.id },
    attributes: ['id', 'employeeId'],
  });
  if (!header) {
    throw AppError.notFound('Attendance correction not found', 'CORRECTION_NOT_FOUND');
  }

  await serializeByKey(`employee:${header.employeeId}`, () =>
    sequelize.transaction(async (transaction) => {
      await lockEmployee(transaction, header.employeeId);
      const correction = await AttendanceCorrectionRequest.findOne({
        where: { id: correctionId, organizationId: organization.id },
        transaction,
        lock: Transaction.LOCK.UPDATE,
      });
      if (!correction) {
        throw AppError.notFound('Attendance correction not found', 'CORRECTION_NOT_FOUND');
      }

      if (correction.employeeId === reviewerUserId) {
        throw AppError.forbidden(
          'You cannot review your own attendance correction',
          'SELF_REVIEW_FORBIDDEN',
        );
      }

      // Repeated approval is deliberately idempotent: the first decision and
      // its applied attendance snapshot remain authoritative.
      if (correction.status === 'APPROVED') return;
      if (correction.status === 'REJECTED') {
        throw AppError.conflict(
          'This attendance correction has already been rejected',
          'CORRECTION_ALREADY_REJECTED',
        );
      }

      await ensureEmployee(organization.id, correction.employeeId);

      const startedAt = new Date(correction.requestedStartedAt);
      const endedAt = new Date(correction.requestedEndedAt);
      assertStoredInterval(startedAt, endedAt);
      const requestedBreaks = normalizeStoredBreaks(
        correction.requestedBreaks ?? [],
        startedAt,
        endedAt,
      );
      const storedBreaks = requestedBreaks.map((brk) => brk.stored);

      let target: { session: TimeSessionModel; breaks: BreakModel[] } | undefined;
      if (correction.timeSessionId) {
        const loaded = await loadLockedSession(
          transaction,
          organization.id,
          correction.employeeId,
          correction.timeSessionId,
        );
        if (!loaded.session.endedAt || loaded.session.status !== 'STOPPED') {
          throw AppError.conflict(
            'The target session is no longer stopped',
            'SESSION_NOT_CLOSED',
          );
        }
        target = loaded;
      }

      await assertNoSessionOverlap({
        transaction,
        organizationId: organization.id,
        employeeId: correction.employeeId,
        startedAt,
        endedAt,
        excludeSessionId: correction.timeSessionId ?? undefined,
      });

      let session: TimeSessionModel;
      let source: string;
      let before: CorrectionSnapshot | null;

      if (target) {
        before = snapshotFor(target.session, target.breaks);
        await target.session.update(
          {
            startedAt,
            endedAt,
            status: 'STOPPED',
            lastHeartbeatAt: endedAt,
          },
          { transaction },
        );
        session = target.session;
        source = target.session.source;
        await Break.destroy({
          where: { timeSessionId: target.session.id },
          transaction,
        });
      } else {
        before = null;
        session = await TimeSession.create(
          {
            organizationId: organization.id,
            employeeId: correction.employeeId,
            desktopAgentId: null,
            startedAt,
            endedAt,
            status: 'STOPPED',
            source: 'OFFLINE',
            lastHeartbeatAt: endedAt,
          },
          { transaction },
        );
        source = session.source;
      }

      const breaks =
        storedBreaks.length === 0
          ? []
          : await Break.bulkCreate(
              storedBreaks.map((brk) => ({
                organizationId: organization.id,
                timeSessionId: session.id,
                startedAt: new Date(brk.startedAt),
                endedAt: new Date(brk.endedAt),
                status: 'ENDED' as const,
              })),
              { transaction, returning: true },
            );

      const after = snapshotFor(session, breaks, {
        startedAt,
        endedAt,
        status: 'STOPPED',
        source,
      });

      await correction.update(
        {
          status: 'APPROVED',
          reviewedByUserId: reviewerUserId,
          reviewedAt: new Date(),
          reviewerNote: note ?? null,
          rejectionReason: null,
          resultingSessionId: session.id,
          appliedSnapshot: after,
        },
        { transaction },
      );

      await recordAuditEvent(
        {
          organizationId: organization.id,
          actorUserId: reviewerUserId,
          targetEmployeeId: correction.employeeId,
          action: 'ATTENDANCE_CORRECTION_APPROVED',
          entityType: 'ATTENDANCE_CORRECTION',
          entityId: correction.id,
          metadata: {
            requestType: correction.requestType,
            workDate: correction.workDate,
            sessionId: correction.timeSessionId,
            resultingSessionId: session.id,
            originalAtRequest: correction.originalSnapshot,
            before,
            requested: requestedSnapshot({
              startedAt,
              endedAt,
              breaks: storedBreaks,
            }),
            after,
            reviewerNote: note ?? null,
          },
        },
        { transaction, context },
      );
    }),
  );

  return toAttendanceCorrectionSummary(await loadCorrection(organization.id, correctionId));
}

export async function rejectAttendanceCorrection(options: {
  organization: OrganizationModel;
  correctionId: string;
  reviewerUserId: string;
  reason: string;
  note?: string;
  context?: AuditContext;
}) {
  const { organization, correctionId, reviewerUserId, reason, note, context } = options;
  const header = await AttendanceCorrectionRequest.findOne({
    where: { id: correctionId, organizationId: organization.id },
    attributes: ['id', 'employeeId'],
  });
  if (!header) {
    throw AppError.notFound('Attendance correction not found', 'CORRECTION_NOT_FOUND');
  }

  await serializeByKey(`employee:${header.employeeId}`, () =>
    sequelize.transaction(async (transaction) => {
      await lockEmployee(transaction, header.employeeId);
      const correction = await AttendanceCorrectionRequest.findOne({
        where: { id: correctionId, organizationId: organization.id },
        transaction,
        lock: Transaction.LOCK.UPDATE,
      });
      if (!correction) {
        throw AppError.notFound('Attendance correction not found', 'CORRECTION_NOT_FOUND');
      }

      if (correction.employeeId === reviewerUserId) {
        throw AppError.forbidden(
          'You cannot review your own attendance correction',
          'SELF_REVIEW_FORBIDDEN',
        );
      }

      if (correction.status === 'REJECTED') return;
      if (correction.status === 'APPROVED') {
        throw AppError.conflict(
          'This attendance correction has already been approved',
          'CORRECTION_ALREADY_APPROVED',
        );
      }

      await correction.update(
        {
          status: 'REJECTED',
          reviewedByUserId: reviewerUserId,
          reviewedAt: new Date(),
          reviewerNote: note ?? null,
          rejectionReason: reason,
        },
        { transaction },
      );

      await recordAuditEvent(
        {
          organizationId: organization.id,
          actorUserId: reviewerUserId,
          targetEmployeeId: correction.employeeId,
          action: 'ATTENDANCE_CORRECTION_REJECTED',
          entityType: 'ATTENDANCE_CORRECTION',
          entityId: correction.id,
          metadata: {
            requestType: correction.requestType,
            workDate: correction.workDate,
            sessionId: correction.timeSessionId,
            original: correction.originalSnapshot,
            requested: requestedSnapshot({
              startedAt: correction.requestedStartedAt,
              endedAt: correction.requestedEndedAt,
              breaks: correction.requestedBreaks ?? [],
            }),
            rejectionReason: reason,
            reviewerNote: note ?? null,
          },
        },
        { transaction, context },
      );
    }),
  );

  return toAttendanceCorrectionSummary(
    await loadCorrection(organization.id, correctionId),
  );
}
