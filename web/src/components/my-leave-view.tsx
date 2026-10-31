"use client";

import { useRef, useState } from "react";
import { formatDateRange, formatDateTime, formatDay } from "@/lib/format";
import {
  balancePeriodLabel,
  formatLeaveUnits,
  formatSignedLeaveUnits,
  isCurrentBalancePeriod,
  leaveDurationLabel,
} from "@/lib/leave";
import {
  cancelLeaveRequest,
  getMyLeaveBalances,
  listLeaveRequests,
  listLeaveTypes,
} from "@/lib/leave-api";
import { leaveErrorMessage } from "@/lib/leave-errors";
import type { LeaveBalance, LeaveRequest, LeaveType } from "@/lib/types";
import { useApi } from "@/lib/use-api";
import { CalendarIcon, CheckSquareIcon, PlusIcon } from "./icons";
import { ConfirmDialog } from "./confirm-dialog";
import { LeaveApplyModal } from "./leave-apply-modal";
import { Modal } from "./modal";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  DetailRow,
  EmptyState,
  ErrorState,
  Field,
  LoadingBlock,
  PageHeader,
  Pagination,
  StatusBadge,
  TableShell,
  Td,
  Textarea,
  Th,
  cn,
} from "./ui";
import { NoOrganization, useWorkspace } from "./workspace";

const PAGE_SIZE = 10;

type CancelTarget = { request: LeaveRequest; requiresApproval: boolean };

