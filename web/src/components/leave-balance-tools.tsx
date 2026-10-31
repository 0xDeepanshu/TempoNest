"use client";

import { useId, useState } from "react";
import { formatDateTime, formatDay } from "@/lib/format";
import {
  accrualFrequencyLabel,
  balancePeriodLabel,
  formatLeaveUnits,
  formatSignedLeaveUnits,
} from "@/lib/leave";
import {
  applyLeaveBalanceBackfill,
  bulkAdjustLeaveBalances,
  getLeaveAccrualPreview,
  getLeaveBalanceReconciliation,
  previewBulkLeaveAdjustments,
  previewLeaveBalanceBackfill,
  repairLeaveBalanceReconciliation,
} from "@/lib/leave-api";
import { leaveErrorMessage } from "@/lib/leave-errors";
import type {
  LeaveAccrualPreviewReport,
  LeaveBackfillPreview,
  LeaveBackfillResult,
  LeaveBulkAdjustmentPreview,
  LeaveBulkAdjustmentResult,
  LeaveReconciliationReport,
  LeaveReconciliationRepairResult,
  LeaveType,
  MemberListItem,
} from "@/lib/types";
import { useApi } from "@/lib/use-api";
import { EmployeePicker } from "./employee-picker";
import { Modal } from "./modal";
import {
  Alert,
  Avatar,
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  Field,
  Input,
  LoadingBlock,
  Pagination,
  Select,
  TableShell,
  Td,
  Textarea,
  Th,
  cn,
} from "./ui";

const RECONCILIATION_ISSUES: Record<string, string> = {
  OVERLAPPING_PERIODS: "Overlapping periods",
  MISSING_POLICY: "Missing policy",
  INACTIVE_POLICY: "Inactive policy",
  INACTIVE_EMPLOYEE: "Inactive employee",
  NO_CURRENT_BALANCE: "No current balance",
  PERIOD_END_MISMATCH: "Period end mismatch",
  MISSING_TYPE: "Missing leave type",
};

function issueLabel(issue: string): string {
  return RECONCILIATION_ISSUES[issue] ?? issue;
}

