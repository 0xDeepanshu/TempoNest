import type { Request, Response } from 'express';
import { config } from '../../config/env';
import { asyncHandler } from '../../utils/asyncHandler';
import { AppError } from '../../utils/errors';
import { getClientIp, getUserAgent } from '../../utils/pagination';
import {
  acknowledgeScreenshotPolicy,
  getEmployeeScreenshotPolicyDisclosure,
  getScreenshotPolicyView,
  updateScreenshotPolicy,
} from './screenshotPolicy.service';
import {
  acknowledgeScreenshotRequest,
  cancelScreenshotRequest,
  claimScreenshotRequest,
  completeScreenshotRequest,
  createScreenshotAccess,
  createScreenshotRequest,
  failScreenshotRequest,
  getPendingScreenshotRequestsForAgent,
  getScreenshotForAdmin,
  getScreenshotRequestForAdmin,
  listScreenshotAuditEventsForAdmin,
  listScreenshotRequestsForEmployee,
  listScreenshotRequestsForOrganization,
  listScreenshotsForAdmin,
  openScreenshotFile,
  reauthorizeScreenshotUpload,
  storeScreenshotUpload,
} from './screenshot.service';
import { idempotencyKeySchema } from './screenshot.schemas';
import type {
  OrganizationScreenshotRequestListQuery,
  ScreenshotAuditQuery,
  ScreenshotClaimInput,
  ScreenshotCompleteInput,
  ScreenshotFailInput,
  ScreenshotListQuery,
  ScreenshotPolicyUpdate,
  ScreenshotRequestListQuery,
} from './screenshot.schemas';
import { toScreenshotRequestSummary } from './screenshot.mapper';
import {
  isAllowedScreenshotContentType,
  normalizeContentType,
} from './screenshot.validation';

function now(): string {
  return new Date().toISOString();
}

function auditContext(req: Request) {
  return {
    ipAddress: getClientIp(req) ?? null,
    userAgent: getUserAgent(req),
  };
}

function idempotencyKey(req: Request): string | null {
  const value = req.get('idempotency-key');
  if (!value) return null;
  const parsed = idempotencyKeySchema.safeParse(value);
  if (!parsed.success) {
    throw AppError.badRequest('Idempotency-Key header is invalid', 'IDEMPOTENCY_KEY_INVALID');
  }
  return parsed.data;
}

export const createRequest = asyncHandler(async (req: Request, res: Response) => {
  const result = await createScreenshotRequest({
    organizationId: req.organization!.organization.id,
    employeeId: req.params.employeeId!,
    actorUserId: req.auth!.user.id,
    actorRole: req.organization!.membership.role,
    idempotencyKey: idempotencyKey(req),
    context: auditContext(req),
  });

  res.status(result.replayed ? 200 : 201).json({
    data: {
      request: toScreenshotRequestSummary(result.request),
      delivery: {
        agentOnline: result.agentOnline,
        delivered: result.delivered,
        note: result.delivered
          ? 'The request was sent to a live agent connection.'
          : 'No live agent connection is available. The request remains pending until the agent reconnects or it expires.',
      },
      replayed: result.replayed,
    },
    serverTime: now(),
  });
});

export const listEmployeeRequests = asyncHandler(async (req: Request, res: Response) => {
  const query = req.query as unknown as ScreenshotRequestListQuery;
  const result = await listScreenshotRequestsForEmployee({
    organizationId: req.organization!.organization.id,
    employeeId: req.params.employeeId!,
    actorRole: req.organization!.membership.role,
    page: query.page,
    limit: query.limit,
    status: query.status,
  });
  res.status(200).json({ ...result, serverTime: now() });
});

export const listRequests = asyncHandler(async (req: Request, res: Response) => {
  const query = req.query as unknown as OrganizationScreenshotRequestListQuery;
  const result = await listScreenshotRequestsForOrganization({
    organizationId: req.organization!.organization.id,
    actorRole: req.organization!.membership.role,
    page: query.page,
    limit: query.limit,
    employeeId: query.employeeId,
    status: query.status,
  });
  res.status(200).json({ ...result, serverTime: now() });
});

