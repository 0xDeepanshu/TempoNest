import type { Request, Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { AppError } from '../../utils/errors';
import { getClientIp, getUserAgent } from '../../utils/pagination';
import { hasPermission } from '../memberships/permissions';
import {
  createLeaveHoliday,
  createLeaveType,
  deleteLeaveHoliday,
  listLeaveAudit,
  listLeaveHolidays,
  listLeavePolicies,
  listLeaveTypes,
  updateLeavePolicy,
  updateLeaveType,
} from './leaveCatalog.service';
import {
  adjustLeaveBalance,
  getLeaveBalanceByEmployeeId,
  getEmployeeLeaveBalances,
  listOrganizationLeaveBalances,
  previewLeaveBalanceAdjustment,
} from './leaveBalance.service';
import {
  applyLeaveBalanceBackfill,
  bulkAdjustLeaveBalances,
  getLeaveAccrualPreview,
  getLeaveBalanceReconciliation,
  listLeaveLedger,
  previewBulkLeaveAdjustments,
  previewLeaveBalanceBackfill,
  repairLeaveBalanceReconciliation,
} from './leaveBalanceAdmin.service';
import {
  applyForLeave,
  approveLeaveRequest,
  cancelLeaveRequest,
  getLeaveRequestForActor,
  listLeaveRequests,
  rejectLeaveRequest,
} from './leaveRequest.service';
import { parseIdempotencyKey } from './leave.schemas';
import type {
  ApplyLeaveInput,
  ApproveLeaveRequestInput,
  BulkLeaveAdjustmentConfirmInput,
  BulkLeaveAdjustmentInput,
  CancelLeaveRequestInput,
  CreateLeaveHolidayInput,
  CreateLeaveTypeInput,
  LeaveAccrualPreviewQuery,
  LeaveAuditQuery,
  LeaveBalanceBackfillInput,
  LeaveBalanceBackfillQuery,
  LeaveBalanceDetailQuery,
  LeaveBalanceListQuery,
  LeaveBalanceReconciliationQuery,
  LeaveBalanceRepairInput,
  LeaveHolidayQuery,
  LeaveLedgerQuery,
  LeaveRequestListQuery,
  LeaveTypesQuery,
  RejectLeaveRequestInput,
  UpdateLeavePolicyInput,
  UpdateLeaveTypeInput,
} from './leave.schemas';

function now(): string {
  return new Date().toISOString();
}

function auditContext(req: Request) {
  return { ipAddress: getClientIp(req), userAgent: getUserAgent(req) };
}

function actor(req: Request) {
  return {
    userId: req.auth!.user.id,
    subject: req.organization!.effective,
  };
}

export const listTypes = asyncHandler(async (req: Request, res: Response) => {
  const query = req.query as unknown as LeaveTypesQuery;
  if (query.includeInactive && !hasPermission(actor(req).subject, 'leave:manage')) {
    throw AppError.forbidden('Your role cannot list inactive leave types', 'PERMISSION_DENIED');
  }
  const types = await listLeaveTypes({
    organization: req.organization!.organization,
    includeInactive: query.includeInactive === true,
  });
  res.status(200).json({ data: types, serverTime: now() });
});

export const createType = asyncHandler(async (req: Request, res: Response) => {
  const type = await createLeaveType({
    organization: req.organization!.organization,
    actorUserId: actor(req).userId,
    input: req.body as CreateLeaveTypeInput,
    context: auditContext(req),
  });
  res.status(201).json({ data: { leaveType: type, serverTime: now() } });
});

export const updateType = asyncHandler(async (req: Request, res: Response) => {
  const type = await updateLeaveType({
    organization: req.organization!.organization,
    actorUserId: actor(req).userId,
    leaveTypeId: req.params.leaveTypeId!,
    input: req.body as UpdateLeaveTypeInput,
    context: auditContext(req),
  });
  res.status(200).json({ data: { leaveType: type, serverTime: now() } });
});

export const listPolicies = asyncHandler(async (req: Request, res: Response) => {
  const policies = await listLeavePolicies(req.organization!.organization);
  res.status(200).json({ data: policies, serverTime: now() });
});

export const updatePolicy = asyncHandler(async (req: Request, res: Response) => {
  const policy = await updateLeavePolicy({
    organization: req.organization!.organization,
    actorUserId: actor(req).userId,
    policyId: req.params.policyId!,
    input: req.body as UpdateLeavePolicyInput,
    context: auditContext(req),
  });
  res.status(200).json({ data: { policy, serverTime: now() } });
});

export const listHolidays = asyncHandler(async (req: Request, res: Response) => {
  const holidays = await listLeaveHolidays({
    organization: req.organization!.organization,
    query: req.query as unknown as LeaveHolidayQuery,
  });
  res.status(200).json({ data: holidays, serverTime: now() });
});

export const createHoliday = asyncHandler(async (req: Request, res: Response) => {
  const holiday = await createLeaveHoliday({
    organization: req.organization!.organization,
    actorUserId: actor(req).userId,
    input: req.body as CreateLeaveHolidayInput,
    context: auditContext(req),
  });
  res.status(201).json({ data: { holiday, serverTime: now() } });
});

export const deleteHoliday = asyncHandler(async (req: Request, res: Response) => {
  await deleteLeaveHoliday({
    organization: req.organization!.organization,
    actorUserId: actor(req).userId,
    holidayId: req.params.holidayId!,
    context: auditContext(req),
  });
  res.status(204).send();
});

export const listBalances = asyncHandler(async (req: Request, res: Response) => {
  const result = await listOrganizationLeaveBalances({
    organization: req.organization!.organization,
    query: req.query as unknown as LeaveBalanceListQuery,
  });
  res.status(200).json({ ...result, serverTime: now() });
});

export const myBalances = asyncHandler(async (req: Request, res: Response) => {
  const result = await getEmployeeLeaveBalances({
    organization: req.organization!.organization,
    employeeId: actor(req).userId,
    query: req.query as unknown as LeaveBalanceDetailQuery,
  });
  res.status(200).json({ data: result, serverTime: now() });
});

export const employeeBalances = asyncHandler(async (req: Request, res: Response) => {
  const employeeId = req.params.employeeId!;
  const { userId, subject } = actor(req);
  if (employeeId !== userId && !hasPermission(subject, 'leave:manage')) {
    throw AppError.notFound('Leave balance not found', 'LEAVE_BALANCE_NOT_FOUND');
  }
  const result = await getLeaveBalanceByEmployeeId({
    organization: req.organization!.organization,
    employeeId,
    query: req.query as unknown as LeaveBalanceDetailQuery,
  });
  res.status(200).json({ data: result, serverTime: now() });
});

export const adjustBalance = asyncHandler(async (req: Request, res: Response) => {
  const balance = await adjustLeaveBalance({
    organization: req.organization!.organization,
    employeeId: req.params.employeeId!,
    actorUserId: actor(req).userId,
    input: req.body,
    context: auditContext(req),
  });
  res.status(200).json({ data: { balance, serverTime: now() } });
});

export const previewAdjustment = asyncHandler(async (req: Request, res: Response) => {
  const preview = await previewLeaveBalanceAdjustment({
    organization: req.organization!.organization,
    employeeId: req.params.employeeId!,
    actorUserId: actor(req).userId,
    input: req.body,
  });
  res.status(200).json({ data: { preview, serverTime: now() } });
});

export const previewBackfill = asyncHandler(async (req: Request, res: Response) => {
  const result = await previewLeaveBalanceBackfill({
    organization: req.organization!.organization,
    query: req.query as unknown as LeaveBalanceBackfillQuery,
  });
  res.status(200).json({ data: result, serverTime: now() });
});

export const backfillBalances = asyncHandler(async (req: Request, res: Response) => {
  const result = await applyLeaveBalanceBackfill({
    organization: req.organization!.organization,
    actorUserId: actor(req).userId,
    input: req.body as LeaveBalanceBackfillInput,
    context: auditContext(req),
  });
  res.status(200).json({ data: result, serverTime: now() });
});

export const reconciliation = asyncHandler(async (req: Request, res: Response) => {
  const result = await getLeaveBalanceReconciliation({
    organization: req.organization!.organization,
    query: req.query as unknown as LeaveBalanceReconciliationQuery,
  });
  res.status(200).json({ data: result, serverTime: now() });
});

export const repairReconciliation = asyncHandler(async (req: Request, res: Response) => {
  const result = await repairLeaveBalanceReconciliation({
    organization: req.organization!.organization,
    actorUserId: actor(req).userId,
    input: req.body as LeaveBalanceRepairInput,
    context: auditContext(req),
  });
  res.status(200).json({ data: result, serverTime: now() });
});

export const previewBulkAdjustment = asyncHandler(async (req: Request, res: Response) => {
  const result = await previewBulkLeaveAdjustments({
    organization: req.organization!.organization,
    actorUserId: actor(req).userId,
    input: req.body as BulkLeaveAdjustmentInput,
  });
  res.status(200).json({ data: result, serverTime: now() });
});

export const bulkAdjustment = asyncHandler(async (req: Request, res: Response) => {
  const result = await bulkAdjustLeaveBalances({
    organization: req.organization!.organization,
    actorUserId: actor(req).userId,
    input: req.body as BulkLeaveAdjustmentConfirmInput,
    context: auditContext(req),
  });
  res.status(200).json({ data: result, serverTime: now() });
});

export const accrualPreview = asyncHandler(async (req: Request, res: Response) => {
  const result = await getLeaveAccrualPreview({
    organization: req.organization!.organization,
    query: req.query as unknown as LeaveAccrualPreviewQuery,
  });
  res.status(200).json({ data: result, serverTime: now() });
});

export const ledger = asyncHandler(async (req: Request, res: Response) => {
  const result = await listLeaveLedger({
    organization: req.organization!.organization,
    query: req.query as unknown as LeaveLedgerQuery,
  });
  res.status(200).json({ ...result, serverTime: now() });
});

export const listRequests = asyncHandler(async (req: Request, res: Response) => {
  const { userId, subject } = actor(req);
  const result = await listLeaveRequests({
    organization: req.organization!.organization,
    actorUserId: userId,
    actorRole: subject,
    query: req.query as unknown as LeaveRequestListQuery,
  });
  res.status(200).json({ ...result, serverTime: now() });
});

export const createRequest = asyncHandler(async (req: Request, res: Response) => {
  const idempotencyKey = parseIdempotencyKey(req.get('idempotency-key'));
  const request = await applyForLeave({
    organization: req.organization!.organization,
    employeeId: actor(req).userId,
    input: req.body as ApplyLeaveInput,
    idempotencyKey,
    context: auditContext(req),
  });
  res.status(201).json({ data: { request, serverTime: now() } });
});

export const getRequest = asyncHandler(async (req: Request, res: Response) => {
  const { userId, subject } = actor(req);
  const request = await getLeaveRequestForActor({
    organization: req.organization!.organization,
    requestId: req.params.requestId!,
    actorUserId: userId,
    actorRole: subject,
  });
  res.status(200).json({ data: { request, serverTime: now() } });
});

export const approveRequest = asyncHandler(async (req: Request, res: Response) => {
  const request = await approveLeaveRequest({
    organization: req.organization!.organization,
    requestId: req.params.requestId!,
    reviewerUserId: actor(req).userId,
    input: req.body as ApproveLeaveRequestInput,
    context: auditContext(req),
  });
  res.status(200).json({ data: { request, serverTime: now() } });
});

export const rejectRequest = asyncHandler(async (req: Request, res: Response) => {
  const request = await rejectLeaveRequest({
    organization: req.organization!.organization,
    requestId: req.params.requestId!,
    reviewerUserId: actor(req).userId,
    input: req.body as RejectLeaveRequestInput,
    context: auditContext(req),
  });
  res.status(200).json({ data: { request, serverTime: now() } });
});

export const cancelRequest = asyncHandler(async (req: Request, res: Response) => {
  const { userId, subject } = actor(req);
  const request = await cancelLeaveRequest({
    organization: req.organization!.organization,
    requestId: req.params.requestId!,
    actorUserId: userId,
    actorRole: subject,
    input: req.body as CancelLeaveRequestInput,
    context: auditContext(req),
  });
  res.status(200).json({ data: { request, serverTime: now() } });
});

export const listAudit = asyncHandler(async (req: Request, res: Response) => {
  const result = await listLeaveAudit({
    organization: req.organization!.organization,
    query: req.query as unknown as LeaveAuditQuery,
  });
  res.status(200).json({ ...result, serverTime: now() });
});
