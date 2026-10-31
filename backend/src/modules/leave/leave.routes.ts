import { Router } from 'express';
import { requireAuth } from '../../middleware/authenticate';
import { validate } from '../../middleware/validate';
import { requirePermission } from '../memberships/permissions';
import { loadOrganizationContext } from '../memberships/organizationContext';
import { organizationIdParamsSchema } from '../organizations/organization.schemas';
import {
  applyLeaveSchema,
  approveLeaveRequestSchema,
  bulkLeaveAdjustmentConfirmSchema,
  bulkLeaveAdjustmentSchema,
  cancelLeaveRequestSchema,
  createLeaveHolidaySchema,
  createLeaveTypeSchema,
  leaveAccrualPreviewQuerySchema,
  leaveAuditQuerySchema,
  leaveBalanceBackfillQuerySchema,
  leaveBalanceBackfillSchema,
  leaveBalanceDetailQuerySchema,
  leaveBalanceEmployeeParamsSchema,
  leaveBalanceListQuerySchema,
  leaveBalanceReconciliationQuerySchema,
  leaveBalanceRepairSchema,
  leaveHolidayIdParamsSchema,
  leaveHolidayQuerySchema,
  leaveLedgerQuerySchema,
  leavePolicyIdParamsSchema,
  leaveRequestIdParamsSchema,
  leaveRequestListQuerySchema,
  leaveTypeIdParamsSchema,
  leaveTypesQuerySchema,
  leaveAdjustmentSchema,
  rejectLeaveRequestSchema,
  updateLeavePolicySchema,
  updateLeaveTypeSchema,
} from './leave.schemas';
import {
  accrualPreview,
  adjustBalance,
  approveRequest,
  backfillBalances,
  bulkAdjustment,
  cancelRequest,
  createHoliday,
  createRequest,
  createType,
  deleteHoliday,
  employeeBalances,
  getRequest,
  ledger,
  listAudit,
  listBalances,
  listHolidays,
  listPolicies,
  listRequests,
  listTypes,
  myBalances,
  previewAdjustment,
  previewBackfill,
  previewBulkAdjustment,
  reconciliation,
  rejectRequest,
  repairReconciliation,
  updatePolicy,
  updateType,
} from './leave.controller';

/**
 * Organization-scoped leave management. Employees can read their own catalog,
 * balances and requests; catalog/balance administration and approvals require
 * explicit leave:manage / leave:approve permissions (OWNER and ADMIN only).
 */
