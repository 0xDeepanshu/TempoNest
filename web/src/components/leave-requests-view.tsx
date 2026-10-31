"use client";

import { useState } from "react";
import { formatDateRange, formatDateTime, formatDay } from "@/lib/format";
import { hasPermission } from "@/lib/permissions";
import {
  formatLeaveUnits,
  isOwnLeaveRequest,
  leaveStatusLabel,
} from "@/lib/leave";
import {
  approveLeaveRequest,
  cancelLeaveRequest,
  getEmployeeLeaveBalances,
  getLeaveRequest,
  listLeaveRequests,
  listLeaveTypes,
  rejectLeaveRequest,
} from "@/lib/leave-api";
import { leaveErrorMessage } from "@/lib/leave-errors";
import {
  LEAVE_REQUEST_STATUSES,
  type LeaveBalance,
  type LeaveRequest,
  type LeaveRequestStatus,
  type LeaveType,
} from "@/lib/types";
import { useApi } from "@/lib/use-api";
import { SearchIcon } from "./icons";
import { EmployeePicker } from "./employee-picker";
import { LeaveTabs } from "./leave-tabs";
import { Modal } from "./modal";
import {
  Alert,
  Avatar,
  Badge,
  Button,
  Card,
  CardHeader,
  DetailRow,
  EmptyState,
  ErrorState,
  Field,
  Input,
  LoadingBlock,
  PageHeader,
  Pagination,
  Select,
  StatusBadge,
  TableShell,
  Td,
  Textarea,
  Th,
  cn,
} from "./ui";
import { NoOrganization, useWorkspace } from "./workspace";

type Filters = {
  employeeId: string;
  leaveTypeId: string;
  status: LeaveRequestStatus | "";
  from: string;
  to: string;
};

const EMPTY_FILTERS: Filters = {
  employeeId: "",
  leaveTypeId: "",
  status: "",
  from: "",
  to: "",
};

type SelectedRequest = { id: string; request: LeaveRequest };

