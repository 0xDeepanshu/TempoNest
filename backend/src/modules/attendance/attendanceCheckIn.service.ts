import { Transaction, UniqueConstraintError } from 'sequelize';
import { sequelize, AttendanceCheckIn, AttendanceEvidence } from '../../database';
import { config } from '../../config/env';
import { AppError } from '../../utils/errors';
import { serializeByKey } from '../../utils/serialize';
import { screenshotStorage } from '../screenshots/storage';
import { normalizeContentType } from '../screenshots/screenshot.validation';
import { recordAuditEvent, type AuditContext } from '../screenshots/audit.service';
import {
  getCurrentSession,
  getSessionForActor,
  lockEmployee,
  publishSessionUpdate,
  startSessionInTransaction,
} from '../timeTracking/timeSession.service';
import { toTimeSessionSummary } from '../timeTracking/timeSession.mapper';
import { toAttendanceCheckInSummary } from './attendance.mapper';
import { validateAttendanceEvidenceFile } from './attendanceEvidence.validation';
import type { AttendanceCheckIn as AttendanceCheckInModel } from './attendanceCheckIn.model';
import type { AttendanceEvidence as AttendanceEvidenceModel } from './attendanceEvidence.model';
import type { DesktopAgent as DesktopAgentModel } from '../desktopAgents/desktopAgent.model';
import type {
  AttendanceCheckInInput,
  AttendanceLocationInput,
} from './attendance.schemas';

const checkInIncludes = [
  { model: AttendanceEvidence, as: 'selfieEvidence', required: false },
  { model: AttendanceEvidence, as: 'sitePhotoEvidence', required: false },
];

type CheckInResult = {
  checkInId: string;
  sessionId: string;
  autoClosedSessionId: string | null;
  replayed: boolean;
};

function assertLocationPolicy(location: AttendanceLocationInput | undefined, now: Date): void {
  if (!location) return;

  if (location.accuracyMeters > config.attendance.locationMaxAccuracyMeters) {
    throw AppError.unprocessable(
      `Location accuracy must be ${config.attendance.locationMaxAccuracyMeters} meters or better`,
      'LOCATION_ACCURACY_TOO_LOW',
    );
  }

  const recordedAt = Date.parse(location.recordedAt);
  if (recordedAt > now.getTime() + config.attendance.locationFutureSkewSeconds * 1000) {
    throw AppError.unprocessable(
      'Location timestamp is too far in the future',
      'LOCATION_FIX_IN_FUTURE',
    );
  }
  if (recordedAt < now.getTime() - config.attendance.locationMaxAgeSeconds * 1000) {
    throw AppError.unprocessable(
      'Location fix is too old; refresh the location and try again',
      'LOCATION_FIX_TOO_OLD',
    );
  }
}

/**
 * A retried request must describe exactly the same check-in. Comparing the
 * effective payload (not just the request id) prevents a reused id from
 * silently returning a check-in the caller did not ask for.
 */
function sameCheckInPayload(
  existing: AttendanceCheckInModel,
  input: AttendanceCheckInInput,
): boolean {
  if (existing.workMode !== input.workMode) return false;
  if ((existing.selfieEvidenceId ?? null) !== (input.selfieEvidenceId ?? null)) return false;
  if ((existing.sitePhotoEvidenceId ?? null) !== (input.sitePhotoEvidenceId ?? null)) return false;

  const existingHasLocation =
    existing.latitude !== null &&
    existing.longitude !== null &&
    existing.accuracyMeters !== null &&
    existing.locationRecordedAt !== null;

  if (!input.location) return !existingHasLocation;
  if (!existingHasLocation) return false;

  return (
    Number(existing.latitude) === input.location.latitude &&
    Number(existing.longitude) === input.location.longitude &&
    Number(existing.accuracyMeters) === input.location.accuracyMeters &&
    existing.locationRecordedAt!.getTime() === Date.parse(input.location.recordedAt)
  );
}

function uniqueViolationOn(error: UniqueConstraintError, fields: string[]): boolean {
  const keys = Object.keys(error.fields ?? {}).map((key) => key.toLowerCase());
  const message = `${error.message} ${JSON.stringify(error.fields ?? {})}`.toLowerCase();
  return fields.some(
    (field) => keys.includes(field.toLowerCase()) || message.includes(field.toLowerCase()),
  );
}

