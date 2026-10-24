"use client";

import { useState } from "react";
import { apiRequest } from "@/lib/api-client";
import { errorMessage } from "@/lib/api-error";
import {
  formatDateTime,
  formatDuration,
  formatTimeRange,
} from "@/lib/format";
import type {
  AttendanceCorrection,
  CorrectionStatus,
  CorrectionsListResponse,
  MemberListItem,
  Paginated,
} from "@/lib/types";
import { useApi } from "@/lib/use-api";
import { CheckSquareIcon, ClockIcon } from "./icons";
import {
  Alert,
  Button,
  Card,
  CardBody,
  CardHeader,
  CorrectionStatusBadge,
  EmptyState,
  ErrorState,
  Field,
  Input,
  PageHeader,
  Pagination,
  Select,
  Tabs,
  Textarea,
} from "./ui";
import { NoOrganization, useWorkspace } from "./workspace";

type StatusFilter = "ALL" | CorrectionStatus;
type ReviewAction = "approve" | "reject";

interface PendingAction {
  correctionId: string;
  type: ReviewAction;
}

export function CorrectionReviewCard({
  correction,
  timezone,
  currentUserId,
  busy,
  action,
  note,
  rejectReason,
  actionError,
  onOpen,
  onClose,
  onSubmit,
  onNoteChange,
  onRejectReasonChange,
}: {
  correction: AttendanceCorrection;
  timezone: string;
  currentUserId: string;
  busy: boolean;
  action: PendingAction | null;
  note: string;
  rejectReason: string;
  actionError: string | null;
  onOpen: (type: ReviewAction) => void;
  onClose: () => void;
  onSubmit: () => void;
  onNoteChange: (value: string) => void;
  onRejectReasonChange: (value: string) => void;
}) {
  const isOwnRequest = correction.employeeId === currentUserId;
  const isPending = correction.status === "PENDING";
  const activeAction = action?.correctionId === correction.id ? action.type : null;

  return (
    <article className="rounded-xl border border-slate-200 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-slate-900">{correction.workDate}</p>
            <CorrectionStatusBadge status={correction.status} />
            <span className="text-[11px] font-medium text-slate-400">
              {correction.requestType === "CREATE_SESSION" ? "Missing session" : "Existing session"}
            </span>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            {correction.employee?.name ?? correction.employeeId}
            {correction.employee?.email ? ` · ${correction.employee.email}` : ""}
          </p>
        </div>
        <p className="text-[11px] text-slate-400">
          Submitted {formatDateTime(correction.createdAt, timezone)}
        </p>
      </div>

      <div className="mt-3 grid gap-3 text-xs sm:grid-cols-3">
        <div>
          <p className="text-slate-400">Requested interval</p>
          <p className="mt-0.5 font-medium text-slate-700">
            {formatTimeRange(
              correction.requestedStartedAt,
              correction.requestedEndedAt,
              timezone,
            )}
          </p>
          <p className="text-slate-400">
            {formatDateTime(correction.requestedStartedAt, timezone)} –{" "}
            {formatDateTime(correction.requestedEndedAt, timezone)}
          </p>
        </div>
        <div>
          <p className="text-slate-400">Breaks</p>
          <p className="mt-0.5 font-medium text-slate-700">
            {correction.requestedBreaks.length} ·{" "}
            {formatDuration(correction.requestedBreakSeconds)}
          </p>
        </div>
        <div>
          <p className="text-slate-400">Correction ID</p>
          <p className="mt-0.5 truncate font-mono text-[10px] text-slate-500">
            {correction.id}
          </p>
        </div>
      </div>

      <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-600">
        <span className="font-semibold text-slate-700">Reason: </span>
        {correction.reason}
      </p>

      <details className="mt-3 text-xs">
        <summary className="cursor-pointer font-semibold text-indigo-600">
          Original snapshot and requested breaks
        </summary>
        <div className="mt-2 space-y-2 rounded-lg border border-slate-100 bg-slate-50 p-3 text-slate-600">
          {correction.original ? (
            <p>
              <span className="font-medium text-slate-700">Original: </span>
              {formatTimeRange(
                correction.original.startedAt,
                correction.original.endedAt,
                timezone,
              )}{" "}
              · {correction.original.breaks.length} break
              {correction.original.breaks.length === 1 ? "" : "s"}
            </p>
          ) : (
            <p>No original session existed for this request.</p>
          )}
          {correction.requestedBreaks.length === 0 ? (
            <p>No breaks requested.</p>
          ) : (
            correction.requestedBreaks.map((brk, index) => (
              <p key={`${brk.startedAt}-${index}`}>
                Break {index + 1}:{" "}
                {formatTimeRange(brk.startedAt, brk.endedAt, timezone)} ·{" "}
                {formatDuration(brk.durationSeconds)}
              </p>
            ))
          )}
        </div>
      </details>

      {correction.reviewedAt || correction.rejectionReason || correction.reviewerNote ? (
        <div className="mt-3 rounded-lg border border-slate-200 px-3 py-2 text-xs leading-5">
          <p className="font-semibold text-slate-700">
            Review · {formatDateTime(correction.reviewedAt, timezone)}
            {correction.reviewer ? ` by ${correction.reviewer.name}` : ""}
          </p>
          {correction.rejectionReason ? (
            <p className="mt-1 text-rose-700">
              Rejection reason: {correction.rejectionReason}
            </p>
          ) : null}
          {correction.reviewerNote ? (
            <p className="mt-1 text-slate-600">Note: {correction.reviewerNote}</p>
          ) : null}
        </div>
      ) : null}

      {isPending ? (
        <div className="mt-4 border-t border-slate-100 pt-3">
          {isOwnRequest ? (
            <p className="text-xs leading-5 text-amber-700">
              You cannot review your own correction request. Another reviewer must
              approve or reject it.
            </p>
          ) : activeAction ? (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-semibold text-slate-700">
                  {activeAction === "approve" ? "Approve correction" : "Reject correction"}
                </p>
                <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
                  Cancel
                </Button>
              </div>
              {actionError ? <Alert tone="danger">{actionError}</Alert> : null}
              {activeAction === "reject" ? (
                <Field
                  label="Rejection reason"
                  htmlFor={`reject-reason-${correction.id}`}
                  hint="Required, at least 3 characters. This is shown to the employee."
                  required
                >
                  <Textarea
                    id={`reject-reason-${correction.id}`}
                    value={rejectReason}
                    maxLength={2000}
                    onChange={(event) => onRejectReasonChange(event.target.value)}
                  />
                </Field>
              ) : null}
              <Field
                label="Reviewer note"
                htmlFor={`review-note-${correction.id}`}
                hint="Optional. Included in the correction history."
              >
                <Textarea
                  id={`review-note-${correction.id}`}
                  value={note}
                  maxLength={2000}
                  onChange={(event) => onNoteChange(event.target.value)}
                />
              </Field>
              <Button
                size="sm"
                variant={activeAction === "approve" ? "primary" : "danger"}
                loading={busy}
                onClick={onSubmit}
              >
                {activeAction === "approve" ? "Confirm approval" : "Confirm rejection"}
              </Button>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => onOpen("approve")}>
                Approve
              </Button>
              <Button size="sm" variant="danger" onClick={() => onOpen("reject")}>
                Reject
              </Button>
            </div>
          )}
        </div>
      ) : null}
    </article>
  );
}