export const getRequest = asyncHandler(async (req: Request, res: Response) => {
  const request = await getScreenshotRequestForAdmin({
    organizationId: req.organization!.organization.id,
    requestId: req.params.requestId!,
    actorRole: req.organization!.membership.role,
  });
  res.status(200).json({ data: { request }, serverTime: now() });
});

export const cancelRequest = asyncHandler(async (req: Request, res: Response) => {
  const request = await cancelScreenshotRequest({
    organizationId: req.organization!.organization.id,
    requestId: req.params.requestId!,
    actorUserId: req.auth!.user.id,
    actorRole: req.organization!.membership.role,
    context: auditContext(req),
  });
  res.status(200).json({ data: { request }, serverTime: now() });
});

export const listScreenshots = asyncHandler(async (req: Request, res: Response) => {
  const query = req.query as unknown as ScreenshotListQuery;
  const from = query.from ? new Date(query.from) : undefined;
  const to = query.to ? new Date(query.to) : undefined;
  if (from && to && from.getTime() > to.getTime()) {
    throw AppError.unprocessable(
      'from must be before or equal to to',
      'VALIDATION_ERROR',
      [{ path: 'query.from', message: 'from must be before to' }],
    );
  }

  const result = await listScreenshotsForAdmin({
    organizationId: req.organization!.organization.id,
    actorRole: req.organization!.membership.role,
    page: query.page,
    limit: query.limit,
    employeeId: query.employeeId,
    sessionId: query.sessionId,
    from,
    to,
  });
  res.status(200).json({ ...result, serverTime: now() });
});

export const listAuditEvents = asyncHandler(async (req: Request, res: Response) => {
  const query = req.query as unknown as ScreenshotAuditQuery;
  const from = query.from ? new Date(query.from) : undefined;
  const to = query.to ? new Date(query.to) : undefined;
  if (from && to && from.getTime() > to.getTime()) {
    throw AppError.unprocessable(
      'from must be before or equal to to',
      'VALIDATION_ERROR',
      [{ path: 'query.from', message: 'from must be before to' }],
    );
  }

  const result = await listScreenshotAuditEventsForAdmin({
    organizationId: req.organization!.organization.id,
    actorRole: req.organization!.membership.role,
    page: query.page,
    limit: query.limit,
    employeeId: query.employeeId,
    requestId: query.requestId,
    action: query.action,
    from,
    to,
  });
  res.status(200).json({ ...result, serverTime: now() });
});

export const getScreenshot = asyncHandler(async (req: Request, res: Response) => {
  const screenshot = await getScreenshotForAdmin({
    organizationId: req.organization!.organization.id,
    screenshotId: req.params.screenshotId!,
    actorRole: req.organization!.membership.role,
  });
  res.status(200).json({ data: { screenshot }, serverTime: now() });
});

export const accessScreenshot = asyncHandler(async (req: Request, res: Response) => {
  const result = await createScreenshotAccess({
    organizationId: req.organization!.organization.id,
    screenshotId: req.params.screenshotId!,
    actorUserId: req.auth!.user.id,
    actorRole: req.organization!.membership.role,
    context: auditContext(req),
  });
  res.status(200).json({ data: result, serverTime: now() });
});

export const getPolicy = asyncHandler(async (req: Request, res: Response) => {
  const policy = await getScreenshotPolicyView(req.organization!.organization.id);
  res.status(200).json({ data: { policy }, serverTime: now() });
});

export const updatePolicy = asyncHandler(async (req: Request, res: Response) => {
  const policy = await updateScreenshotPolicy({
    organizationId: req.organization!.organization.id,
    actorUserId: req.auth!.user.id,
    actorRole: req.organization!.membership.role,
    input: req.body as ScreenshotPolicyUpdate,
    context: auditContext(req),
  });
  res.status(200).json({
    data: { policy: await getScreenshotPolicyView(policy.organizationId) },
    serverTime: now(),
  });
});

export const getMyPolicy = asyncHandler(async (req: Request, res: Response) => {
  const policy = await getEmployeeScreenshotPolicyDisclosure(
    req.organization!.organization.id,
    req.auth!.user.id,
  );
  res.status(200).json({ data: { policy }, serverTime: now() });
});