async function assertStoredEvidenceMatches(evidence: AttendanceEvidenceModel): Promise<void> {
  const missing = AppError.conflict(
    'The attendance photo is missing from storage; capture and upload it again',
    'ATTENDANCE_EVIDENCE_STORAGE_MISSING',
  );

  let stat;
  try {
    stat = await screenshotStorage.statObject(evidence.storageKey);
  } catch {
    throw missing;
  }
  if (!stat || stat.sizeBytes <= 0) throw missing;

  if (evidence.fileSizeBytes !== null && stat.sizeBytes !== evidence.fileSizeBytes) {
    throw AppError.conflict(
      'The stored attendance photo does not match its upload metadata',
      'ATTENDANCE_EVIDENCE_STORAGE_MISMATCH',
    );
  }
  if (
    stat.contentType &&
    normalizeContentType(stat.contentType) !== normalizeContentType(evidence.contentType)
  ) {
    throw AppError.conflict(
      'The stored attendance photo does not match its upload metadata',
      'ATTENDANCE_EVIDENCE_STORAGE_MISMATCH',
    );
  }

  let prefix: Buffer;
  try {
    prefix = await screenshotStorage.readPrefix(evidence.storageKey, 16);
  } catch {
    throw missing;
  }

  try {
    validateAttendanceEvidenceFile({
      contentType: evidence.contentType,
      expectedContentType: evidence.contentType,
      sizeBytes: stat.sizeBytes,
      prefix,
    });
  } catch {
    throw AppError.conflict(
      'The stored attendance photo is not a valid image',
      'ATTENDANCE_EVIDENCE_STORAGE_MISMATCH',
    );
  }
}

async function loadEvidenceForCheckIn(options: {
  transaction: Transaction;
  organizationId: string;
  employeeId: string;
  agentId: string;
  input: AttendanceCheckInInput;
  now: Date;
}): Promise<AttendanceEvidenceModel[]> {
  const { transaction, organizationId, employeeId, agentId, input, now } = options;
  const references: { id: string; kind: 'SELFIE' | 'SITE_PHOTO' }[] = [];
  if (input.selfieEvidenceId) {
    references.push({ id: input.selfieEvidenceId, kind: 'SELFIE' });
  }
  if (input.sitePhotoEvidenceId) {
    references.push({ id: input.sitePhotoEvidenceId, kind: 'SITE_PHOTO' });
  }

  const rows: AttendanceEvidenceModel[] = [];
  for (const reference of references) {
    const evidence = await AttendanceEvidence.findOne({
      where: {
        id: reference.id,
        organizationId,
        employeeId,
        desktopAgentId: agentId,
      },
      transaction,
      lock: Transaction.LOCK.UPDATE,
    });

    if (!evidence) {
      throw AppError.notFound(
        'Attendance evidence not found',
        'ATTENDANCE_EVIDENCE_NOT_FOUND',
      );
    }
    if (evidence.kind !== reference.kind) {
      throw AppError.unprocessable(
        `Evidence ${reference.id} is not a ${reference.kind.toLowerCase()}`,
        'ATTENDANCE_EVIDENCE_KIND_MISMATCH',
      );
    }
    if (evidence.status === 'ATTACHED' || evidence.attachedSessionId) {
      throw AppError.conflict(
        'This attendance photo is already attached to a check-in',
        'ATTENDANCE_EVIDENCE_ALREADY_ATTACHED',
      );
    }
    if (evidence.status !== 'UPLOADED') {
      throw AppError.conflict(
        'The attendance photo has not been uploaded yet',
        'ATTENDANCE_EVIDENCE_NOT_UPLOADED',
      );
    }
    if (evidence.expiresAt.getTime() <= now.getTime()) {
      throw AppError.gone(
        'This attendance photo has expired and must be uploaded again',
        'ATTENDANCE_EVIDENCE_EXPIRED',
      );
    }

    await assertStoredEvidenceMatches(evidence);
    rows.push(evidence);
  }

  return rows;
}

async function insertCheckIn(options: {
  transaction: Transaction;
  organizationId: string;
  employeeId: string;
  agent: DesktopAgentModel;
  input: AttendanceCheckInInput;
  context?: AuditContext;
}): Promise<CheckInResult> {
  const { transaction, organizationId, employeeId, agent, input } = options;

  await lockEmployee(transaction, employeeId);
  const now = new Date();

  const existing = await AttendanceCheckIn.findOne({
    where: { organizationId, employeeId, checkInRequestId: input.checkInRequestId },
    transaction,
    lock: Transaction.LOCK.UPDATE,
  });

  if (existing) {
    if (!sameCheckInPayload(existing, input)) {
      throw AppError.conflict(
        'checkInRequestId was already used with a different check-in payload',
        'IDEMPOTENCY_KEY_REUSED',
      );
    }
    return {
      checkInId: existing.id,
      sessionId: existing.timeSessionId,
      autoClosedSessionId: null,
      replayed: true,
    };
  }

  // WFO is location-free by policy; reject even if a caller bypasses schema
  // validation so coordinates can never be persisted for this mode.
  if (input.workMode === 'WFO' && input.location) {
    throw AppError.unprocessable(
      'WFO check-in does not accept a location',
      'WFO_LOCATION_NOT_ALLOWED',
    );
  }

  // Freshness is evaluated only for new check-ins so a delayed retry of an
  // already-successful request still returns the original result.
  assertLocationPolicy(input.location, now);

  const evidence = await loadEvidenceForCheckIn({
    transaction,
    organizationId,
    employeeId,
    agentId: agent.id,
    input,
    now,
  });

  const started = await startSessionInTransaction({
    transaction,
    organizationId,
    employeeId,
    agent,
    employeeLocked: true,
  });

  const checkIn = await AttendanceCheckIn.create(
    {
      organizationId,
      employeeId,
      desktopAgentId: agent.id,
      timeSessionId: started.session.id,
      workMode: input.workMode,
      selfieEvidenceId: input.selfieEvidenceId ?? null,
      sitePhotoEvidenceId: input.sitePhotoEvidenceId ?? null,
      latitude: input.location?.latitude ?? null,
      longitude: input.location?.longitude ?? null,
      accuracyMeters: input.location?.accuracyMeters ?? null,
      locationRecordedAt: input.location ? new Date(input.location.recordedAt) : null,
      checkInRequestId: input.checkInRequestId,
    },
    { transaction },
  );

  for (const row of evidence) {
    await row.update(
      { status: 'ATTACHED', attachedSessionId: started.session.id },
      { transaction },
    );
  }

  await recordAuditEvent(
    {
      organizationId,
      actorUserId: employeeId,
      targetEmployeeId: employeeId,
      action: 'ATTENDANCE_CHECKED_IN',
      entityType: 'ATTENDANCE_CHECK_IN',
      entityId: checkIn.id,
      metadata: {
        workMode: checkIn.workMode,
        timeSessionId: started.session.id,
        autoClosedSessionId: started.autoClosedSessionId,
        selfieEvidenceId: checkIn.selfieEvidenceId,
        sitePhotoEvidenceId: checkIn.sitePhotoEvidenceId,
        accuracyMeters: checkIn.accuracyMeters,
        desktopAgentId: agent.id,
      },
    },
    { transaction, context: options.context },
  );

  return {
    checkInId: checkIn.id,
    sessionId: started.session.id,
    autoClosedSessionId: started.autoClosedSessionId,
    replayed: false,
  };
}

