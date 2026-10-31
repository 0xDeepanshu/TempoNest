"use client";

import { useState } from "react";
import { apiRequest } from "@/lib/api-client";
import {
  formatDateTime,
  formatDuration,
  formatTimeRange,
} from "@/lib/format";
import type { AttendanceCorrection, CorrectionStatus, CorrectionsListResponse } from "@/lib/types";
import { useApi } from "@/lib/use-api";
import { EditIcon } from "./icons";
import {
  Card,
  CardHeader,
  CorrectionStatusBadge,
  EmptyState,
  ErrorState,
  Pagination,
  Tabs,
} from "./ui";

type StatusFilter = "ALL" | CorrectionStatus;

function CorrectionCard({
  correction,
  timezone,
  showEmployee,
}: {
  correction: AttendanceCorrection;
  timezone: string;
  showEmployee?: boolean;
}) {
  const original = correction.original;
  return (
    <article className="rounded-xl border border-line p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[13px] font-semibold text-ink">{correction.workDate}</p>
            <CorrectionStatusBadge status={correction.status} />
            {correction.requestType === "CREATE_SESSION" ? (
              <span className="text-[11px] font-medium text-muted">Missing session</span>
            ) : null}
          </div>
          {showEmployee && correction.employee ? (
            <p className="mt-0.5 text-xs text-muted">
              {correction.employee.name} · {correction.employee.email}
            </p>
          ) : null}
        </div>
        <p className="text-[11px] text-muted">
          Submitted {formatDateTime(correction.createdAt, timezone)}
        </p>
      </div>

      <div className="mt-3 grid gap-3 text-xs sm:grid-cols-3">
        <div>
          <p className="text-muted">Requested interval</p>
          <p className="mt-0.5 font-medium tnum text-ink-secondary">
            {formatTimeRange(correction.requestedStartedAt, correction.requestedEndedAt, timezone)}
          </p>
        </div>
        <div>
          <p className="text-muted">Breaks</p>
          <p className="mt-0.5 font-medium tnum text-ink-secondary">
            {correction.requestedBreaks.length} · {formatDuration(correction.requestedBreakSeconds)}
          </p>
        </div>
        <div>
          <p className="text-muted">Correction ID</p>
          <p className="mt-0.5 truncate font-mono text-[10px] text-muted">{correction.id}</p>
        </div>
      </div>

      <p className="mt-3 rounded-lg border border-line bg-surface-muted px-3 py-2 text-xs leading-5 text-ink-secondary">
        <span className="font-medium text-ink">Reason: </span>
        {correction.reason}
      </p>

      {correction.reviewedAt || correction.rejectionReason || correction.reviewerNote ? (
        <div className="mt-3 rounded-lg border border-line px-3 py-2 text-xs leading-5">
          <p className="font-medium text-ink">
            Review · {formatDateTime(correction.reviewedAt, timezone)}
            {correction.reviewer ? ` by ${correction.reviewer.name}` : ""}
          </p>
          {correction.rejectionReason ? (
            <p className="mt-1 text-danger">Rejection reason: {correction.rejectionReason}</p>
          ) : null}
          {correction.reviewerNote ? (
            <p className="mt-1 text-ink-secondary">Note: {correction.reviewerNote}</p>
          ) : null}
        </div>
      ) : null}

      {original || correction.requestedBreaks.length > 0 ? (
        <details className="mt-3 text-xs">
          <summary className="cursor-pointer font-medium text-ink underline decoration-line-strong underline-offset-4">
            Snapshot and break detail
          </summary>
          <div className="mt-2 space-y-2 rounded-lg border border-line bg-surface-muted p-3 text-ink-secondary">
            {original ? (
              <p>
                <span className="font-medium text-ink">Original: </span>
                {formatTimeRange(original.startedAt, original.endedAt, timezone)} ·{" "}
                {original.breaks.length} break{original.breaks.length === 1 ? "" : "s"}
              </p>
            ) : (
              <p>No original session existed for this request.</p>
            )}
            {correction.requestedBreaks.map((brk, index) => (
              <p key={`${brk.startedAt}-${index}`}>
                Break {index + 1}: {formatTimeRange(brk.startedAt, brk.endedAt, timezone)} ·{" "}
                {formatDuration(brk.durationSeconds)}
              </p>
            ))}
          </div>
        </details>
      ) : null}
    </article>
  );
}

export function CorrectionHistory({
  organizationId,
  timezone,
  refreshToken = 0,
  showEmployee = false,
  initialStatus = "ALL",
  employeeId,
  enabled = true,
}: {
  organizationId: string;
  timezone: string;
  refreshToken?: number;
  showEmployee?: boolean;
  initialStatus?: StatusFilter;
  employeeId?: string;
  enabled?: boolean;
}) {
  const [status, setStatus] = useState<StatusFilter>(initialStatus);
  const [page, setPage] = useState(1);

  const history = useApi<CorrectionsListResponse>(
    (signal) =>
      apiRequest(`/organizations/${organizationId}/attendance/corrections`, {
        signal,
        query: {
          status: status === "ALL" ? undefined : status,
          employeeId,
          page,
          limit: 10,
        },
      }),
    [organizationId, status, page, refreshToken, employeeId],
    { enabled: Boolean(organizationId) && enabled },
  );

  const corrections = history.data?.data ?? [];

  return (
    <Card>
      <CardHeader
        title="Correction history"
        description="Submitted requests retain the original attendance snapshot and reviewer decision."
        actions={
          <Tabs
            value={status}
            onChange={(value) => {
              setStatus(value);
              setPage(1);
            }}
            tabs={[
              { value: "ALL", label: "All" },
              { value: "PENDING", label: "Pending" },
              { value: "APPROVED", label: "Approved" },
              { value: "REJECTED", label: "Rejected" },
            ]}
          />
        }
      />
      {history.error ? (
        <div className="p-4">
          <ErrorState message={history.error} onRetry={history.reload} />
        </div>
      ) : corrections.length === 0 && !history.loading ? (
        <EmptyState
          title={status === "ALL" ? "No correction requests yet" : `No ${status.toLowerCase()} requests`}
          description="Submitted correction requests will appear here with their review outcome."
          icon={<EditIcon className="h-5 w-5" />}
        />
      ) : (
        <div className="space-y-3 p-4">
          {corrections.map((correction) => (
            <CorrectionCard
              key={correction.id}
              correction={correction}
              timezone={timezone}
              showEmployee={showEmployee}
            />
          ))}
        </div>
      )}
      <Pagination
        page={history.data?.meta.page ?? page}
        totalPages={history.data?.meta.totalPages ?? 1}
        onPageChange={setPage}
      />
    </Card>
  );
}
