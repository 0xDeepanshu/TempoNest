import type { NextFunction, Request, Response } from 'express';
import { sequelize, AttendanceEvidence, Organization } from '../../database';
import { config } from '../../config/env';
import { AppError } from '../../utils/errors';
import { generateOpaqueToken, generateUuid, hashOpaqueToken } from '../../utils/crypto';
import { serializeByKey } from '../../utils/serialize';
import { screenshotStorage } from '../screenshots/storage';
import {
  SCREENSHOT_EXTENSIONS,
  normalizeContentType,
} from '../screenshots/screenshot.validation';
import { recordAuditEvent, type AuditContext } from '../screenshots/audit.service';
import { isSelfScoped, type PermissionSubject } from '../memberships/permissions';
import {
  toAttendanceEvidenceSummary,
  type AttendanceEvidenceSummary,
} from './attendance.mapper';
import {
  createAttendanceEvidenceDownloadToken,
  verifyAttendanceEvidenceDownloadToken,
} from './attendanceEvidence.tokens';
import {
  assertAttendanceEvidenceContentType,
  validateAttendanceEvidenceFile,
} from './attendanceEvidence.validation';
import type { Role } from '../memberships/roles';
import type { DesktopAgent as DesktopAgentModel } from '../desktopAgents/desktopAgent.model';
import type { AttendanceEvidence as AttendanceEvidenceModel } from './attendanceEvidence.model';
import type { CreateAttendanceEvidenceInput } from './attendance.schemas';

const EVIDENCE_UPLOAD_PATH = '/agent/attendance-evidence';
const EVIDENCE_DOWNLOAD_PATH = '/attendance-files';

/** Attendance writes are mobile-only; Electron keeps using /time-sessions. */
export function requireMobileAgent(req: Request, _res: Response, next: NextFunction): void {
  const agent = req.desktopAgent;
  if (!agent) {
    return next(AppError.unauthorized('Desktop agent credentials are required', 'AGENT_AUTH_REQUIRED'));
  }
  if (agent.clientType !== 'MOBILE') {
    return next(
      AppError.forbidden(
        'Mobile attendance requires a registered MOBILE device',
        'MOBILE_AGENT_REQUIRED',
      ),
    );
  }
  next();
}