async function resolveUniqueViolation(options: {
  error: unknown;
  organizationId: string;
  employeeId: string;
  input: AttendanceCheckInInput;
}): Promise<CheckInResult> {
  const { error, organizationId, employeeId, input } = options;
  if (!(error instanceof UniqueConstraintError)) throw error;

  const existing = await AttendanceCheckIn.findOne({
    where: { organizationId, employeeId, checkInRequestId: input.checkInRequestId },
  });
  if (existing) {
    if (!sameCheckInPayload(existing, input)) {
      throw AppError.conflict(
        'checkInRequestId was already used with a different check-in payload',
        'IDEMPOTENCY_KEY_REUSED',
      );
    }
    return {
      checkInId: existing.id,
      sessionId: existing.timeSessionId,
      autoClosedSessionId: null,
      replayed: true,
    };
  }

  if (
    uniqueViolationOn(error, [
      'selfie_evidence_id',
      'selfieEvidenceId',
      'site_photo_evidence_id',
      'sitePhotoEvidenceId',
    ])
  ) {
    throw AppError.conflict(
      'One or more attendance photos are already attached to another check-in',
      'ATTENDANCE_EVIDENCE_ALREADY_ATTACHED',
    );
  }

  throw AppError.conflict(
    'An active time session already exists. Stop it before starting a new one.',
    'ACTIVE_SESSION_EXISTS',
  );
}

async function loadCheckIn(checkInId: string): Promise<AttendanceCheckInModel> {
  const checkIn = await AttendanceCheckIn.findByPk(checkInId, { include: checkInIncludes });
  if (!checkIn) {
    throw AppError.internal(
      'Attendance check-in could not be loaded',
      'ATTENDANCE_CHECK_IN_LOAD_FAILED',
    );
  }
  return checkIn;
}

export async function checkIn(options: {
  organizationId: string;
  employeeId: string;
  agent: DesktopAgentModel;
  input: AttendanceCheckInInput;
  context?: AuditContext;
}) {
  const { organizationId, employeeId, agent, input } = options;

  let result: CheckInResult;
  try {
    result = await serializeByKey(`employee:${employeeId}`, () =>
      sequelize.transaction((transaction) =>
        insertCheckIn({
          transaction,
          organizationId,
          employeeId,
          agent,
          input,
          context: options.context,
        }),
      ),
    );
  } catch (error) {
    result = await resolveUniqueViolation({
      error,
      organizationId,
      employeeId,
      input,
    });
  }

  const checkInRecord = await loadCheckIn(result.checkInId);
  const session = await getSessionForActor({
    organizationId,
    sessionId: result.sessionId,
    actorUserId: employeeId,
    actorRole: 'EMPLOYEE',
  });

  if (!result.replayed) {
    publishSessionUpdate(session);
  }

  return {
    checkIn: toAttendanceCheckInSummary(checkInRecord),
    session: toTimeSessionSummary(session),
    autoClosedSessionId: result.autoClosedSessionId,
    replayed: result.replayed,
  };
}

export async function getCurrentAttendance(options: {
  organizationId: string;
  employeeId: string;
}) {
  const { organizationId, employeeId } = options;

  const session = await getCurrentSession(organizationId, employeeId);
  if (!session) {
    return { checkIn: null, session: null };
  }

  const checkInRecord = await AttendanceCheckIn.findOne({
    where: { organizationId, employeeId, timeSessionId: session.id },
    include: checkInIncludes,
  });

  return {
    checkIn: checkInRecord ? toAttendanceCheckInSummary(checkInRecord) : null,
    session: toTimeSessionSummary(session),
  };
}