export function AccrualPreviewCard({
  organizationId,
  types,
}: {
  organizationId: string;
  types: LeaveType[];
}) {
  const [draft, setDraft] = useState({ employeeId: "", leaveTypeId: "" });
  const [applied, setApplied] = useState({ employeeId: "", leaveTypeId: "" });
  const [page, setPage] = useState(1);

  const preview = useApi(
    (signal) =>
      getLeaveAccrualPreview(
        organizationId,
        {
          employeeId: applied.employeeId || undefined,
          leaveTypeId: applied.leaveTypeId || undefined,
        },
        { signal },
      ),
    [organizationId, applied.employeeId, applied.leaveTypeId],
  );

  const report: LeaveAccrualPreviewReport | undefined = preview.data?.data;
  const items = report?.items ?? [];
  const pageSize = 20;
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageRows = items.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const hasFilters = Boolean(applied.employeeId || applied.leaveTypeId);

  function applyFilters(event: React.FormEvent) {
    event.preventDefault();
    setApplied({ ...draft });
    setPage(1);
  }

  function clearFilters() {
    setDraft({ employeeId: "", leaveTypeId: "" });
    setApplied({ employeeId: "", leaveTypeId: "" });
    setPage(1);
  }

  return (
    <Card>
      <CardHeader
        title="Next accrual"
        description={
          report
            ? `Preview only · ${report.summary.previews} employee/type combination${report.summary.previews === 1 ? "" : "s"} as of ${formatDay(report.asOf)} (${report.timezone}). No balances are modified.`
            : "Preview the next scheduled tranche and its projected impact. No balances are modified."
        }
      />

      <form
        onSubmit={applyFilters}
        className="grid gap-3 border-b border-line p-4 md:grid-cols-2 xl:grid-cols-[minmax(220px,1.2fr)_220px_auto] xl:items-end"
      >
        <Field label="Employee" htmlFor="accrual-preview-employee">
          <EmployeePicker
            id="accrual-preview-employee"
            organizationId={organizationId}
            value={draft.employeeId}
            onChange={(employeeId) =>
              setDraft((current) => ({ ...current, employeeId }))
            }
          />
        </Field>
        <Field label="Leave type" htmlFor="accrual-preview-type">
          <Select
            id="accrual-preview-type"
            value={draft.leaveTypeId}
            onChange={(event) =>
              setDraft((current) => ({ ...current, leaveTypeId: event.target.value }))
            }
          >
            <option value="">All balance types</option>
            {types.map((type) => (
              <option key={type.id} value={type.id}>
                {type.name}
              </option>
            ))}
          </Select>
        </Field>
        <div className="flex items-center gap-2">
          <Button type="submit">Preview</Button>
          <Button
            type="button"
            variant="secondary"
            onClick={clearFilters}
            disabled={
              !hasFilters && !draft.employeeId && !draft.leaveTypeId
            }
          >
            Clear
          </Button>
        </div>
      </form>

      {preview.error ? (
        <div className="p-4">
          <ErrorState message={preview.error} onRetry={preview.reload} />
        </div>
      ) : preview.loading && !report ? (
        <LoadingBlock label="Loading accrual preview" rows={4} />
      ) : items.length === 0 ? (
        <EmptyState
          title={hasFilters ? "No accrual previews match" : "No upcoming accruals"}
          description={
            hasFilters
              ? "Try a different employee or leave type."
              : "Configure a monthly, quarterly, or annual accrual amount on an active balance-based leave type."
          }
        />
      ) : (
        <>
          {report && report.summary.missingBalances > 0 ? (
            <div className="border-b border-line px-4 py-3">
              <Alert tone="warning">
                {report.summary.missingBalances} employee/type combination
                {report.summary.missingBalances === 1 ? " has" : "s have"} no balance
                for the current period yet. Run the backfill below so accruals and requests
                have a balance to apply to.
              </Alert>
            </div>
          ) : null}
          <div className="hidden md:block">
            <TableShell className="min-w-[880px]">
              <thead>
                <tr>
                  <Th>Employee</Th>
                  <Th>Leave type</Th>
                  <Th>Frequency</Th>
                  <Th>Next accrual</Th>
                  <Th className="text-right">Amount</Th>
                  <Th className="text-right">Current</Th>
                  <Th className="text-right">Projected</Th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((item) => (
                  <tr
                    key={`${item.employee.id}:${item.leaveType.id}`}
                    className="hover:bg-surface-muted"
                  >
                    <Td>
                      <div className="flex items-center gap-2.5">
                        <Avatar name={item.employee.name} size="sm" />
                        <div className="min-w-0">
                          <p className="truncate font-medium text-ink">
                            {item.employee.name}
                          </p>
                          <p className="truncate text-xs text-muted">
                            {item.employee.email || "—"}
                          </p>
                        </div>
                      </div>
                    </Td>
                    <Td>
                      <span className="font-medium text-ink">{item.leaveType.name}</span>
                      {!item.balanceExists ? (
                        <div className="mt-1">
                          <Badge tone="warning">No current balance</Badge>
                        </div>
                      ) : null}
                    </Td>
                    <Td className="text-xs">
                      {accrualFrequencyLabel(item.accrualFrequency)} · day{" "}
                      {item.accrualDayOfMonth}
                    </Td>
                    <Td className="whitespace-nowrap text-xs">
                      {item.nextAccrualDate ? (
                        formatDay(item.nextAccrualDate)
                      ) : (
                        <span className="text-muted">No upcoming tranche</span>
                      )}
                    </Td>
                    <Td className="whitespace-nowrap text-right tnum">
                      {item.nextAccrualDate
                        ? formatSignedLeaveUnits(item.nextAccrualAmount)
                        : "—"}
                    </Td>
                    <Td className="whitespace-nowrap text-right tnum">
                      {formatLeaveUnits(item.currentAvailable)}
                    </Td>
                    <Td className="whitespace-nowrap text-right tnum font-semibold">
                      {item.projectedAvailable === null
                        ? "—"
                        : formatLeaveUnits(item.projectedAvailable)}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </TableShell>
          </div>
          <ul className="divide-y divide-line md:hidden">
            {pageRows.map((item) => (
              <li key={`${item.employee.id}:${item.leaveType.id}`} className="px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-medium text-ink">
                      {item.employee.name}
                    </p>
                    <p className="truncate text-xs text-muted">{item.leaveType.name}</p>
                  </div>
                  <Badge tone="neutral">
                    {accrualFrequencyLabel(item.accrualFrequency)}
                  </Badge>
                </div>
                <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
                  <span>
                    Next:{" "}
                    {item.nextAccrualDate ? formatDay(item.nextAccrualDate) : "none"}
                  </span>
                  <span className="text-ink-secondary">
                    {item.nextAccrualDate
                      ? `${formatSignedLeaveUnits(item.nextAccrualAmount)} days`
                      : "No upcoming tranche"}
                  </span>
                  <span className="tnum">
                    {formatLeaveUnits(item.currentAvailable)} →{" "}
                    {item.projectedAvailable === null
                      ? "—"
                      : formatLeaveUnits(item.projectedAvailable)}
                  </span>
                </div>
              </li>
            ))}
          </ul>
          <Pagination
            page={currentPage}
            totalPages={totalPages}
            onPageChange={setPage}
          />
          {report?.truncated ? (
            <p className="border-t border-line px-4 py-2 text-[11px] text-muted">
              Showing the first {items.length} previews. Filter by employee or leave type to
              narrow the result.
            </p>
          ) : null}
        </>
      )}
    </Card>
  );
}

type AdjustmentDraft = {
  leaveTypeId: string;
  periodStart: string;
  amount: string;
  reason: string;
};

const EMPTY_ADJUSTMENT: AdjustmentDraft = {
  leaveTypeId: "",
  periodStart: "",
  amount: "",
  reason: "",
};

function validateAdjustment(draft: AdjustmentDraft): string | null {
  if (!draft.leaveTypeId) return "Select a leave type.";
  const amount = Number(draft.amount);
  if (!draft.amount.trim() || !Number.isFinite(amount)) {
    return "Enter an amount in days.";
  }
  if (amount === 0) return "The adjustment amount must not be zero.";
  if (Math.abs(amount) > 3650) {
    return "The adjustment must be between -3650 and 3650 days.";
  }
  if (draft.reason.trim().length < 3) {
    return "Enter a reason with at least 3 characters.";
  }
  return null;
}

export function BulkAdjustmentModal({
  organizationId,
  open,
  types,
  onClose,
  onCompleted,
}: {
  organizationId: string;
  open: boolean;
  types: LeaveType[];
  onClose: () => void;
  onCompleted: () => void;
}) {
  const [selected, setSelected] = useState<MemberListItem[]>([]);
  const [pickerValue, setPickerValue] = useState("");
  const [draft, setDraft] = useState<AdjustmentDraft>(EMPTY_ADJUSTMENT);
  const [preview, setPreview] = useState<LeaveBulkAdjustmentPreview | null>(null);
  const [result, setResult] = useState<LeaveBulkAdjustmentResult | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  function update(patch: Partial<AdjustmentDraft>) {
    setDraft((current) => ({ ...current, ...patch }));
    setPreview(null);
    setResult(null);
  }

  function addEmployee(member: MemberListItem) {
    setSelected((current) =>
      current.some((row) => row.userId === member.userId) ? current : [...current, member],
    );
    setPreview(null);
    setResult(null);
    setPickerValue("");
  }

  function removeEmployee(userId: string) {
    setSelected((current) => current.filter((row) => row.userId !== userId));
    setPreview(null);
    setResult(null);
  }

  const payload = {
    employeeIds: selected.map((member) => member.userId),
    leaveTypeId: draft.leaveTypeId,
    periodStart: draft.periodStart || undefined,
    amount: Number(draft.amount),
    reason: draft.reason.trim(),
  };

  function validate(): string | null {
    if (selected.length === 0) return "Select at least one employee.";
    return validateAdjustment(draft);
  }

  async function runPreview() {
    if (previewing || submitting) return;
    const error = validate();
    if (error) {
      setFormError(error);
      return;
    }
    setFormError(null);
    setPreviewing(true);
    try {
      const response = await previewBulkLeaveAdjustments(organizationId, payload);
      setPreview(response.data);
      setResult(null);
    } catch (error) {
      setFormError(leaveErrorMessage(error));
    } finally {
      setPreviewing(false);
    }
  }

  async function confirm() {
    if (submitting || previewing || !preview) return;
    setFormError(null);
    setSubmitting(true);
    try {
      const response = await bulkAdjustLeaveBalances(organizationId, payload);
      setResult(response.data);
      setPreview(null);
      onCompleted();
    } catch (error) {
      setFormError(leaveErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  }

  function reset() {
    setSelected([]);
    setPickerValue("");
    setDraft(EMPTY_ADJUSTMENT);
    setPreview(null);
    setResult(null);
    setFormError(null);
  }

  function nameFor(employeeId: string): string {
    return selected.find((member) => member.userId === employeeId)?.user.name ?? employeeId;
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Bulk balance adjustment"
      description="Credit or debit the same leave type for several employees. Preview every employee first; the server validates caps and negative-balance rules before anything is written."
      size="lg"
      dismissible={!submitting && !previewing}
      footer={
        result ? (
          <>
            <Button variant="secondary" onClick={onClose}>
              Close
            </Button>
            <Button onClick={reset}>New adjustment</Button>
          </>
        ) : (
          <>
            <Button
              variant="secondary"
              onClick={onClose}
              disabled={submitting || previewing}
            >
              Cancel
            </Button>
            <Button
              variant="secondary"
              onClick={runPreview}
              loading={previewing}
              disabled={submitting}
            >
              Preview adjustments
            </Button>
            <Button
              onClick={confirm}
              loading={submitting}
              disabled={
                !preview || preview.summary.previewed === 0 || previewing
              }
            >
              Confirm adjustments
            </Button>
          </>
        )
      }
    >
      <div className="space-y-4">
        {formError ? <Alert tone="danger">{formError}</Alert> : null}
        {result ? (
          <Alert tone={result.summary.failed > 0 ? "warning" : "success"}>
            {result.summary.adjusted} of {result.summary.requested} employees adjusted.
            {result.summary.failed > 0
              ? ` ${result.summary.failed} failed and can be retried individually.`
              : " Every change is recorded in the ledger and audit trail."}
          </Alert>
        ) : null}

        <Field
          label="Employees"
          htmlFor="bulk-adjustment-picker"
          hint="Search the active member directory and add each employee to this batch."
        >
          <EmployeePicker
            id="bulk-adjustment-picker"
            organizationId={organizationId}
            value={pickerValue}
            onChange={setPickerValue}
            onSelect={addEmployee}
            placeholder="Add an employee"
            disabled={Boolean(result) || submitting}
          />
        </Field>

        {selected.length === 0 ? (
          <p className="text-xs text-muted">No employees selected yet.</p>
        ) : (
          <ul className="flex flex-wrap gap-2" aria-label="Selected employees">
            {selected.map((member) => (
              <li
                key={member.userId}
                className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface-muted py-1 pl-2 pr-1 text-xs text-ink"
              >
                <span className="max-w-48 truncate">{member.user.name}</span>
                <button
                  type="button"
                  onClick={() => removeEmployee(member.userId)}
                  disabled={Boolean(result) || submitting}
                  aria-label={`Remove ${member.user.name}`}
                  className="flex h-5 w-5 items-center justify-center rounded-full text-muted transition hover:bg-surface-hover hover:text-ink disabled:opacity-50"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Leave type" htmlFor="bulk-adjustment-type">
            <Select
              id="bulk-adjustment-type"
              value={draft.leaveTypeId}
              onChange={(event) => update({ leaveTypeId: event.target.value })}
              disabled={Boolean(result) || submitting}
            >
              <option value="">Select a balance-based type</option>
              {types.map((type) => (
                <option key={type.id} value={type.id}>
                  {type.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="Period date"
            htmlFor="bulk-adjustment-period"
            hint="Any date inside the target balance period. Empty uses today."
          >
            <Input
              id="bulk-adjustment-period"
              type="date"
              value={draft.periodStart}
              onChange={(event) => update({ periodStart: event.target.value })}
              disabled={Boolean(result) || submitting}
            />
          </Field>
          <Field
            label="Amount (days)"
            htmlFor="bulk-adjustment-amount"
            hint="Positive credits, negative debits."
          >
            <Input
              id="bulk-adjustment-amount"
              type="number"
              inputMode="decimal"
              step="any"
              min={-3650}
              max={3650}
              value={draft.amount}
              onChange={(event) => update({ amount: event.target.value })}
              disabled={Boolean(result) || submitting}
            />
          </Field>
          <Field
            label="Reason"
            htmlFor="bulk-adjustment-reason"
            hint="Required for every employee and stored in the audit trail."
          >
            <Textarea
              id="bulk-adjustment-reason"
              value={draft.reason}
              onChange={(event) => update({ reason: event.target.value })}
              maxLength={500}
              disabled={Boolean(result) || submitting}
              className="min-h-20"
            />
          </Field>
        </div>

        {preview ? (
          <section aria-labelledby="bulk-adjustment-preview" className="space-y-2">
            <h3
              id="bulk-adjustment-preview"
              className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted"
            >
              Preview
            </h3>
            <p className="text-xs text-muted">
              {preview.summary.previewed} ready · {preview.summary.failed} cannot be applied.
              Nothing has been written yet.
            </p>
            <div className="overflow-hidden rounded-lg border border-line">
              <ul className="divide-y divide-line">
                {preview.items.map((item) =>
                  item.ok ? (
                    <li
                      key={item.employeeId}
                      className="flex flex-wrap items-start justify-between gap-2 px-3 py-2 text-xs"
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-medium text-ink">
                          {nameFor(item.employeeId)}
                        </span>
                        <span className="block text-muted">
                          {balancePeriodLabel(
                            item.preview.periodStart,
                            item.preview.periodEnd,
                          )}
                          {item.preview.balanceExists
                            ? ""
                            : " · no balance yet, it will be initialized"}
                        </span>
                      </span>
                      <span className="text-right tnum">
                        <span className="block font-semibold text-ink">
                          {formatLeaveUnits(item.preview.availableBefore)} →{" "}
                          {formatLeaveUnits(item.preview.availableAfter)}
                        </span>
                        <span
                          className={cn(
                            "block",
                            item.preview.amount >= 0 ? "text-success" : "text-danger",
                          )}
                        >
                          {formatSignedLeaveUnits(item.preview.amount)} days
                        </span>
                      </span>
                    </li>
                  ) : (
                    <li
                      key={item.employeeId}
                      className="flex flex-wrap items-start justify-between gap-2 px-3 py-2 text-xs"
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-medium text-ink">
                          {nameFor(item.employeeId)}
                        </span>
                        <span className="block text-danger">{item.message}</span>
                      </span>
                      <Badge tone="danger">{item.code}</Badge>
                    </li>
                  ),
                )}
              </ul>
            </div>
          </section>
        ) : null}

        {result ? (
          <section aria-labelledby="bulk-adjustment-result" className="space-y-2">
            <h3
              id="bulk-adjustment-result"
              className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted"
            >
              Result · batch {result.batchId.slice(0, 8)}
            </h3>
            <div className="overflow-hidden rounded-lg border border-line">
              <ul className="divide-y divide-line">
                {result.items.map((item) =>
                  item.ok ? (
                    <li
                      key={item.employeeId}
                      className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-xs"
                    >
                      <span className="font-medium text-ink">{nameFor(item.employeeId)}</span>
                      <span className="text-muted">
                        {balancePeriodLabel(item.periodStart, item.periodEnd)} ·{" "}
                        <span className="tnum text-ink">
                          {formatLeaveUnits(item.availableBalance)}
                        </span>{" "}
                        available
                      </span>
                    </li>
                  ) : (
                    <li
                      key={item.employeeId}
                      className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-xs"
                    >
                      <span className="font-medium text-ink">{nameFor(item.employeeId)}</span>
                      <span className="text-danger">{item.message}</span>
                    </li>
                  ),
                )}
              </ul>
            </div>
          </section>
        ) : null}

        {!result ? (
          <p className="text-[11px] leading-4 text-muted">
            The confirm step is enabled only after a successful preview. The server applies
            each employee independently and returns a per-employee result.
          </p>
        ) : null}
      </div>
    </Modal>
  );
}

export function BackfillModal({
  organizationId,
  open,
  onClose,
  onCompleted,
}: {
  organizationId: string;
  open: boolean;
  onClose: () => void;
  onCompleted: () => void;
}) {
  const [confirmed, setConfirmed] = useState(false);
  const [applying, setApplying] = useState(false);
  const [result, setResult] = useState<LeaveBackfillResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const acknowledgeId = useId();

  const preview = useApi(
    (signal) =>
      open
        ? previewLeaveBalanceBackfill(organizationId, {}, { signal })
        : Promise.resolve(null),
    [organizationId, open],
    { enabled: open },
  );

  const report: LeaveBackfillPreview | undefined = preview.data?.data;
  const missing = report?.summary.missing ?? 0;

  async function apply() {
    if (!confirmed || applying || missing === 0) return;
    setApplying(true);
    setError(null);
    try {
      const response = await applyLeaveBalanceBackfill(organizationId, {});
      setResult(response.data);
      setConfirmed(false);
      preview.reload();
      onCompleted();
    } catch (caught) {
      setError(leaveErrorMessage(caught));
    } finally {
      setApplying(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Initialize missing balances"
      description="Creates the current balance period for active employees and active balance-based leave types. Existing rows and ledger history are never changed."
      size="lg"
      dismissible={!applying}
      footer={
        result ? (
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose} disabled={applying}>
              Cancel
            </Button>
            <Button
              onClick={apply}
              loading={applying}
              disabled={!confirmed || missing === 0}
            >
              Initialize {missing} balance{missing === 1 ? "" : "s"}
            </Button>
          </>
        )
      }
    >
      <div className="space-y-4">
        {error ? <Alert tone="danger">{error}</Alert> : null}
        {result ? (
          <Alert tone={result.summary.failed > 0 ? "warning" : "success"}>
            {result.summary.initialized} initialized · {result.summary.alreadyPresent}{" "}
            already present · {result.summary.failed} failed across{" "}
            {result.summary.employees} employees.
          </Alert>
        ) : null}

        {preview.error ? (
          <ErrorState message={preview.error} onRetry={preview.reload} />
        ) : preview.loading && !report ? (
          <LoadingBlock label="Planning backfill" rows={4} />
        ) : !report ? null : (
          <>
            <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <SummaryTile label="Candidates" value={report.summary.candidates} />
              <SummaryTile label="Missing" value={report.summary.missing} tone="warning" />
              <SummaryTile label="Already present" value={report.summary.existing} />
              <SummaryTile
                label="Unconfigured types"
                value={report.summary.unconfiguredTypes}
              />
            </dl>

            <p className="text-xs leading-5 text-muted">
              As of {formatDay(report.asOf)} in {report.timezone}. Only the current balance
              period is created; no entitlement is granted before a policy&apos;s effective
              date and no past period is backfilled.
            </p>

            {report.unconfiguredTypes.length > 0 ? (
              <Alert tone="warning">
                {report.unconfiguredTypes.length} active balance-based type
                {report.unconfiguredTypes.length === 1 ? " has" : "s have"} no active
                policy and will be skipped:{" "}
                {report.unconfiguredTypes.map((type) => type.name).join(", ")}.
              </Alert>
            ) : null}

            {report.items.length === 0 ? (
              <EmptyState
                title="No eligible balances"
                description="There are no active employees or active balance-based leave types to initialize."
              />
            ) : (
              <div className="max-h-72 overflow-y-auto rounded-lg border border-line">
                <table className="w-full text-left text-xs">
                  <thead className="sticky top-0 bg-surface-muted">
                    <tr>
                      <th className="px-3 py-2 font-medium text-muted">Employee</th>
                      <th className="px-3 py-2 font-medium text-muted">Leave type</th>
                      <th className="px-3 py-2 font-medium text-muted">Period</th>
                      <th className="px-3 py-2 text-right font-medium text-muted">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {report.items.map((item) => (
                      <tr
                        key={`${item.employee.id}:${item.leaveType.id}:${item.periodStart}`}
                      >
                        <td className="px-3 py-2 text-ink">{item.employee.name}</td>
                        <td className="px-3 py-2 text-ink">{item.leaveType.name}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-muted">
                          {balancePeriodLabel(item.periodStart, item.periodEnd)}
                        </td>
                        <td className="px-3 py-2 text-right">
                          {item.balanceExists ? (
                            <Badge tone="neutral">Present</Badge>
                          ) : (
                            <Badge tone="warning">Will initialize</Badge>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {report.truncated ? (
              <p className="text-[11px] text-muted">
                Preview truncated to {report.items.length} rows. The confirmed apply still
                processes every eligible candidate.
              </p>
            ) : null}

            {!result ? (
              <label
                className="flex cursor-pointer items-start gap-3 rounded-lg border border-line bg-surface-muted p-3"
                htmlFor={acknowledgeId}
              >
                <input
                  id={acknowledgeId}
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 accent-ink"
                  checked={confirmed}
                  onChange={(event) => setConfirmed(event.target.checked)}
                  disabled={applying || missing === 0}
                />
                <span className="text-xs leading-5 text-ink-secondary">
                  I understand this creates {missing} balance row
                  {missing === 1 ? "" : "s"} for the current period. Existing balances,
                  ledger entries, and requests will not be altered.
                </span>
              </label>
            ) : (
              <BackfillResultList result={result} />
            )}
          </>
        )}
      </div>
    </Modal>
  );
}

function BackfillResultList({ result }: { result: LeaveBackfillResult }) {
  return (
    <div className="max-h-64 overflow-y-auto rounded-lg border border-line">
      <ul className="divide-y divide-line">
        {result.employees.map((employee) => (
          <li key={employee.employeeId} className="px-3 py-2 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium text-ink">{employee.employeeName}</span>
              <span className="text-muted">
                {employee.initialized.length} initialized ·{" "}
                {employee.alreadyPresent.length} present · {employee.failed.length} failed
              </span>
            </div>
            {employee.failed.length > 0 ? (
              <ul className="mt-1 list-disc pl-4 text-danger">
                {employee.failed.map((failure) => (
                  <li key={failure.leaveTypeId}>
                    {failure.leaveTypeName}: {failure.message}
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

function SummaryTile({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: number;
  tone?: "default" | "warning";
}) {
  return (
    <div
      className={cn(
        "rounded-lg border px-3 py-2",
        tone === "warning" ? "border-warning/40 bg-warning/5" : "border-line bg-surface",
      )}
    >
      <dt className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
        {label}
      </dt>
      <dd className="mt-0.5 text-sm font-semibold text-ink tnum">{value}</dd>
    </div>
  );
}

export function ReconciliationModal({
  organizationId,
  open,
  onClose,
  onCompleted,
}: {
  organizationId: string;
  open: boolean;
  onClose: () => void;
  onCompleted: () => void;
}) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [confirmed, setConfirmed] = useState(false);
  const [repairing, setRepairing] = useState(false);
  const [result, setResult] = useState<LeaveReconciliationRepairResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const acknowledgeId = useId();

  const reportApi = useApi(
    (signal) =>
      open
        ? getLeaveBalanceReconciliation(organizationId, {}, { signal })
        : Promise.resolve(null),
    [organizationId, open],
    { enabled: open },
  );

  const report: LeaveReconciliationReport | undefined = reportApi.data?.data;
  const safeRows = (report?.groups ?? []).flatMap((group) =>
    group.balances.filter((balance) => balance.safeToRemove),
  );

  function toggle(balanceId: string) {
    setSelectedIds((current) =>
      current.includes(balanceId)
        ? current.filter((id) => id !== balanceId)
        : [...current, balanceId],
    );
    setResult(null);
  }

  function selectAllSafe() {
    setSelectedIds(safeRows.map((balance) => balance.id));
    setResult(null);
  }

  async function repair() {
    if (repairing || selectedIds.length === 0 || !confirmed) return;
    setRepairing(true);
    setError(null);
    try {
      const response = await repairLeaveBalanceReconciliation(organizationId, selectedIds);
      setResult(response.data);
      setSelectedIds([]);
      setConfirmed(false);
      reportApi.reload();
      onCompleted();
    } catch (caught) {
      setError(leaveErrorMessage(caught));
    } finally {
      setRepairing(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Reconcile balance periods"
      description="Detects overlapping or incorrectly sized periods. Repair removes only empty, non-canonical rows with no ledger history and no leave requests."
      size="lg"
      dismissible={!repairing}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={repairing}>
            Close
          </Button>
          <Button
            onClick={repair}
            loading={repairing}
            disabled={selectedIds.length === 0 || !confirmed}
          >
            Remove {selectedIds.length} selected row{selectedIds.length === 1 ? "" : "s"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error ? <Alert tone="danger">{error}</Alert> : null}
        {result ? (
          <Alert tone={result.failed > 0 ? "warning" : "success"}>
            {result.repaired} removed · {result.failed} failed · batch{" "}
            {result.batchId.slice(0, 8)}
          </Alert>
        ) : null}

        {reportApi.error ? (
          <ErrorState message={reportApi.error} onRetry={reportApi.reload} />
        ) : reportApi.loading && !report ? (
          <LoadingBlock label="Scanning balances" rows={4} />
        ) : !report ? null : (
          <>
            <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <SummaryTile label="Balances scanned" value={report.summary.balancesScanned} />
              <SummaryTile
                label="Needs attention"
                value={report.summary.groupsNeedingAttention}
                tone="warning"
              />
              <SummaryTile
                label="Safe to remove"
                value={report.summary.safeToRemoveBalances}
                tone="warning"
              />
              <SummaryTile
                label="Manual review"
                value={report.summary.manualReviewBalances}
              />
            </dl>

            <p className="text-xs leading-5 text-muted">
              As of {formatDay(report.asOf)} in {report.timezone}. Generated{" "}
              {formatDateTime(report.generatedAt, report.timezone)}.
              {report.summary.unkeyedAccrualEntries > 0
                ? ` ${report.summary.unkeyedAccrualEntries} older accrual ledger entries have no month key; they are preserved for audit.`
                : ""}
            </p>

            {report.groups.length === 0 ? (
              <EmptyState
                title="No balance issues found"
                description="Every employee/type pair has a single canonical balance period."
              />
            ) : (
              <div className="space-y-3">
                {report.groups.map((group) => (
                  <section
                    key={`${group.employeeId}:${group.leaveTypeId}`}
                    className="overflow-hidden rounded-lg border border-line"
                    aria-label={`${group.employeeName} ${group.leaveTypeName}`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2 border-b border-line bg-surface-muted px-3 py-2">
                      <div className="min-w-0">
                        <p className="truncate text-xs font-semibold text-ink">
                          {group.employeeName}
                          {!group.employeeActive ? " · inactive employee" : ""}
                        </p>
                        <p className="truncate text-[11px] text-muted">
                          {group.leaveTypeName}
                          {group.policy
                            ? ` · period starts ${group.policy.balancePeriodStartDay}/${group.policy.balancePeriodStartMonth}`
                            : " · no policy"}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {group.issues.map((issue) => (
                          <Badge
                            key={issue}
                            tone={
                              issue === "OVERLAPPING_PERIODS" ||
                              issue === "NO_CURRENT_BALANCE"
                                ? "warning"
                                : "neutral"
                            }
                          >
                            {issueLabel(issue)}
                          </Badge>
                        ))}
                      </div>
                    </div>
                    <ul className="divide-y divide-line">
                      {group.balances.map((balance) => (
                        <li
                          key={balance.id}
                          className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-xs"
                        >
                          <div className="flex min-w-0 items-center gap-2">
                            {balance.safeToRemove ? (
                              <input
                                type="checkbox"
                                className="h-3.5 w-3.5 accent-ink"
                                aria-label={`Select ${balancePeriodLabel(balance.periodStart, balance.periodEnd)} for removal`}
                                checked={selectedIds.includes(balance.id)}
                                onChange={() => toggle(balance.id)}
                                disabled={repairing}
                              />
                            ) : (
                              <span className="h-3.5 w-3.5" aria-hidden="true" />
                            )}
                            <span className="whitespace-nowrap text-ink">
                              {balancePeriodLabel(balance.periodStart, balance.periodEnd)}
                            </span>
                            {balance.canonical ? (
                              <Badge tone="success">Canonical</Badge>
                            ) : null}
                          </div>
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted">
                            <span className="tnum">
                              {formatLeaveUnits(balance.availableBalance)} available
                            </span>
                            <span>{balance.ledgerEntries} ledger</span>
                            <span>{balance.requests} requests</span>
                            {balance.safeToRemove ? (
                              <Badge tone="warning">Safe to remove</Badge>
                            ) : balance.canonical ? null : (
                              <Badge tone="neutral">Manual review</Badge>
                            )}
                          </div>
                        </li>
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
            )}

            {safeRows.length > 0 ? (
              <Button variant="secondary" size="sm" onClick={selectAllSafe} disabled={repairing}>
                Select all safe to remove ({safeRows.length})
              </Button>
            ) : null}

            {!result ? (
              <label
                className="flex cursor-pointer items-start gap-3 rounded-lg border border-line bg-surface-muted p-3"
                htmlFor={acknowledgeId}
              >
                <input
                  id={acknowledgeId}
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 accent-ink"
                  checked={confirmed}
                  onChange={(event) => setConfirmed(event.target.checked)}
                  disabled={repairing || selectedIds.length === 0}
                />
                <span className="text-xs leading-5 text-ink-secondary">
                  I understand only the selected empty, non-canonical rows are removed.
                  Balances with ledger history or leave requests are preserved and need a
                  manual decision.
                </span>
              </label>
            ) : null}
          </>
        )}
      </div>
    </Modal>
  );
}