function assertEvidenceUsable(evidence: AttendanceEvidenceModel, now: Date): void {
  if (evidence.status === 'ATTACHED') {
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
}

async function buildUploadAuthorization(
  evidence: AttendanceEvidenceModel,
  uploadToken: string,
) {
  if (!evidence.uploadExpiresAt) {
    throw AppError.internal(
      'Attendance evidence upload authorization is incomplete',
      'ATTENDANCE_EVIDENCE_STORAGE_ERROR',
    );
  }
  const target = await screenshotStorage.createUploadTarget({
    objectKey: evidence.storageKey,
    contentType: evidence.contentType,
    expiresAt: evidence.uploadExpiresAt,
    uploadToken,
    uploadPath: EVIDENCE_UPLOAD_PATH,
  });
  return {
    method: target.method,
    url: target.url,
    headers: target.headers,
    requiredHeaders: target.requiresApiAuth
      ? { 'X-Organization-Id': evidence.organizationId }
      : {},
    requiresAgentAuth: target.requiresApiAuth,
    expiresAt: target.expiresAt,
    maxBytes: config.screenshots.maxBytes,
    contentType: evidence.contentType,
  };
}

export async function createAttendanceEvidenceUpload(options: {
  organizationId: string;
  employeeId: string;
  agent: DesktopAgentModel;
  input: CreateAttendanceEvidenceInput;
  context?: AuditContext;
}): Promise<{ evidence: AttendanceEvidenceSummary; upload: Awaited<ReturnType<typeof buildUploadAuthorization>> }> {
  const { organizationId, employeeId, agent, input } = options;
  const now = new Date();

  const contentType = normalizeContentType(input.contentType);
  assertAttendanceEvidenceContentType(contentType);

  let capturedAt: Date | null = null;
  if (input.capturedAt) {
    capturedAt = new Date(input.capturedAt);
    if (
      capturedAt.getTime() >
      now.getTime() + config.attendance.locationFutureSkewSeconds * 1000
    ) {
      throw AppError.unprocessable(
        'capturedAt cannot be in the future',
        'EVIDENCE_CAPTURED_AT_IN_FUTURE',
      );
    }
  }

  const evidenceId = generateUuid();
  const extension = SCREENSHOT_EXTENSIONS[contentType] ?? 'bin';
  const storageKey = `organizations/${organizationId}/attendance/${evidenceId}/${generateUuid()}.${extension}`;
  const uploadToken = generateOpaqueToken();
  const expiresAt = new Date(now.getTime() + config.attendance.evidenceTtlSeconds * 1000);
  const uploadExpiresAt = new Date(
    Math.min(
      now.getTime() + config.attendance.uploadTtlSeconds * 1000,
      expiresAt.getTime(),
    ),
  );

  const evidence = await sequelize.transaction(async (transaction) => {
    const created = await AttendanceEvidence.create(
      {
        id: evidenceId,
        organizationId,
        employeeId,
        desktopAgentId: agent.id,
        kind: input.kind,
        status: 'PENDING',
        storageKey,
        contentType,
        uploadTokenHash: hashOpaqueToken(uploadToken, config.auth.tokenPepper),
        uploadExpiresAt,
        capturedAt,
        expiresAt,
      },
      { transaction },
    );

    await recordAuditEvent(
      {
        organizationId,
        actorUserId: employeeId,
        targetEmployeeId: employeeId,
        action: 'ATTENDANCE_EVIDENCE_CREATED',
        entityType: 'ATTENDANCE_EVIDENCE',
        entityId: created.id,
        metadata: {
          kind: created.kind,
          contentType: created.contentType,
          capturedAt: capturedAt?.toISOString() ?? null,
          expiresAt: expiresAt.toISOString(),
          desktopAgentId: agent.id,
        },
      },
      { transaction, context: options.context },
    );

    return created;
  });

  return {
    evidence: toAttendanceEvidenceSummary(evidence),
    upload: await buildUploadAuthorization(evidence, uploadToken),
  };
}

async function loadEvidenceForAgent(options: {
  evidenceId: string;
  organizationId: string;
  employeeId: string;
  agentId: string;
}): Promise<AttendanceEvidenceModel> {
  const evidence = await AttendanceEvidence.findOne({
    where: {
      id: options.evidenceId,
      organizationId: options.organizationId,
      employeeId: options.employeeId,
      desktopAgentId: options.agentId,
    },
  });
  if (!evidence) {
    throw AppError.notFound('Attendance evidence not found', 'ATTENDANCE_EVIDENCE_NOT_FOUND');
  }
  return evidence;
}

export async function reauthorizeAttendanceEvidenceUpload(options: {
  organizationId: string;
  evidenceId: string;
  employeeId: string;
  agent: DesktopAgentModel;
}): Promise<{ evidence: AttendanceEvidenceSummary; upload: Awaited<ReturnType<typeof buildUploadAuthorization>> }> {
  const now = new Date();
  const evidence = await loadEvidenceForAgent({
    evidenceId: options.evidenceId,
    organizationId: options.organizationId,
    employeeId: options.employeeId,
    agentId: options.agent.id,
  });

  if (evidence.status !== 'PENDING') {
    throw AppError.conflict(
      evidence.status === 'ATTACHED'
        ? 'This attendance photo is already attached to a check-in'
        : 'The attendance photo has already been uploaded',
      evidence.status === 'ATTACHED'
        ? 'ATTENDANCE_EVIDENCE_ALREADY_ATTACHED'
        : 'ATTENDANCE_EVIDENCE_ALREADY_UPLOADED',
    );
  }
  if (evidence.expiresAt.getTime() <= now.getTime()) {
    throw AppError.gone(
      'This attendance photo has expired and must be created again',
      'ATTENDANCE_EVIDENCE_EXPIRED',
    );
  }

  const uploadToken = generateOpaqueToken();
  const uploadExpiresAt = new Date(
    Math.min(
      now.getTime() + config.attendance.uploadTtlSeconds * 1000,
      evidence.expiresAt.getTime(),
    ),
  );
  await evidence.update({
    uploadTokenHash: hashOpaqueToken(uploadToken, config.auth.tokenPepper),
    uploadExpiresAt,
  });

  return {
    evidence: toAttendanceEvidenceSummary(evidence),
    upload: await buildUploadAuthorization(evidence, uploadToken),
  };
}

export async function storeAttendanceEvidenceUpload(options: {
  organizationId: string;
  agent: DesktopAgentModel;
  uploadToken: string;
  body: Buffer;
  contentType: string | null;
  context?: AuditContext;
}): Promise<AttendanceEvidenceSummary> {
  const now = new Date();
  const tokenHash = hashOpaqueToken(options.uploadToken, config.auth.tokenPepper);
  const evidence = await AttendanceEvidence.findOne({
    where: {
      organizationId: options.organizationId,
      employeeId: options.agent.userId,
      desktopAgentId: options.agent.id,
      uploadTokenHash: tokenHash,
    },
  });
  if (!evidence) {
    throw AppError.notFound(
      'Attendance upload authorization is invalid',
      'ATTENDANCE_EVIDENCE_UPLOAD_INVALID',
    );
  }
  if (evidence.status !== 'PENDING') {
    throw AppError.conflict(
      evidence.status === 'ATTACHED'
        ? 'This attendance photo is already attached to a check-in'
        : 'The attendance photo has already been uploaded',
      evidence.status === 'ATTACHED'
        ? 'ATTENDANCE_EVIDENCE_ALREADY_ATTACHED'
        : 'ATTENDANCE_EVIDENCE_ALREADY_UPLOADED',
    );
  }
  if (!evidence.uploadExpiresAt || evidence.uploadExpiresAt.getTime() <= now.getTime()) {
    throw AppError.gone(
      'Attendance upload authorization has expired',
      'ATTENDANCE_UPLOAD_AUTHORIZATION_EXPIRED',
    );
  }
  if (evidence.expiresAt.getTime() <= now.getTime()) {
    throw AppError.gone(
      'This attendance photo has expired and must be created again',
      'ATTENDANCE_EVIDENCE_EXPIRED',
    );
  }

  const contentType = normalizeContentType(options.contentType);
  const validatedContentType = validateAttendanceEvidenceFile({
    contentType,
    expectedContentType: evidence.contentType,
    sizeBytes: options.body.length,
    prefix: options.body.subarray(0, 16),
  });

  let wroteObject = false;
  try {
    return await serializeByKey(`attendance-evidence:${evidence.id}`, () =>
      sequelize.transaction(async (transaction) => {
        const locked = await AttendanceEvidence.findByPk(evidence.id, {
          transaction,
          lock: transaction.LOCK.UPDATE,
        });
        if (!locked) {
          throw AppError.notFound(
            'Attendance evidence not found',
            'ATTENDANCE_EVIDENCE_NOT_FOUND',
          );
        }
        if (locked.status !== 'PENDING') {
          throw AppError.conflict(
            'The attendance photo has already been uploaded',
            'ATTENDANCE_EVIDENCE_ALREADY_UPLOADED',
          );
        }
        if (locked.uploadTokenHash !== tokenHash) {
          throw AppError.gone(
            'Attendance upload authorization is no longer valid',
            'ATTENDANCE_UPLOAD_AUTHORIZATION_EXPIRED',
          );
        }
        if (!locked.uploadExpiresAt || locked.uploadExpiresAt.getTime() <= now.getTime()) {
          throw AppError.gone(
            'Attendance upload authorization has expired',
            'ATTENDANCE_UPLOAD_AUTHORIZATION_EXPIRED',
          );
        }
        if (locked.expiresAt.getTime() <= now.getTime()) {
          throw AppError.gone(
            'This attendance photo has expired and must be created again',
            'ATTENDANCE_EVIDENCE_EXPIRED',
          );
        }

        // The key comes from the locked row and is never client-controlled.
        const stored = await screenshotStorage.putObject({
          objectKey: locked.storageKey,
          body: options.body,
          contentType: validatedContentType,
        });
        wroteObject = true;

        await locked.update(
          {
            status: 'UPLOADED',
            uploadedAt: now,
            fileSizeBytes: stored.sizeBytes,
            uploadTokenHash: null,
            uploadExpiresAt: null,
          },
          { transaction },
        );

        await recordAuditEvent(
          {
            organizationId: locked.organizationId,
            actorUserId: locked.employeeId,
            targetEmployeeId: locked.employeeId,
            action: 'ATTENDANCE_EVIDENCE_UPLOADED',
            entityType: 'ATTENDANCE_EVIDENCE',
            entityId: locked.id,
            metadata: {
              kind: locked.kind,
              contentType: validatedContentType,
              fileSizeBytes: stored.sizeBytes,
              desktopAgentId: locked.desktopAgentId,
            },
          },
          { transaction, context: options.context },
        );

        return toAttendanceEvidenceSummary(locked);
      }),
    );
  } catch (error) {
    // Only remove bytes when no successful upload row claims them. Uploaded or
    // attached evidence is never deleted by error recovery.
    if (wroteObject) {
      const current = await AttendanceEvidence.findByPk(evidence.id);
      if (current?.status === 'PENDING' && current.uploadTokenHash === tokenHash) {
        await screenshotStorage.deleteObject(evidence.storageKey).catch(() => undefined);
      }
    }
    throw error;
  }
}

export async function createAttendanceEvidenceAccess(options: {
  organizationId: string;
  evidenceId: string;
  actorUserId: string;
  actorRole: Role | PermissionSubject;
  context?: AuditContext;
}) {
  const evidence = await AttendanceEvidence.findOne({
    where: { id: options.evidenceId, organizationId: options.organizationId },
  });
  if (!evidence) {
    throw AppError.notFound('Attendance evidence not found', 'ATTENDANCE_EVIDENCE_NOT_FOUND');
  }
  if (isSelfScoped(options.actorRole) && evidence.employeeId !== options.actorUserId) {
    throw AppError.notFound('Attendance evidence not found', 'ATTENDANCE_EVIDENCE_NOT_FOUND');
  }
  if (evidence.status === 'PENDING') {
    throw AppError.conflict(
      'The attendance photo has not been uploaded yet',
      'ATTENDANCE_EVIDENCE_NOT_UPLOADED',
    );
  }

  const expiresAt = new Date(
    Date.now() + config.attendance.downloadTtlSeconds * 1000,
  );
  const downloadToken = createAttendanceEvidenceDownloadToken({
    evidenceId: evidence.id,
    organizationId: options.organizationId,
    actorUserId: options.actorUserId,
    expiresAt,
  });
  const access = await screenshotStorage.createDownloadUrl({
    screenshotId: evidence.id,
    organizationId: options.organizationId,
    actorUserId: options.actorUserId,
    objectKey: evidence.storageKey,
    expiresAt,
    downloadToken,
    downloadPath: EVIDENCE_DOWNLOAD_PATH,
  });

  await recordAuditEvent(
    {
      organizationId: options.organizationId,
      actorUserId: options.actorUserId,
      targetEmployeeId: evidence.employeeId,
      action: 'ATTENDANCE_EVIDENCE_ACCESS_GRANTED',
      entityType: 'ATTENDANCE_EVIDENCE',
      entityId: evidence.id,
      metadata: {
        kind: evidence.kind,
        expiresAt: access.expiresAt.toISOString(),
        storageDriver: screenshotStorage.driver,
      },
    },
    { context: options.context },
  );

  return {
    evidence: toAttendanceEvidenceSummary(evidence),
    url: access.url,
    expiresAt: access.expiresAt,
  };
}

export async function openAttendanceEvidenceFile(
  token: string,
  context?: AuditContext,
) {
  const verified = verifyAttendanceEvidenceDownloadToken(token);
  if (!verified) {
    throw AppError.notFound(
      'Attendance evidence link is invalid or expired',
      'ATTENDANCE_EVIDENCE_LINK_INVALID',
    );
  }

  // Signed links are short-lived, but suspension must still take effect
  // immediately for already-issued URLs.
  const organization = await Organization.findOne({
    where: { id: verified.organizationId, status: 'ACTIVE', deletedAt: null },
    attributes: ['id'],
  });
  if (!organization) {
    throw AppError.notFound('Attendance evidence not found', 'ATTENDANCE_EVIDENCE_NOT_FOUND');
  }

  const evidence = await AttendanceEvidence.findOne({
    where: { id: verified.evidenceId, organizationId: verified.organizationId },
  });
  if (!evidence || evidence.status === 'PENDING') {
    throw AppError.notFound('Attendance evidence not found', 'ATTENDANCE_EVIDENCE_NOT_FOUND');
  }

  const object = await screenshotStorage.openObject(evidence.storageKey);
  if (!object) {
    throw AppError.notFound('Attendance evidence not found', 'ATTENDANCE_EVIDENCE_NOT_FOUND');
  }

  await recordAuditEvent(
    {
      organizationId: evidence.organizationId,
      actorUserId: verified.actorUserId,
      targetEmployeeId: evidence.employeeId,
      action: 'ATTENDANCE_EVIDENCE_VIEWED',
      entityType: 'ATTENDANCE_EVIDENCE',
      entityId: evidence.id,
      metadata: { source: 'SIGNED_URL', kind: evidence.kind },
    },
    { context },
  );

  return {
    stream: object.stream,
    sizeBytes: object.sizeBytes,
    contentType: evidence.contentType,
  };
}