export function LeaveRequestsView() {
  const { organization, membership, user } = useWorkspace();
  const organizationId = organization?.id ?? "";
  const canManage = hasPermission(membership, "leave:manage");
  const [draft, setDraft] = useState<Filters>(EMPTY_FILTERS);
  const [applied, setApplied] = useState<Filters>(EMPTY_FILTERS);
  const [filterError, setFilterError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<SelectedRequest | null>(null);

  const types = useApi(
    (signal) =>
      listLeaveTypes(organizationId, {
        signal,
        includeInactive: canManage ? true : undefined,
      }),
    [organizationId, canManage],
    { enabled: Boolean(organizationId) },
  );

  const requests = useApi(
    (signal) =>
      listLeaveRequests(
        organizationId,
        {
          page,
          limit: 20,
          employeeId: applied.employeeId || undefined,
          leaveTypeId: applied.leaveTypeId || undefined,
          status: applied.status || undefined,
          from: applied.from || undefined,
          to: applied.to || undefined,
        },
        { signal },
      ),
    [
      organizationId,
      page,
      applied.employeeId,
      applied.leaveTypeId,
      applied.status,
      applied.from,
      applied.to,
    ],
    { enabled: Boolean(organizationId) },
  );

  if (!organization) return <NoOrganization />;

  const rows = requests.data?.data ?? [];
  const typeOptions = types.data?.data ?? [];
  const hasFilters = Boolean(
    applied.employeeId || applied.leaveTypeId || applied.status || applied.from || applied.to,
  );

  function applyFilters(event: React.FormEvent) {
    event.preventDefault();
    setFilterError(null);
    if (draft.from && draft.to && draft.to < draft.from) {
      setFilterError("The end of the date range must be on or after the start.");
      return;
    }
    setApplied({ ...draft });
    setPage(1);
  }

  function clearFilters() {
    setDraft(EMPTY_FILTERS);
    setApplied(EMPTY_FILTERS);
    setFilterError(null);
    setPage(1);
  }

  function openRequest(request: LeaveRequest) {
    setSelected({ id: request.id, request });
  }

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={`${organization.name} · ${organization.timezone}`}
        title="Leave requests"
        description="Review requests across the organization. Open a request to see its calculation, employee remarks, balance impact, and available actions."
      />

      <LeaveTabs current="requests" />

      <Card>
        <form
          onSubmit={applyFilters}
          className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-[minmax(220px,1.2fr)_170px_170px_150px_150px_auto] xl:items-end"
        >
          <Field label="Employee" htmlFor="leave-request-employee">
            <EmployeePicker
              id="leave-request-employee"
              organizationId={organization.id}
              value={draft.employeeId}
              onChange={(employeeId) =>
                setDraft((current) => ({ ...current, employeeId }))
              }
            />
          </Field>
          <Field label="Leave type" htmlFor="leave-request-type">
            <Select
              id="leave-request-type"
              value={draft.leaveTypeId}
              onChange={(event) =>
                setDraft((current) => ({ ...current, leaveTypeId: event.target.value }))
              }
            >
              <option value="">All types</option>
              {typeOptions.map((type) => (
                <option key={type.id} value={type.id}>
                  {type.name}
                  {type.isActive ? "" : " (inactive)"}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Status" htmlFor="leave-request-status">
            <Select
              id="leave-request-status"
              value={draft.status}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  status: event.target.value as Filters["status"],
                }))
              }
            >
              <option value="">All statuses</option>
              {LEAVE_REQUEST_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {leaveStatusLabel(status)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="From" htmlFor="leave-request-from">
            <Input
              id="leave-request-from"
              type="date"
              value={draft.from}
              max={draft.to || undefined}
              onChange={(event) =>
                setDraft((current) => ({ ...current, from: event.target.value }))
              }
            />
          </Field>
          <Field label="To" htmlFor="leave-request-to">
            <Input
              id="leave-request-to"
              type="date"
              value={draft.to}
              min={draft.from || undefined}
              onChange={(event) =>
                setDraft((current) => ({ ...current, to: event.target.value }))
              }
            />
          </Field>
          <div className="flex items-center gap-2">
            <Button type="submit">Apply</Button>
            <Button
              type="button"
              variant="secondary"
              onClick={clearFilters}
              disabled={
                !hasFilters &&
                !draft.employeeId &&
                !draft.leaveTypeId &&
                !draft.status &&
                !draft.from &&
                !draft.to
              }
            >
              Clear
            </Button>
          </div>
          {filterError ? (
            <p className="text-xs font-medium text-danger md:col-span-2 xl:col-span-6" role="alert">
              {filterError}
            </p>
          ) : null}
        </form>
      </Card>

      {requests.error ? (
        <ErrorState message={requests.error} onRetry={requests.reload} />
      ) : null}

      <Card>
        <CardHeader
          title="Requests"
          description={
            requests.data
              ? `${requests.data.meta.total} request${requests.data.meta.total === 1 ? "" : "s"}${hasFilters ? " match these filters" : ""}`
              : "Loading requests…"
          }
          actions={
            hasFilters ? (
              <Button variant="ghost" size="sm" onClick={clearFilters}>
                Clear filters
              </Button>
            ) : undefined
          }
        />

        {requests.loading && !requests.data ? (
          <LoadingBlock label="Loading leave requests" rows={5} />
        ) : rows.length === 0 ? (
          <EmptyState
            title={hasFilters ? "No requests match" : "No leave requests yet"}
            description={
              hasFilters
                ? "Try a different employee, leave type, status, or date range."
                : "Submitted leave requests will appear here for review."
            }
            icon={<SearchIcon className="h-5 w-5" />}
            action={
              hasFilters ? (
                <Button variant="secondary" size="sm" onClick={clearFilters}>
                  Clear filters
                </Button>
              ) : undefined
            }
          />
        ) : (
          <>
            <div className="hidden md:block">
              <RequestTable
                requests={rows}
                timezone={organization.timezone}
                onOpen={openRequest}
              />
            </div>
            <div className="divide-y divide-line md:hidden">
              {rows.map((request) => (
                <RequestCard
                  key={request.id}
                  request={request}
                  timezone={organization.timezone}
                  onOpen={() => openRequest(request)}
                />
              ))}
            </div>
            <Pagination
              page={requests.data?.meta.page ?? page}
              totalPages={requests.data?.meta.totalPages ?? 1}
              onPageChange={setPage}
            />
          </>
        )}
      </Card>

      <RequestDetailModal
        key={selected?.id ?? "closed"}
        organizationId={organization.id}
        timezone={organization.timezone}
        selected={selected}
        leaveTypes={typeOptions}
        currentUserId={user.id}
        canManage={canManage}
        canReview={
          hasPermission(membership, "leave:approve") || hasPermission(membership, "leave:manage")
        }
        onClose={() => setSelected(null)}
        onUpdated={(request) => {
          setSelected({ id: request.id, request });
          requests.reload();
        }}
      />
    </div>
  );
}

function RequestTable({
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
          <Th>Employee</Th>
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
              <div className="flex items-center gap-2.5">
                <Avatar name={request.employee?.name ?? "Unknown"} size="sm" />
                <div className="min-w-0">
                  <p className="truncate font-medium text-ink">
                    {request.employee?.name ?? "Unknown employee"}
                  </p>
                  <p className="truncate text-xs text-muted">
                    {request.employee?.email ?? "—"}
                  </p>
                </div>
              </div>
            </Td>
            <Td>
              <span className="font-medium text-ink">
                {request.leaveType?.name ?? "Leave"}
              </span>
              {request.leaveType ? (
                <div className="mt-1 flex flex-wrap gap-1">
                  <Badge tone={request.leaveType.isPaid ? "success" : "neutral"}>
                    {request.leaveType.isPaid ? "Paid" : "Unpaid"}
                  </Badge>
                  {request.leaveType.requiresBalance ? (
                    <Badge tone="outline">Balance</Badge>
                  ) : null}
                </div>
              ) : null}
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
                Review
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
    <button
      type="button"
      onClick={onOpen}
      className="block w-full px-4 py-3 text-left transition hover:bg-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ink"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <Avatar name={request.employee?.name ?? "Unknown"} size="sm" />
          <div className="min-w-0">
            <p className="truncate text-[13px] font-medium text-ink">
              {request.employee?.name ?? "Unknown employee"}
            </p>
            <p className="truncate text-xs text-muted">
              {request.leaveType?.name ?? "Leave"}
            </p>
          </div>
        </div>
        <StatusBadge status={request.status} />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
        <span>{formatDateRange(request.startDate, request.endDate)}</span>
        <span className="text-ink-secondary">{formatLeaveUnits(request.units)}</span>
        <span>{formatDateTime(request.submittedAt, timezone)}</span>
      </div>
    </button>
  );
}

type ActionMode = "approve" | "reject" | "cancel" | "decline-cancellation";

function RequestDetailModal({
  organizationId,
  timezone,
  selected,
  leaveTypes,
  currentUserId,
  canManage,
  canReview,
  onClose,
  onUpdated,
}: {
  organizationId: string;
  timezone: string;
  selected: SelectedRequest | null;
  leaveTypes: LeaveType[];
  currentUserId: string;
  canManage: boolean;
  canReview: boolean;
  onClose: () => void;
  onUpdated: (request: LeaveRequest) => void;
}) {
  const [updated, setUpdated] = useState<LeaveRequest | null>(null);
  const [actionMode, setActionMode] = useState<ActionMode | null>(null);
  const [note, setNote] = useState("");
  const [reason, setReason] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const detail = useApi(
    (signal) =>
      selected ? getLeaveRequest(organizationId, selected.id, { signal }) : Promise.resolve(null),
    [organizationId, selected?.id],
    { enabled: Boolean(selected?.id) },
  );

  const request = updated ?? detail.data?.data.request ?? selected?.request ?? null;
  const needsBalance = Boolean(
    request?.leaveType?.requiresBalance && request.balancePeriodStart,
  );
  const balanceImpact = useApi(
    (signal) =>
      request && needsBalance && canManage
        ? getEmployeeLeaveBalances(
            organizationId,
            request.employeeId,
            {
              leaveTypeId: request.leaveTypeId,
              periodStart: request.balancePeriodStart ?? undefined,
            },
            { signal },
          )
        : Promise.resolve(null),
    [
      organizationId,
      request?.id,
      request?.employeeId,
      request?.leaveTypeId,
      request?.balancePeriodStart,
      canManage,
      needsBalance,
    ],
    { enabled: Boolean(selected) && needsBalance && canManage },
  );

  if (!request) return null;

  const isOwn = isOwnLeaveRequest(request, currentUserId);
  const balance: LeaveBalance | undefined = balanceImpact.data?.data.balances[0];
  // The request summary omits cancellation policy flags, so read them from the
  // catalog. If the catalog has not loaded, allow the attempt and let the API
  // reject it rather than hiding a valid action.
  const catalogType = leaveTypes.find((type) => type.id === request.leaveTypeId);
  const approvedCancellationBlocked =
    request.status === "APPROVED" && catalogType?.allowApprovedCancellation === false;
  const canCancel =
    request.status === "PENDING" ||
    request.status === "CANCELLATION_REQUESTED" ||
    (request.status === "APPROVED" && !approvedCancellationBlocked);

  function beginAction(mode: ActionMode) {
    setActionMode(mode);
    setNote("");
    setReason("");
    setFormError(null);
    setSuccess(null);
  }

  function cancelAction() {
    if (submitting) return;
    setActionMode(null);
    setNote("");
    setReason("");
    setFormError(null);
  }

  async function submitAction() {
    if (!actionMode || submitting || !request) return;
    setFormError(null);
    setSuccess(null);

    const trimmedReason = reason.trim();
    if (
      (actionMode === "reject" || actionMode === "decline-cancellation") &&
      trimmedReason.length < 3
    ) {
      setFormError("Enter a reason with at least 3 characters.");
      return;
    }
    if (actionMode === "cancel" && trimmedReason.length > 0 && trimmedReason.length < 3) {
      setFormError("A cancellation reason must be at least 3 characters, or left blank.");
      return;
    }

    setSubmitting(true);
    try {
      let result;
      if (actionMode === "approve") {
        result = await approveLeaveRequest(organizationId, request.id, {
          note: note.trim() || undefined,
        });
        setSuccess("Leave request approved.");
      } else if (actionMode === "reject") {
        result = await rejectLeaveRequest(organizationId, request.id, {
          reason: trimmedReason,
          note: note.trim() || undefined,
        });
        setSuccess("Leave request rejected.");
      } else if (actionMode === "decline-cancellation") {
        result = await rejectLeaveRequest(organizationId, request.id, {
          reason: trimmedReason,
          note: note.trim() || undefined,
        });
        setSuccess("Cancellation declined. The request remains approved.");
      } else {
        result = await cancelLeaveRequest(organizationId, request.id, {
          reason: trimmedReason || undefined,
        });
        setSuccess("Leave request cancelled.");
      }
      setUpdated(result.data.request);
      setActionMode(null);
      setNote("");
      setReason("");
      onUpdated(result.data.request);
      balanceImpact.reload();
    } catch (error) {
      setFormError(leaveErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      open={Boolean(selected)}
      onClose={onClose}
      title="Leave request"
      description={
        request.employee
          ? `${request.employee.name} · ${request.leaveType?.name ?? "Leave"}`
          : (request.leaveType?.name ?? "Leave")
      }
      size="lg"
      dismissible={!submitting}
      footer={
        actionMode ? (
          <>
            <Button variant="secondary" onClick={cancelAction} disabled={submitting}>
              Back
            </Button>
            <Button
              variant={actionMode === "approve" ? "primary" : "danger"}
              onClick={submitAction}
              loading={submitting}
            >
              {actionMode === "approve"
                ? "Approve request"
                : actionMode === "reject"
                  ? "Reject request"
                  : actionMode === "decline-cancellation"
                    ? "Decline cancellation"
                    : "Cancel leave"}
            </Button>
          </>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose}>
              Close
            </Button>
            {canReview && request.status === "PENDING" && !isOwn ? (
              <>
                {canCancel ? (
                  <Button variant="subtle" onClick={() => beginAction("cancel")}>
                    Cancel leave
                  </Button>
                ) : null}
                <Button variant="danger" onClick={() => beginAction("reject")}>
                  Reject
                </Button>
                <Button onClick={() => beginAction("approve")}>Approve</Button>
              </>
            ) : null}
            {canReview && request.status === "CANCELLATION_REQUESTED" ? (
              <>
                <Button variant="secondary" onClick={() => beginAction("cancel")}>
                  Confirm cancellation
                </Button>
                {!isOwn ? (
                  <Button variant="danger" onClick={() => beginAction("decline-cancellation")}>
                    Decline cancellation
                  </Button>
                ) : null}
              </>
            ) : null}
            {canReview &&
            request.status === "APPROVED" &&
            !approvedCancellationBlocked ? (
              <Button variant="danger" onClick={() => beginAction("cancel")}>
                Cancel approved leave
              </Button>
            ) : null}
            {canReview && request.status === "PENDING" && isOwn && canCancel ? (
              <Button variant="secondary" onClick={() => beginAction("cancel")}>
                Cancel my request
              </Button>
            ) : null}
          </>
        )
      }
    >
      <div className="space-y-4">
        {success ? <Alert tone="success">{success}</Alert> : null}
        {detail.error && !updated ? (
          <ErrorState message={detail.error} onRetry={detail.reload} />
        ) : null}
        {formError ? <Alert tone="danger">{formError}</Alert> : null}

        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={request.status} />
          {request.leaveType ? (
            <>
              <Badge tone={request.leaveType.isPaid ? "success" : "neutral"}>
                {request.leaveType.isPaid ? "Paid leave" : "Unpaid leave"}
              </Badge>
              <Badge tone="outline">
                {request.leaveType.requiresBalance
                  ? "Balance required"
                  : "No balance required"}
              </Badge>
            </>
          ) : null}
          <Badge tone="info">{formatLeaveUnits(request.units)}</Badge>
        </div>

        {canReview && request.status === "PENDING" && isOwn ? (
          <Alert tone="info">
            You cannot approve or reject your own leave request. Another administrator must
            review it.
          </Alert>
        ) : null}

        {approvedCancellationBlocked ? (
          <Alert tone="info">
            This leave type does not allow approved leave to be cancelled.
          </Alert>
        ) : null}

        <section aria-labelledby="leave-request-details">
          <h3
            id="leave-request-details"
            className="mb-1 text-[11px] font-semibold uppercase tracking-[0.1em] text-muted"
          >
            Request
          </h3>
          <dl>
            <DetailRow
              label="Employee"
              value={
                <span className="flex items-center gap-2">
                  <Avatar name={request.employee?.name ?? "Unknown"} size="sm" />
                  <span className="min-w-0">
                    <span className="block truncate">
                      {request.employee?.name ?? "Unknown employee"}
                    </span>
                    <span className="block truncate text-xs font-normal text-muted">
                      {request.employee?.email ?? "—"}
                    </span>
                  </span>
                </span>
              }
            />
            <DetailRow
              label="Dates"
              value={
                <span>
                  {formatDay(request.startDate)}
                  {request.startHalfDay ? " (half day)" : ""} –{" "}
                  {formatDay(request.endDate)}
                  {request.endHalfDay ? " (half day)" : ""}
                </span>
              }
            />
            <DetailRow
              label="Calculated leave"
              value={formatLeaveUnits(request.units)}
            />
            <DetailRow
              label="Charged dates"
              value={
                request.chargedDates.length > 0
                  ? request.chargedDates
                      .map(
                        (day) =>
                          `${formatDay(day.date)} (${formatLeaveUnits(day.units, false)})`,
                      )
                      .join(", ")
                  : "—"
              }
            />
            <DetailRow
              label="Balance period"
              value={request.balancePeriodStart ?? "Not balance-based"}
            />
            <DetailRow
              label="Employee remarks"
              value={<span className="whitespace-pre-wrap font-normal">{request.reason}</span>}
            />
            <DetailRow
              label="Documentation"
              value={<span className="font-normal">{request.documentationReference ?? "—"}</span>}
            />
            <DetailRow
              label="Submitted"
              value={formatDateTime(request.submittedAt, timezone)}
            />
          </dl>
        </section>

        {request.reviewedAt || request.reviewerNote || request.rejectionReason ? (
          <section aria-labelledby="leave-request-review">
            <h3
              id="leave-request-review"
              className="mb-1 text-[11px] font-semibold uppercase tracking-[0.1em] text-muted"
            >
              Review
            </h3>
            <dl>
              <DetailRow
                label="Reviewer"
                value={request.reviewer?.name ?? request.reviewedByUserId ?? "—"}
              />
              <DetailRow
                label="Reviewed"
                value={formatDateTime(request.reviewedAt, timezone)}
              />
              <DetailRow
                label="Reviewer note"
                value={<span className="whitespace-pre-wrap font-normal">{request.reviewerNote ?? "—"}</span>}
              />
              <DetailRow
                label="Rejection reason"
                value={<span className="whitespace-pre-wrap font-normal">{request.rejectionReason ?? "—"}</span>}
              />
            </dl>
          </section>
        ) : null}

        {request.cancellationRequestedAt ||
        request.cancelledAt ||
        request.cancellationReason ? (
          <section aria-labelledby="leave-request-cancellation">
            <h3
              id="leave-request-cancellation"
              className="mb-1 text-[11px] font-semibold uppercase tracking-[0.1em] text-muted"
            >
              Cancellation
            </h3>
            <dl>
              <DetailRow
                label="Cancellation requested"
                value={formatDateTime(request.cancellationRequestedAt, timezone)}
              />
              <DetailRow
                label="Cancelled"
                value={formatDateTime(request.cancelledAt, timezone)}
              />
              <DetailRow
                label="Cancelled by"
                value={request.cancelledBy?.name ?? "—"}
              />
              <DetailRow
                label="Cancellation reason"
                value={<span className="whitespace-pre-wrap font-normal">{request.cancellationReason ?? "—"}</span>}
              />
            </dl>
          </section>
        ) : null}

        {request.leaveType?.requiresBalance ? (
          <section aria-labelledby="leave-request-balance">
            <h3
              id="leave-request-balance"
              className="mb-1 text-[11px] font-semibold uppercase tracking-[0.1em] text-muted"
            >
              Balance impact
            </h3>
            {!canManage ? (
              <p className="text-xs leading-5 text-muted">
                Viewing another employee&apos;s balance requires <code>leave:manage</code>.
              </p>
            ) : balanceImpact.loading && !balance ? (
              <p className="flex items-center gap-2 text-xs text-muted">
                Loading balance…
              </p>
            ) : balanceImpact.error ? (
              <div className="flex items-center gap-2 text-xs text-danger" role="alert">
                <span>{balanceImpact.error}</span>
                <button
                  type="button"
                  onClick={balanceImpact.reload}
                  className="font-medium underline underline-offset-2"
                >
                  Retry
                </button>
              </div>
            ) : balance ? (
              <div className="grid gap-2 sm:grid-cols-2">
                <BalanceFigure
                  label="Available balance"
                  value={balance.availableBalance}
                  hint="After this request's reservation"
                />
                <BalanceFigure
                  label="Pending approval"
                  value={balance.pendingReserved}
                  hint="Reserved by pending requests, including this one when pending"
                />
                <BalanceFigure
                  label="Approved consumed"
                  value={balance.approvedConsumed}
                  hint={`Period ${balance.periodStart} – ${balance.periodEnd}`}
                />
                <BalanceFigure
                  label="Entitled + accrued"
                  value={
                    balance.entitledBalance +
                    balance.accruedBalance +
                    balance.carriedForwardBalance +
                    balance.adjustmentBalance
                  }
                  hint="Before consumed and pending amounts"
                />
              </div>
            ) : (
              <p className="text-xs leading-5 text-muted">
                No balance record is available for this employee, leave type, and period.
              </p>
            )}
          </section>
        ) : null}

        {actionMode ? (
          <section
            aria-labelledby="leave-request-action"
            className="rounded-lg border border-line bg-surface-muted p-3.5"
          >
            <h3 id="leave-request-action" className="text-[13px] font-semibold text-ink">
              {actionMode === "approve"
                ? "Approve request"
                : actionMode === "reject"
                  ? "Reject request"
                  : actionMode === "decline-cancellation"
                    ? "Decline cancellation"
                    : "Cancel leave request"}
            </h3>
            <p className="mt-0.5 text-xs leading-5 text-muted">
              {actionMode === "approve"
                ? "Optionally add a note for the employee. Balance reservations become consumed on approval."
                : actionMode === "reject"
                  ? "Explain why this request is being rejected. Pending balance is released."
                  : actionMode === "decline-cancellation"
                    ? "Explain why the cancellation is declined. The request returns to approved."
                    : "Optionally add a reason. Cancelling approved leave restores consumed balance when the type allows it."}
            </p>
            <div className="mt-3 space-y-3">
              {actionMode === "reject" || actionMode === "decline-cancellation" ? (
                <Field
                  label="Reason"
                  htmlFor="leave-action-reason"
                  required
                  hint="At least 3 characters. Shown to the employee."
                >
                  <Textarea
                    id="leave-action-reason"
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    maxLength={2000}
                    data-autofocus
                  />
                </Field>
              ) : actionMode === "cancel" ? (
                <Field
                  label="Cancellation reason"
                  htmlFor="leave-action-reason"
                  hint="Optional, but at least 3 characters if provided."
                >
                  <Textarea
                    id="leave-action-reason"
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    maxLength={2000}
                  />
                </Field>
              ) : null}
              <Field
                label="Reviewer note"
                htmlFor="leave-action-note"
                hint="Optional internal note stored with the request."
              >
                <Textarea
                  id="leave-action-note"
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  maxLength={2000}
                  data-autofocus={actionMode === "approve" ? true : undefined}
                />
              </Field>
            </div>
          </section>
        ) : null}
      </div>
    </Modal>
  );
}

function BalanceFigure({
  label,
  value,
  hint,
}: {
  label: string;
  value: number;
  hint: string;
}) {
  return (
    <div className={cn("rounded-lg border border-line bg-surface px-3 py-2")}>
      <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
        {label}
      </p>
      <p className="mt-0.5 text-sm font-semibold text-ink tnum">
        {formatLeaveUnits(value)}
      </p>
      <p className="mt-0.5 text-[11px] leading-4 text-muted">{hint}</p>
    </div>
  );
}