export function MyLeaveView() {
  const { organization, user } = useWorkspace();
  const organizationId = organization?.id ?? "";
  const timezone = organization?.timezone ?? "UTC";
  const [page, setPage] = useState(1);
  const [applyOpen, setApplyOpen] = useState(false);
  const [selected, setSelected] = useState<LeaveRequest | null>(null);
  const [cancelTarget, setCancelTarget] = useState<CancelTarget | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const types = useApi(
    (signal) => listLeaveTypes(organizationId, { signal }),
    [organizationId],
    { enabled: Boolean(organizationId) },
  );

  const balances = useApi(
    (signal) => getMyLeaveBalances(organizationId, {}, { signal }),
    [organizationId],
    { enabled: Boolean(organizationId) },
  );

  const requests = useApi(
    (signal) =>
      listLeaveRequests(
        organizationId,
        { employeeId: user.id, page, limit: PAGE_SIZE },
        { signal },
      ),
    [organizationId, user.id, page],
    { enabled: Boolean(organizationId) },
  );

  if (!organization) return <NoOrganization />;

  const activeTypes = types.data?.data ?? [];
  const balanceRows = balances.data?.data.balances ?? [];
  const requestRows = requests.data?.data ?? [];
  const pageNumber = requests.data?.meta.page ?? page;
  const totalPages = requests.data?.meta.totalPages ?? 1;
  const canApply = !types.loading && activeTypes.length > 0;

  function refreshAfterMutation() {
    balances.reload();
    requests.reload();
  }

  function handleApplied() {
    setApplyOpen(false);
    setNotice("Leave request submitted and is pending review.");
    setPage(1);
    refreshAfterMutation();
  }

  function handleCancelled(message: string) {
    setCancelTarget(null);
    setSelected(null);
    setNotice(message);
    refreshAfterMutation();
  }

  function openCancel(request: LeaveRequest, requiresApproval: boolean) {
    setSelected(null);
    setCancelTarget({ request, requiresApproval });
  }

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={`${organization.name} · ${organization.timezone}`}
        title="My leaves"
        description="Check your balances, apply for leave, and follow each request through review."
        actions={
          <Button onClick={() => setApplyOpen(true)} disabled={!canApply}>
            <PlusIcon className="h-3.5 w-3.5" />
            Apply for leave
          </Button>
        }
      />

      {notice ? (
        <Alert tone="success">
          <span className="flex items-start justify-between gap-3">
            <span>{notice}</span>
            <button
              type="button"
              onClick={() => setNotice(null)}
              className="shrink-0 text-xs font-medium underline underline-offset-2"
            >
              Dismiss
            </button>
          </span>
        </Alert>
      ) : null}

      {types.error ? (
        <ErrorState message={types.error} onRetry={types.reload} />
      ) : null}

      <Card>
        <CardHeader
          title="Available balances"
          description="Balances for the current period and any future period with active requests."
        />
        {balances.error ? (
          <div className="p-4">
            <ErrorState message={balances.error} onRetry={balances.reload} />
          </div>
        ) : balances.loading && !balances.data ? (
          <LoadingBlock label="Loading leave balances" rows={3} />
        ) : balanceRows.length === 0 ? (
          <EmptyState
            title="No leave balances"
            description="Your active leave types do not use balances, or no balance is available for the current period."
            icon={<CalendarIcon className="h-5 w-5" />}
            action={
              canApply ? (
                <Button size="sm" onClick={() => setApplyOpen(true)}>
                  Apply for leave
                </Button>
              ) : undefined
            }
          />
        ) : (
          <ul className="divide-y divide-line">
            {balanceRows.map((balance) => (
              <BalanceRow
                key={balance.id}
                balance={balance}
                timezone={timezone}
              />
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <CardHeader
          title="My leave requests"
          description="Pending, approved, rejected, and cancellation states appear here for your own requests."
        />
        {requests.error ? (
          <div className="p-4">
            <ErrorState message={requests.error} onRetry={requests.reload} />
          </div>
        ) : requests.loading && !requests.data ? (
          <LoadingBlock label="Loading leave requests" rows={4} />
        ) : requestRows.length === 0 ? (
          <EmptyState
            title="No leave requests yet"
            description="Your submitted leave will appear here with its review status."
            icon={<CheckSquareIcon className="h-5 w-5" />}
            action={
              canApply ? (
                <Button size="sm" onClick={() => setApplyOpen(true)}>
                  Apply for leave
                </Button>
              ) : undefined
            }
          />
        ) : (
          <>
            <div className="hidden md:block">
              <RequestsTable
                requests={requestRows}
                timezone={timezone}
                onOpen={setSelected}
              />
            </div>
            <div className="divide-y divide-line md:hidden">
              {requestRows.map((request) => (
                <RequestCard
                  key={request.id}
                  request={request}
                  timezone={timezone}
                  onOpen={() => setSelected(request)}
                />
              ))}
            </div>
            <Pagination
              page={pageNumber}
              totalPages={totalPages}
              onPageChange={setPage}
            />
          </>
        )}
      </Card>

      {applyOpen ? (
        <LeaveApplyModal
          organizationId={organization.id}
          timezone={timezone}
          types={activeTypes}
          balances={balanceRows}
          onClose={() => setApplyOpen(false)}
          onApplied={handleApplied}
        />
      ) : null}

      <RequestDetailModal
        key={selected?.id ?? "closed"}
        request={selected}
        timezone={timezone}
        types={activeTypes}
        typesLoading={types.loading}
        typesError={types.error}
        onClose={() => setSelected(null)}
        onCancel={openCancel}
      />

      {cancelTarget ? (
        <CancelLeaveModal
          key={cancelTarget.request.id}
          organizationId={organization.id}
          target={cancelTarget}
          onClose={() => setCancelTarget(null)}
          onCancelled={handleCancelled}
        />
      ) : null}
    </div>
  );
}

function BalanceRow({
  balance,
  timezone,
}: {
  balance: LeaveBalance;
  timezone: string;
}) {
  const currentPeriod = isCurrentBalancePeriod(
    balance.periodStart,
    balance.periodEnd,
    timezone,
  );
  const zero = balance.availableBalance <= 0;

  return (
    <li className="px-4 py-3.5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[13px] font-semibold text-ink">
              {balance.leaveType?.name ?? "Leave"}
            </p>
            <Badge tone={currentPeriod ? "success" : "neutral"}>
              {currentPeriod ? "Current period" : "Other period"}
            </Badge>
            {zero ? <Badge tone="danger">No balance</Badge> : null}
          </div>
          <p className="mt-0.5 text-xs text-muted">
            {balancePeriodLabel(balance.periodStart, balance.periodEnd)}
          </p>
        </div>
        <div className="text-right">
          <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
            Available balance
          </p>
          <p className={cn("tnum text-lg font-semibold", zero ? "text-danger" : "text-ink")}>
            {formatLeaveUnits(balance.availableBalance)}
          </p>
        </div>
      </div>

      <dl className="mt-2.5 grid grid-cols-2 gap-1.5 text-[11px] sm:grid-cols-3 xl:grid-cols-6">
        <BalanceFigure label="Entitled" value={formatLeaveUnits(balance.entitledBalance)} />
        <BalanceFigure label="Accrued" value={formatLeaveUnits(balance.accruedBalance)} />
        <BalanceFigure
          label="Adjusted"
          value={formatSignedLeaveUnits(balance.adjustmentBalance)}
        />
        <BalanceFigure
          label="Carried forward"
          value={formatLeaveUnits(balance.carriedForwardBalance)}
        />
        <BalanceFigure label="Approved" value={formatLeaveUnits(balance.approvedConsumed)} />
        <BalanceFigure
          label="Pending approval"
          value={formatLeaveUnits(balance.pendingReserved)}
        />
      </dl>
    </li>
  );
}

function BalanceFigure({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-md bg-surface-muted px-2 py-1.5">
      <dt className="text-muted">{label}</dt>
      <dd className="tnum font-medium text-ink-secondary">{value}</dd>
    </div>
  );
}

function RequestsTable({
  requests,
  timezone,
  onOpen,
}: {
  requests: LeaveRequest[];
  timezone: string;
  onOpen: (request: LeaveRequest) => void;
}) {
  return (
    <TableShell>
      <thead>
        <tr>
          <Th>Leave</Th>
          <Th>Dates</Th>
          <Th>Days</Th>
          <Th>Status</Th>
          <Th>Submitted</Th>
          <Th className="text-right"> </Th>
        </tr>
      </thead>
      <tbody>
        {requests.map((request) => (
          <tr key={request.id} className="hover:bg-surface-muted">
            <Td>
              <p className="font-medium text-ink">
                {request.leaveType?.name ?? "Leave"}
              </p>
              <p className="mt-0.5 text-xs text-muted">
                {leaveDurationLabel(
                  request.startHalfDay,
                  request.endHalfDay,
                  request.startDate,
                  request.endDate,
                )}
              </p>
            </Td>
            <Td className="whitespace-nowrap text-xs">
              {formatDateRange(request.startDate, request.endDate)}
            </Td>
            <Td className="tnum whitespace-nowrap">{formatLeaveUnits(request.units)}</Td>
            <Td>
              <StatusBadge status={request.status} />
            </Td>
            <Td className="whitespace-nowrap text-xs text-muted">
              {formatDateTime(request.submittedAt, timezone)}
            </Td>
            <Td className="text-right">
              <Button variant="secondary" size="sm" onClick={() => onOpen(request)}>
                Details
              </Button>
            </Td>
          </tr>
        ))}
      </tbody>
    </TableShell>
  );
}

function RequestCard({
  request,
  timezone,
  onOpen,
}: {
  request: LeaveRequest;
  timezone: string;
  onOpen: () => void;
}) {
  return (
    <div className="px-4 py-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-[13px] font-medium text-ink">
            {request.leaveType?.name ?? "Leave"}
          </p>
          <p className="mt-0.5 text-xs text-muted">
            {formatDateRange(request.startDate, request.endDate)} ·{" "}
            {formatLeaveUnits(request.units)}
          </p>
        </div>
        <StatusBadge status={request.status} />
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <p className="text-[11px] text-muted">
          Submitted {formatDateTime(request.submittedAt, timezone)}
        </p>
        <Button variant="secondary" size="sm" onClick={onOpen}>
          Details
        </Button>
      </div>
    </div>
  );
}

function RequestDetailModal({
  request,
  timezone,
  types,
  typesLoading,
  typesError,
  onClose,
  onCancel,
}: {
  request: LeaveRequest | null;
  timezone: string;
  types: LeaveType[];
  typesLoading: boolean;
  typesError: string | null;
  onClose: () => void;
  onCancel: (request: LeaveRequest, requiresApproval: boolean) => void;
}) {
  if (!request) return null;

  const catalogType = types.find((type) => type.id === request.leaveTypeId);
  const requiresApproval = catalogType?.cancellationRequiresApproval === true;
  const approvedCancellable =
    request.status === "APPROVED" && catalogType?.allowApprovedCancellation === true;
  const approvedBlocked =
    request.status === "APPROVED" && catalogType
      ? catalogType.allowApprovedCancellation === false
      : false;
  const cancellationRulesUnavailable =
    request.status === "APPROVED" && !catalogType;

  return (
    <Modal
      open
      onClose={onClose}
      title="Leave request"
      description={`${request.leaveType?.name ?? "Leave"} · ${formatDateRange(
        request.startDate,
        request.endDate,
      )}`}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
          {request.status === "PENDING" ? (
            <Button variant="danger" onClick={() => onCancel(request, false)}>
              Cancel leave
            </Button>
          ) : null}
          {approvedCancellable ? (
            <Button variant="danger" onClick={() => onCancel(request, requiresApproval)}>
              {requiresApproval ? "Request cancellation" : "Cancel leave"}
            </Button>
          ) : null}
        </>
      }
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={request.status} />
          {request.leaveType ? (
            <Badge tone={request.leaveType.isPaid ? "success" : "neutral"}>
              {request.leaveType.isPaid ? "Paid" : "Unpaid"}
            </Badge>
          ) : null}
          {request.leaveType?.requiresBalance ? (
            <Badge tone="outline">Balance required</Badge>
          ) : null}
        </div>

        <dl className="rounded-lg border border-line px-3">
          <DetailRow
            label="Dates"
            value={`${formatDateRange(request.startDate, request.endDate)} · ${leaveDurationLabel(
              request.startHalfDay,
              request.endHalfDay,
              request.startDate,
              request.endDate,
            )}`}
          />
          <DetailRow label="Calculated days" value={formatLeaveUnits(request.units)} />
          {request.chargedDates.length > 0 ? (
            <DetailRow
              label="Charged dates"
              value={
                <span className="text-xs leading-5 text-ink-secondary">
                  {request.chargedDates
                    .map(
                      (day) =>
                        `${formatDay(day.date)} (${formatLeaveUnits(day.units, false)})`,
                    )
                    .join(", ")}
                </span>
              }
            />
          ) : null}
          <DetailRow
            label="Submitted"
            value={formatDateTime(request.submittedAt, timezone)}
          />
          {request.balancePeriodStart ? (
            <DetailRow
              label="Balance period"
              value={`Starts ${formatDay(request.balancePeriodStart)}`}
            />
          ) : null}
          <DetailRow
            label="Remarks"
            value={<span className="whitespace-pre-wrap">{request.reason}</span>}
          />
          {request.documentationReference ? (
            <DetailRow
              label="Documentation"
              value={<span className="break-words">{request.documentationReference}</span>}
            />
          ) : null}
          {request.reviewedAt ? (
            <DetailRow
              label="Reviewed"
              value={formatDateTime(request.reviewedAt, timezone)}
            />
          ) : null}
          {request.reviewer ? (
            <DetailRow label="Reviewer" value={request.reviewer.name} />
          ) : null}
          {request.reviewerNote ? (
            <DetailRow
              label="Reviewer note"
              value={<span className="whitespace-pre-wrap">{request.reviewerNote}</span>}
            />
          ) : null}
          {request.rejectionReason ? (
            <DetailRow
              label="Rejection reason"
              value={
                <span className="whitespace-pre-wrap text-danger">
                  {request.rejectionReason}
                </span>
              }
            />
          ) : null}
          {request.cancellationRequestedAt ? (
            <DetailRow
              label="Cancellation requested"
              value={formatDateTime(request.cancellationRequestedAt, timezone)}
            />
          ) : null}
          {request.cancellationReason ? (
            <DetailRow
              label="Cancellation reason"
              value={<span className="whitespace-pre-wrap">{request.cancellationReason}</span>}
            />
          ) : null}
          {request.cancelledAt ? (
            <DetailRow
              label="Cancelled"
              value={`${formatDateTime(request.cancelledAt, timezone)}${
                request.cancelledBy ? ` · ${request.cancelledBy.name}` : ""
              }`}
            />
          ) : null}
        </dl>

        {request.status === "CANCELLATION_REQUESTED" ? (
          <Alert tone="warning">
            Cancellation is waiting for a reviewer. The leave remains approved and its balance
            stays consumed until the cancellation is finalized.
          </Alert>
        ) : null}

        {approvedBlocked ? (
          <Alert tone="info">
            This leave type does not allow cancellation after approval.
          </Alert>
        ) : null}

        {approvedCancellable && requiresApproval ? (
          <Alert tone="info">
            This cancellation requires reviewer approval. The leave remains approved until it
            is finalized.
          </Alert>
        ) : null}

        {cancellationRulesUnavailable ? (
          typesLoading ? (
            <Alert tone="info">Checking cancellation rules…</Alert>
          ) : typesError ? (
            <Alert tone="warning">
              Cancellation rules could not be loaded. Refresh before cancelling approved leave.
            </Alert>
          ) : (
            <Alert tone="info">
              This leave type is no longer in the active catalog, so approved cancellation is
              unavailable here.
            </Alert>
          )
        ) : null}
      </div>
    </Modal>
  );
}

function CancelLeaveModal({
  organizationId,
  target,
  onClose,
  onCancelled,
}: {
  organizationId: string;
  target: CancelTarget;
  onClose: () => void;
  onCancelled: (message: string) => void;
}) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  async function confirm() {
    if (busyRef.current) return;
    setError(null);

    const trimmed = reason.trim();
    if (trimmed.length > 0 && trimmed.length < 3) {
      setError("Enter at least 3 characters or leave the reason blank.");
      return;
    }
    if (trimmed.length > 2000) {
      setError("The reason must be 2000 characters or fewer.");
      return;
    }

    busyRef.current = true;
    setBusy(true);
    try {
      await cancelLeaveRequest(
        organizationId,
        target.request.id,
        trimmed ? { reason: trimmed } : {},
      );
      onCancelled(
        target.requiresApproval
          ? "Cancellation request submitted for review."
          : "Leave request cancelled.",
      );
    } catch (caught) {
      setError(leaveErrorMessage(caught));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  return (
    <ConfirmDialog
      open
      title={target.requiresApproval ? "Request cancellation?" : "Cancel this leave request?"}
      description={`${target.request.leaveType?.name ?? "Leave"} · ${formatDateRange(
        target.request.startDate,
        target.request.endDate,
      )}`}
      confirmLabel={target.requiresApproval ? "Request cancellation" : "Cancel leave"}
      tone="danger"
      busy={busy}
      error={error}
      onConfirm={confirm}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <p className="text-xs leading-5 text-ink-secondary">
        {target.requiresApproval
          ? "A reviewer must approve this cancellation. The leave remains approved until then."
          : target.request.status === "PENDING"
            ? "The reserved days will be released back to your available balance."
            : "The approved days will be restored to your available balance."}
      </p>
      <Field
        label="Reason (optional)"
        htmlFor="leave-cancel-reason"
        hint="Shared with a reviewer if the cancellation needs approval."
      >
        <Textarea
          id="leave-cancel-reason"
          value={reason}
          maxLength={2000}
          onChange={(event) => {
            setError(null);
            setReason(event.target.value);
          }}
          placeholder="For example: plans changed."
          data-autofocus
        />
      </Field>
    </ConfirmDialog>
  );
}