export const acknowledgeMyPolicy = asyncHandler(async (req: Request, res: Response) => {
  const policy = await acknowledgeScreenshotPolicy({
    organizationId: req.organization!.organization.id,
    employeeId: req.auth!.user.id,
    context: auditContext(req),
  });
  res.status(200).json({ data: { policy }, serverTime: now() });
});

export const agentPending = asyncHandler(async (req: Request, res: Response) => {
  const requests = await getPendingScreenshotRequestsForAgent(
    req.organization!.organization.id,
    req.desktopAgent!,
  );
  res.status(200).json({
    data: { requests },
    serverTime: now(),
  });
});

export const agentAcknowledge = asyncHandler(async (req: Request, res: Response) => {
  const result = await acknowledgeScreenshotRequest({
    organizationId: req.organization!.organization.id,
    requestId: req.params.requestId!,
    employeeId: req.auth!.user.id,
    agentId: req.desktopAgent!.id,
    context: auditContext(req),
  });
  res.status(200).json({ data: result, serverTime: now() });
});

export const agentClaim = asyncHandler(async (req: Request, res: Response) => {
  const input = req.body as ScreenshotClaimInput;
  const result = await claimScreenshotRequest({
    organizationId: req.organization!.organization.id,
    requestId: req.params.requestId!,
    employeeId: req.auth!.user.id,
    agentId: req.desktopAgent!.id,
    contentType: input.contentType,
    context: auditContext(req),
  });
  res.status(200).json({ data: result, serverTime: now() });
});

export const agentUploadAuthorization = asyncHandler(async (req: Request, res: Response) => {
  const result = await reauthorizeScreenshotUpload({
    organizationId: req.organization!.organization.id,
    requestId: req.params.requestId!,
    employeeId: req.auth!.user.id,
    agentId: req.desktopAgent!.id,
    contentType: (req.body as ScreenshotClaimInput).contentType,
  });
  res.status(200).json({ data: result, serverTime: now() });
});

export const agentUpload = asyncHandler(async (req: Request, res: Response) => {
  const contentType = normalizeContentType(req.get('content-type'));
  if (!isAllowedScreenshotContentType(contentType)) {
    throw new AppError(
      415,
      'UNSUPPORTED_SCREENSHOT_TYPE',
      'Screenshots must be PNG, JPEG, or WebP images',
    );
  }
  if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
    throw new AppError(422, 'INVALID_SCREENSHOT_FILE', 'The uploaded screenshot is empty');
  }

  const result = await storeScreenshotUpload({
    organizationId: req.organization!.organization.id,
    agent: req.desktopAgent!,
    uploadToken: req.params.token!,
    body: req.body,
    contentType,
  });
  res.status(201).json({ data: result, serverTime: now() });
});

export const agentComplete = asyncHandler(async (req: Request, res: Response) => {
  const input = req.body as ScreenshotCompleteInput;
  const screenshot = await completeScreenshotRequest({
    organizationId: req.organization!.organization.id,
    requestId: req.params.requestId!,
    employeeId: req.auth!.user.id,
    agentId: req.desktopAgent!.id,
    captureTimestamp: input.captureTimestamp,
    context: auditContext(req),
  });
  res.status(200).json({ data: { screenshot }, serverTime: now() });
});

export const agentFail = asyncHandler(async (req: Request, res: Response) => {
  const input = req.body as ScreenshotFailInput;
  const request = await failScreenshotRequest({
    organizationId: req.organization!.organization.id,
    requestId: req.params.requestId!,
    employeeId: req.auth!.user.id,
    agentId: req.desktopAgent!.id,
    code: input.code,
    message: input.message,
    context: auditContext(req),
  });
  res.status(200).json({ data: { request }, serverTime: now() });
});

export const downloadFile = asyncHandler(async (req: Request, res: Response) => {
  const result = await openScreenshotFile(req.params.token!, auditContext(req));
  res.setHeader('Content-Type', result.contentType);
  res.setHeader('Content-Length', String(result.sizeBytes));
  res.setHeader('Content-Disposition', 'inline; filename="screenshot"');
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  result.stream.on('error', (error) => {
    res.destroy(error);
  });
  result.stream.pipe(res);
});

// Referenced so the upload route and documentation share the configured cap.
export const screenshotUploadLimitBytes = config.screenshots.maxBytes;