export function CorrectionReviewView() {
  const { organization, user } = useWorkspace();
  const organizationId = organization?.id ?? "";
  const timezone = organization?.timezone ?? "UTC";

  const [status, setStatus] = useState<StatusFilter>("PENDING");
  const [employeeId, setEmployeeId] = useState("");
  const [draftFrom, setDraftFrom] = useState("");
  const [draftTo, setDraftTo] = useState("");
  const [range, setRange] = useState({ from: "", to: "" });
  const [rangeError, setRangeError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [refreshToken, setRefreshToken] = useState(0);
  const [action, setAction] = useState<PendingAction | null>(null);
  const [note, setNote] = useState("");
  const [rejectReason, setRejectReason] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);

  const members = useApi<Paginated<MemberListItem>>(
    (signal) =>
      apiRequest(`/organizations/${organizationId}/members`, {
        signal,
        query: { limit: 100, status: "ACTIVE" },
      }),
    [organizationId],
    { enabled: Boolean(organizationId) },
  );

  const corrections = useApi<CorrectionsListResponse>(
    (signal) =>
      apiRequest(`/organizations/${organizationId}/attendance/corrections`, {
        signal,
        query: {
          status: status === "ALL" ? undefined : status,
          employeeId: employeeId || undefined,
          from: range.from || undefined,
          to: range.to || undefined,
          page,
          limit: 10,
        },
      }),
    [organizationId, status, employeeId, range.from, range.to, page, refreshToken],
    { enabled: Boolean(organizationId) },
  );

  if (!organization) return <NoOrganization />;

  const rows = corrections.data?.data ?? [];

  function resetAction() {
    setAction(null);
    setNote("");
    setRejectReason("");
    setActionError(null);
  }

  function openAction(correctionId: string, type: ReviewAction) {
    setAction({ correctionId, type });
    setNote("");
    setRejectReason("");
    setActionError(null);
    setSuccess(null);
  }

  function applyRange() {
    setRangeError(null);
    if (draftFrom && draftTo && draftTo < draftFrom) {
      setRangeError("The end date must be on or after the start date.");
      return;
    }
    setRange({ from: draftFrom, to: draftTo });
    setPage(1);
  }

  function clearFilters() {
    setEmployeeId("");
    setDraftFrom("");
    setDraftTo("");
    setRange({ from: "", to: "" });
    setPage(1);
    setRangeError(null);
  }

  async function submitAction() {
    if (!action) return;
    setActionError(null);
    const isReject = action.type === "reject";
    if (isReject && rejectReason.trim().length < 3) {
      setActionError("Enter a rejection reason with at least 3 characters.");
      return;
    }

    const trimmedNote = note.trim();
    const body = isReject
      ? {
          reason: rejectReason.trim(),
          ...(trimmedNote ? { note: trimmedNote } : {}),
        }
      : trimmedNote
        ? { note: trimmedNote }
        : {};

    setActionLoading(true);
    try {
      await apiRequest(
        `/organizations/${organizationId}/attendance/corrections/${action.correctionId}/${action.type}`,
        { method: "POST", body },
      );
      setSuccess(
        isReject ? "Correction rejected." : "Correction approved and attendance updated.",
      );
      resetAction();
      setRefreshToken((value) => value + 1);
    } catch (caught) {
      setActionError(errorMessage(caught));
    } finally {
      setActionLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={`${organization.name} · review queue`}
        title="Correction review"
        description="Review the stored original snapshot and requested replacement before approving or rejecting. You cannot review your own request."
        actions={
          <Button variant="secondary" onClick={() => corrections.reload()}>
            Refresh
          </Button>
        }
      />

      <Card>
        <CardHeader
          title="Filters"
          description="Filter by status, employee, and the correction's organization-local work date."
        />
        <CardBody className="space-y-4">
          <Tabs
            value={status}
            onChange={(value) => {
              setStatus(value);
              setPage(1);
              resetAction();
            }}
            tabs={[
              { value: "PENDING", label: "Pending" },
              { value: "APPROVED", label: "Approved" },
              { value: "REJECTED", label: "Rejected" },
              { value: "ALL", label: "All" },
            ]}
          />
          <div className="grid gap-3 lg:grid-cols-[1.2fr_1fr_1fr_auto] lg:items-end">
            <Field label="Employee" htmlFor="review-employee">
              <Select
                id="review-employee"
                value={employeeId}
                onChange={(event) => {
                  setEmployeeId(event.target.value);
                  setPage(1);
                }}
                disabled={members.loading}
              >
                <option value="">All employees</option>
                {(members.data?.data ?? []).map((member) => (
                  <option key={member.userId} value={member.userId}>
                    {member.user.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Work date from" htmlFor="review-from">
              <Input
                id="review-from"
                type="date"
                value={draftFrom}
                max={draftTo || undefined}
                onChange={(event) => setDraftFrom(event.target.value)}
              />
            </Field>
            <Field label="Work date to" htmlFor="review-to">
              <Input
                id="review-to"
                type="date"
                value={draftTo}
                min={draftFrom || undefined}
                onChange={(event) => setDraftTo(event.target.value)}
              />
            </Field>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={applyRange}>
                Apply
              </Button>
              <Button variant="ghost" onClick={clearFilters}>
                Clear
              </Button>
            </div>
          </div>
          {rangeError ? <Alert tone="danger">{rangeError}</Alert> : null}
          {members.error ? (
            <ErrorState message={members.error} onRetry={members.reload} />
          ) : null}
        </CardBody>
      </Card>

      {success ? <Alert tone="success">{success}</Alert> : null}
      {corrections.error ? (
        <ErrorState message={corrections.error} onRetry={corrections.reload} />
      ) : null}

      <Card>
        <CardHeader
          title={status === "ALL" ? "All correction requests" : `${status[0]}${status.slice(1).toLowerCase()} correction requests`}
          description={
            corrections.data
              ? `${corrections.data.meta.total} request${corrections.data.meta.total === 1 ? "" : "s"}`
              : "Loading…"
          }
          actions={
            <span className="flex items-center gap-1.5 text-[11px] text-slate-400">
              <ClockIcon className="h-3.5 w-3.5" />
              {timezone}
            </span>
          }
        />
        {rows.length === 0 && !corrections.loading ? (
          <EmptyState
            title="No correction requests"
            description="Requests matching these filters will appear here."
            icon={<CheckSquareIcon className="h-5 w-5" />}
          />
        ) : (
          <div className="space-y-3 p-5">
            {rows.map((correction) => (
              <CorrectionReviewCard
                key={correction.id}
                correction={correction}
                timezone={timezone}
                currentUserId={user.id}
                busy={actionLoading && action?.correctionId === correction.id}
                action={action}
                note={note}
                rejectReason={rejectReason}
                actionError={
                  action?.correctionId === correction.id ? actionError : null
                }
                onOpen={(type) => openAction(correction.id, type)}
                onClose={resetAction}
                onSubmit={submitAction}
                onNoteChange={setNote}
                onRejectReasonChange={setRejectReason}
              />
            ))}
          </div>
        )}
        <Pagination
          page={corrections.data?.meta.page ?? page}
          totalPages={corrections.data?.meta.totalPages ?? 1}
          onPageChange={(next) => {
            setPage(next);
            resetAction();
          }}
        />
      </Card>
    </div>
  );
}