export function createOrganizationLeaveRouter(): Router {
  const router = Router({ mergeParams: true });

  router.get(
    '/:organizationId/leave/types',
    requireAuth,
    validate({ params: organizationIdParamsSchema }),
    loadOrganizationContext,
    requirePermission('leave:read'),
    validate({ query: leaveTypesQuerySchema }),
    listTypes,
  );

  router.post(
    '/:organizationId/leave/types',
    requireAuth,
    validate({ params: organizationIdParamsSchema }),
    loadOrganizationContext,
    requirePermission('leave:manage'),
    validate({ body: createLeaveTypeSchema }),
    createType,
  );

  router.patch(
    '/:organizationId/leave/types/:leaveTypeId',
    requireAuth,
    validate({ params: leaveTypeIdParamsSchema }),
    loadOrganizationContext,
    requirePermission('leave:manage'),
    validate({ body: updateLeaveTypeSchema }),
    updateType,
  );

  router.get(
    '/:organizationId/leave/policies',
    requireAuth,
    validate({ params: organizationIdParamsSchema }),
    loadOrganizationContext,
    requirePermission('leave:read'),
    listPolicies,
  );

  router.put(
    '/:organizationId/leave/policies/:policyId',
    requireAuth,
    validate({ params: leavePolicyIdParamsSchema }),
    loadOrganizationContext,
    requirePermission('leave:manage'),
    validate({ body: updateLeavePolicySchema }),
    updatePolicy,
  );

  router.get(
    '/:organizationId/leave/holidays',
    requireAuth,
    validate({ params: organizationIdParamsSchema }),
    loadOrganizationContext,
    requirePermission('leave:read'),
    validate({ query: leaveHolidayQuerySchema }),
    listHolidays,
  );

  router.post(
    '/:organizationId/leave/holidays',
    requireAuth,
    validate({ params: organizationIdParamsSchema }),
    loadOrganizationContext,
    requirePermission('leave:manage'),
    validate({ body: createLeaveHolidaySchema }),
    createHoliday,
  );

  router.delete(
    '/:organizationId/leave/holidays/:holidayId',
    requireAuth,
    validate({ params: leaveHolidayIdParamsSchema }),
    loadOrganizationContext,
    requirePermission('leave:manage'),
    deleteHoliday,
  );

  router.get(
    '/:organizationId/leave/balances/me',
    requireAuth,
    validate({ params: organizationIdParamsSchema }),
    loadOrganizationContext,
    requirePermission('leave:read'),
    validate({ query: leaveBalanceDetailQuerySchema }),
    myBalances,
  );

  router.get(
    '/:organizationId/leave/balances/ledger',
    requireAuth,
    validate({ params: organizationIdParamsSchema }),
    loadOrganizationContext,
    requirePermission('leave:manage'),
    validate({ query: leaveLedgerQuerySchema }),
    ledger,
  );

  router.get(
    '/:organizationId/leave/balances/backfill/preview',
    requireAuth,
    validate({ params: organizationIdParamsSchema }),
    loadOrganizationContext,
    requirePermission('leave:manage'),
    validate({ query: leaveBalanceBackfillQuerySchema }),
    previewBackfill,
  );

  router.post(
    '/:organizationId/leave/balances/backfill',
    requireAuth,
    validate({ params: organizationIdParamsSchema }),
    loadOrganizationContext,
    requirePermission('leave:manage'),
    validate({ body: leaveBalanceBackfillSchema }),
    backfillBalances,
  );

  router.get(
    '/:organizationId/leave/balances/reconciliation',
    requireAuth,
    validate({ params: organizationIdParamsSchema }),
    loadOrganizationContext,
    requirePermission('leave:manage'),
    validate({ query: leaveBalanceReconciliationQuerySchema }),
    reconciliation,
  );

  router.post(
    '/:organizationId/leave/balances/reconciliation/repair',
    requireAuth,
    validate({ params: organizationIdParamsSchema }),
    loadOrganizationContext,
    requirePermission('leave:manage'),
    validate({ body: leaveBalanceRepairSchema }),
    repairReconciliation,
  );

  router.get(
    '/:organizationId/leave/balances/accrual-preview',
    requireAuth,
    validate({ params: organizationIdParamsSchema }),
    loadOrganizationContext,
    requirePermission('leave:manage'),
    validate({ query: leaveAccrualPreviewQuerySchema }),
    accrualPreview,
  );

  router.post(
    '/:organizationId/leave/balances/bulk-adjustments/preview',
    requireAuth,
    validate({ params: organizationIdParamsSchema }),
    loadOrganizationContext,
    requirePermission('leave:manage'),
    validate({ body: bulkLeaveAdjustmentSchema }),
    previewBulkAdjustment,
  );

  router.post(
    '/:organizationId/leave/balances/bulk-adjustments',
    requireAuth,
    validate({ params: organizationIdParamsSchema }),
    loadOrganizationContext,
    requirePermission('leave:manage'),
    validate({ body: bulkLeaveAdjustmentConfirmSchema }),
    bulkAdjustment,
  );

  router.get(
    '/:organizationId/leave/balances',
    requireAuth,
    validate({ params: organizationIdParamsSchema }),
    loadOrganizationContext,
    requirePermission('leave:manage'),
    validate({ query: leaveBalanceListQuerySchema }),
    listBalances,
  );

  router.get(
    '/:organizationId/leave/balances/:employeeId',
    requireAuth,
    validate({ params: leaveBalanceEmployeeParamsSchema }),
    loadOrganizationContext,
    requirePermission('leave:read'),
    validate({ query: leaveBalanceDetailQuerySchema }),
    employeeBalances,
  );

  router.post(
    '/:organizationId/leave/balances/:employeeId/adjustments/preview',
    requireAuth,
    validate({ params: leaveBalanceEmployeeParamsSchema }),
    loadOrganizationContext,
    requirePermission('leave:manage'),
    validate({ body: leaveAdjustmentSchema }),
    previewAdjustment,
  );

  router.post(
    '/:organizationId/leave/balances/:employeeId/adjustments',
    requireAuth,
    validate({ params: leaveBalanceEmployeeParamsSchema }),
    loadOrganizationContext,
    requirePermission('leave:manage'),
    validate({ body: leaveAdjustmentSchema }),
    adjustBalance,
  );

  router.get(
    '/:organizationId/leave/requests',
    requireAuth,
    validate({ params: organizationIdParamsSchema }),
    loadOrganizationContext,
    requirePermission('leave:read'),
    validate({ query: leaveRequestListQuerySchema }),
    listRequests,
  );

  router.post(
    '/:organizationId/leave/requests',
    requireAuth,
    validate({ params: organizationIdParamsSchema }),
    loadOrganizationContext,
    requirePermission('leave:write'),
    validate({ body: applyLeaveSchema }),
    createRequest,
  );

  router.get(
    '/:organizationId/leave/requests/:requestId',
    requireAuth,
    validate({ params: leaveRequestIdParamsSchema }),
    loadOrganizationContext,
    requirePermission('leave:read'),
    getRequest,
  );

  router.post(
    '/:organizationId/leave/requests/:requestId/approve',
    requireAuth,
    validate({ params: leaveRequestIdParamsSchema }),
    loadOrganizationContext,
    requirePermission('leave:approve'),
    validate({ body: approveLeaveRequestSchema }),
    approveRequest,
  );

  router.post(
    '/:organizationId/leave/requests/:requestId/reject',
    requireAuth,
    validate({ params: leaveRequestIdParamsSchema }),
    loadOrganizationContext,
    requirePermission('leave:approve'),
    validate({ body: rejectLeaveRequestSchema }),
    rejectRequest,
  );

  router.post(
    '/:organizationId/leave/requests/:requestId/cancel',
    requireAuth,
    validate({ params: leaveRequestIdParamsSchema }),
    loadOrganizationContext,
    requirePermission('leave:write'),
    validate({ body: cancelLeaveRequestSchema }),
    cancelRequest,
  );

  router.get(
    '/:organizationId/leave/audit',
    requireAuth,
    validate({ params: organizationIdParamsSchema }),
    loadOrganizationContext,
    requirePermission('leave:manage'),
    validate({ query: leaveAuditQuerySchema }),
    listAudit,
  );

  return router;
}
