"use client";

import { useState } from "react";
import { formatDateTime, formatDay } from "@/lib/format";
import { hasPermission } from "@/lib/permissions";
import {
  balancePeriodLabel,
  formatLeaveUnits,
  formatSignedLeaveUnits,
  isCurrentBalancePeriod,
  isLowBalance,
  ledgerKindLabel,
  LOW_BALANCE_THRESHOLD,
} from "@/lib/leave";
import {
  adjustLeaveBalance,
  getEmployeeLeaveBalances,
  listLeaveBalances,
  listLeaveLedger,
  listLeaveTypes,
  previewLeaveBalanceAdjustment,
} from "@/lib/leave-api";
import { leaveErrorMessage } from "@/lib/leave-errors";
import type { LeaveAdjustmentPreview, LeaveBalance, LeaveLedgerEntry } from "@/lib/types";
import { useApi } from "@/lib/use-api";
import { SearchIcon } from "./icons";
import { EmployeePicker } from "./employee-picker";
import {
  AccrualPreviewCard,
  BackfillModal,
  BulkAdjustmentModal,
  ReconciliationModal,
} from "./leave-balance-tools";
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
  periodStart: string;
};

const EMPTY_FILTERS: Filters = {
  employeeId: "",
  leaveTypeId: "",
  periodStart: "",
};

type SelectedBalance = { balance: LeaveBalance };
type BalanceTool = "bulk" | "backfill" | "reconcile" | null;

export function LeaveBalancesView() {
  const { organization, membership } = useWorkspace();
  const organizationId = organization?.id ?? "";
  const canManage = hasPermission(membership, "leave:manage");
  const [draft, setDraft] = useState<Filters>(EMPTY_FILTERS);
  const [applied, setApplied] = useState<Filters>(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<SelectedBalance | null>(null);
  const [tool, setTool] = useState<BalanceTool>(null);

  const types = useApi(
    (signal) => listLeaveTypes(organizationId, { signal }),
    [organizationId],
    { enabled: Boolean(organizationId) && canManage },
  );

  const balances = useApi(
    (signal) =>
      listLeaveBalances(
        organizationId,
        {
          page,
          limit: 20,
          employeeId: applied.employeeId || undefined,
          leaveTypeId: applied.leaveTypeId || undefined,
          periodStart: applied.periodStart || undefined,
        },
        { signal },
      ),
    [
      organizationId,
      page,
      applied.employeeId,
      applied.leaveTypeId,
      applied.periodStart,
      canManage,
    ],
    { enabled: Boolean(organizationId) && canManage },
  );

  if (!organization) return <NoOrganization />;

  const rows = balances.data?.data ?? [];
  const typeOptions = (types.data?.data ?? []).filter((type) => type.requiresBalance);
  const hasFilters = Boolean(
    applied.employeeId || applied.leaveTypeId || applied.periodStart,
  );

  function applyFilters(event: React.FormEvent) {
    event.preventDefault();
    setApplied({ ...draft });
    setPage(1);
  }

  function clearFilters() {
    setDraft(EMPTY_FILTERS);
    setApplied(EMPTY_FILTERS);
    setPage(1);
  }

  function reloadBalances() {
    balances.reload();
  }

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={`${organization.name} · ${organization.timezone}`}
        title="Leave balances"
        description="Inspect entitled, accrued, adjusted, carried-forward, consumed, and reserved balances. Adjustments are audited, require a reason, and are recalculated by the server."
      />

      <LeaveTabs current="balances" />

      {!canManage ? (
        <EmptyState
          title="Balance management requires leave:manage"
          description="Ask an owner or administrator to review organization-wide leave balances."
        />
      ) : (
        <>
          <Card>
            <form
              onSubmit={applyFilters}
              className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-[minmax(220px,1.2fr)_200px_190px_auto] xl:items-end"
            >
              <Field label="Employee" htmlFor="leave-balance-employee">
                <EmployeePicker
                  id="leave-balance-employee"
                  organizationId={organization.id}
                  value={draft.employeeId}
                  onChange={(employeeId) =>
                    setDraft((current) => ({ ...current, employeeId }))
                  }
                />
              </Field>
              <Field label="Leave type" htmlFor="leave-balance-type">
                <Select
                  id="leave-balance-type"
                  value={draft.leaveTypeId}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, leaveTypeId: event.target.value }))
                  }
                >
                  <option value="">All balance types</option>
                  {typeOptions.map((type) => (
                    <option key={type.id} value={type.id}>
                      {type.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field
                label="Period date"
                htmlFor="leave-balance-period"
                hint="Any date inside the balance period. Empty uses today."
              >
                <Input
                  id="leave-balance-period"
                  type="date"
                  value={draft.periodStart}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, periodStart: event.target.value }))
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
                    !draft.periodStart
                  }
                >
                  Clear
                </Button>
              </div>
            </form>
          </Card>

          {balances.error ? (
            <ErrorState message={balances.error} onRetry={balances.reload} />
          ) : null}

          <Card>
            <CardHeader
              title="Balances"
              description={
                balances.data
                  ? `${balances.data.meta.total} balance record${balances.data.meta.total === 1 ? "" : "s"}${hasFilters ? " match these filters" : ""}`
                  : "Loading balances…"
              }
              actions={
                hasFilters ? (
                  <Button variant="ghost" size="sm" onClick={clearFilters}>
                    Clear filters
                  </Button>
                ) : undefined
              }
            />

            {types.error ? (
              <div className="border-b border-line px-4 py-2">
                <ErrorState message={types.error} onRetry={types.reload} />
              </div>
            ) : null}

            {balances.loading && !balances.data ? (
              <LoadingBlock label="Loading leave balances" rows={5} />
            ) : rows.length === 0 ? (
              <EmptyState
                title={hasFilters ? "No balances match" : "No balance records"}
                description={
                  hasFilters
                    ? "Try a different employee, leave type, or period date."
                    : "Balances appear for active employees and active balance-based leave types. Use “Initialize balances” below to create the current period for everyone eligible."
                }
                icon={<SearchIcon className="h-5 w-5" />}
                action={
                  hasFilters ? (
                    <Button variant="secondary" size="sm" onClick={clearFilters}>
                      Clear filters
                    </Button>
                  ) : (
                    <Button variant="secondary" size="sm" onClick={() => setTool("backfill")}>
                      Initialize balances
                    </Button>
                  )
                }
              />
            ) : (
              <>
                <div className="hidden md:block">
                  <BalanceTable
                    balances={rows}
                    onOpen={(balance) => setSelected({ balance })}
                  />
                </div>
                <div className="divide-y divide-line md:hidden">
                  {rows.map((balance) => (
                    <BalanceCard
                      key={balance.id}
                      balance={balance}
                      onOpen={() => setSelected({ balance })}
                    />
                  ))}
                </div>
                <Pagination
                  page={balances.data?.meta.page ?? page}
                  totalPages={balances.data?.meta.totalPages ?? 1}
                  onPageChange={setPage}
                />
              </>
            )}
          </Card>

          <AccrualPreviewCard
            organizationId={organization.id}
            types={typeOptions}
          />

          <Card>
            <CardHeader
              title="Balance operations"
              description="Preview and confirm changes. Every operation is permission-checked, organization-scoped, and audited."
            />
            <div className="grid gap-3 p-4 md:grid-cols-3">
              <OperationTile
                title="Bulk adjustment"
                description="Credit or debit the same leave type for several employees, with a per-employee preview before confirmation."
                actionLabel="Bulk adjust"
                onAction={() => setTool("bulk")}
              />
              <OperationTile
                title="Initialize balances"
                description="Create the current balance period for active employees and active balance-based leave types. Existing history is preserved."
                actionLabel="Preview backfill"
                onAction={() => setTool("backfill")}
              />
              <OperationTile
                title="Reconcile periods"
                description="Find overlapping or incorrectly sized periods and remove only empty rows with no ledger history or requests."
                actionLabel="Scan balances"
                onAction={() => setTool("reconcile")}
              />
            </div>
          </Card>
        </>
      )}

      <BalanceDetailModal
        key={selected?.balance.id ?? "closed"}
        organizationId={organization.id}
        timezone={organization.timezone}
        selected={selected}
        onClose={() => setSelected(null)}
        onAdjusted={reloadBalances}
      />

      {canManage ? (
        <>
          {tool === "bulk" ? (
            <BulkAdjustmentModal
              organizationId={organization.id}
              open
              types={typeOptions}
              onClose={() => setTool(null)}
              onCompleted={reloadBalances}
            />
          ) : null}
          {tool === "backfill" ? (
            <BackfillModal
              organizationId={organization.id}
              open
              onClose={() => setTool(null)}
              onCompleted={reloadBalances}
            />
          ) : null}
          {tool === "reconcile" ? (
            <ReconciliationModal
              organizationId={organization.id}
              open
              onClose={() => setTool(null)}
              onCompleted={reloadBalances}
            />
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function OperationTile({
  title,
  description,
  actionLabel,
  onAction,
}: {
  title: string;
  description: string;
  actionLabel: string;
  onAction: () => void;
}) {
  return (
    <div className="flex flex-col justify-between gap-3 rounded-lg border border-line p-3.5">
      <div>
        <h3 className="text-[13px] font-semibold text-ink">{title}</h3>
        <p className="mt-1 text-xs leading-5 text-muted">{description}</p>
      </div>
      <div>
        <Button variant="secondary" size="sm" onClick={onAction}>
          {actionLabel}
        </Button>
      </div>
    </div>
  );
}

function BalanceTable({
  balances,
  onOpen,
}: {
  balances: LeaveBalance[];
  onOpen: (balance: LeaveBalance) => void;
}) {
  return (
    <TableShell className="min-w-[1020px]">
      <thead>
        <tr>
          <Th>Employee</Th>
          <Th>Leave type</Th>
          <Th>Period</Th>
          <Th className="text-right">Available</Th>
          <Th className="text-right">Pending</Th>
          <Th className="text-right">Approved</Th>
          <Th className="text-right">Entitled</Th>
          <Th className="text-right">Accrued</Th>
          <Th className="text-right">Adjusted</Th>
          <Th className="text-right">Carried fwd</Th>
          <Th className="text-right"> </Th>
        </tr>
      </thead>
      <tbody>
        {balances.map((balance) => (
          <tr key={balance.id} className="hover:bg-surface-muted">
            <Td>
              <div className="flex items-center gap-2.5">
                <Avatar name={balance.employee?.name ?? "Unknown"} size="sm" />
                <div className="min-w-0">
                  <p className="truncate font-medium text-ink">
                    {balance.employee?.name ?? "Unknown employee"}
                  </p>
                  <p className="truncate text-xs text-muted">
                    {balance.employee?.email ?? "—"}
                  </p>
                </div>
              </div>
            </Td>
            <Td>
              <span className="font-medium text-ink">
                {balance.leaveType?.name ?? "Leave"}
              </span>
              {balance.leaveType ? (
                <div className="mt-1">
                  <Badge tone={balance.leaveType.isPaid ? "success" : "neutral"}>
                    {balance.leaveType.isPaid ? "Paid" : "Unpaid"}
                  </Badge>
                </div>
              ) : null}
            </Td>
            <Td className="whitespace-nowrap text-xs">
              {balancePeriodLabel(balance.periodStart, balance.periodEnd)}
            </Td>
            <Td className="whitespace-nowrap text-right">
              <span
                className={cn(
                  "font-semibold tnum",
                  isLowBalance(balance) ? "text-warning" : "text-ink",
                )}
              >
                {formatLeaveUnits(balance.availableBalance)}
              </span>
              {isLowBalance(balance) ? (
                <p className="text-[11px] text-warning">
                  At or below {LOW_BALANCE_THRESHOLD} days
                </p>
              ) : null}
            </Td>
            <NumberCell value={balance.pendingReserved} />
            <NumberCell value={balance.approvedConsumed} />
            <NumberCell value={balance.entitledBalance} />
            <NumberCell value={balance.accruedBalance} />
            <NumberCell value={balance.adjustmentBalance} signed />
            <NumberCell value={balance.carriedForwardBalance} />
            <Td className="text-right">
              <Button variant="secondary" size="sm" onClick={() => onOpen(balance)}>
                View
              </Button>
            </Td>
          </tr>
        ))}
      </tbody>
    </TableShell>
  );
}

function NumberCell({ value, signed = false }: { value: number; signed?: boolean }) {
  return (
    <Td className="whitespace-nowrap text-right tnum">
      {signed ? formatSignedLeaveUnits(value) : formatLeaveUnits(value)}
    </Td>
  );
}

function BalanceCard({
  balance,
  onOpen,
}: {
  balance: LeaveBalance;
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
          <Avatar name={balance.employee?.name ?? "Unknown"} size="sm" />
          <div className="min-w-0">
            <p className="truncate text-[13px] font-medium text-ink">
              {balance.employee?.name ?? "Unknown employee"}
            </p>
            <p className="truncate text-xs text-muted">
              {balance.leaveType?.name ?? "Leave"} ·{" "}
              {balancePeriodLabel(balance.periodStart, balance.periodEnd)}
            </p>
          </div>
        </div>
        <Badge tone={isLowBalance(balance) ? "warning" : "neutral"}>
          {formatLeaveUnits(balance.availableBalance)}
        </Badge>
      </div>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
        <span>{formatLeaveUnits(balance.pendingReserved)} pending</span>
        <span>{formatLeaveUnits(balance.approvedConsumed)} approved</span>
        <span className="text-ink-secondary">
          {formatLeaveUnits(balance.entitledBalance + balance.accruedBalance)} entitled + accrued
        </span>
      </div>
    </button>
  );
}

function BalanceDetailModal({
  organizationId,
  timezone,
  selected,
  onClose,
  onAdjusted,
}: {
  organizationId: string;
  timezone: string;
  selected: SelectedBalance | null;
  onClose: () => void;
  onAdjusted: () => void;
}) {
  const [updated, setUpdated] = useState<LeaveBalance | null>(null);
  const [adjusting, setAdjusting] = useState(false);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [preview, setPreview] = useState<LeaveAdjustmentPreview | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [ledgerPage, setLedgerPage] = useState(1);

  const detail = useApi(
    (signal) =>
      selected
        ? getEmployeeLeaveBalances(
            organizationId,
            selected.balance.employeeId,
            {
              leaveTypeId: selected.balance.leaveTypeId,
              periodStart: selected.balance.periodStart,
            },
            { signal },
          )
        : Promise.resolve(null),
    [organizationId, selected?.balance.id],
    { enabled: Boolean(selected) },
  );

  const ledger = useApi(
    (signal) =>
      selected
        ? listLeaveLedger(
            organizationId,
            {
              page: ledgerPage,
              limit: 20,
              employeeId: selected.balance.employeeId,
              leaveTypeId: selected.balance.leaveTypeId,
              periodStart: selected.balance.periodStart,
            },
            { signal },
          )
        : Promise.resolve(null),
    [organizationId, selected?.balance.id, ledgerPage],
    { enabled: Boolean(selected) },
  );

  const current = detail.data?.data.balances.find(
    (row) =>
      row.leaveTypeId === selected?.balance.leaveTypeId &&
      row.periodStart === selected?.balance.periodStart,
  );
  const balance = updated ?? current ?? selected?.balance ?? null;

  if (!balance) return null;

  const isCurrentPeriod = isCurrentBalancePeriod(
    balance.periodStart,
    balance.periodEnd,
    timezone,
  );

  function beginAdjustment() {
    setAdjusting(true);
    setAmount("");
    setReason("");
    setPreview(null);
    setFormError(null);
    setSuccess(null);
  }

  function cancelAdjustment() {
    if (submitting || previewing) return;
    setAdjusting(false);
    setAmount("");
    setReason("");
    setPreview(null);
    setFormError(null);
  }

  function validate(): string | null {
    if (!balance) return "No balance selected.";
    const parsedAmount = Number(amount);
    if (!amount.trim() || !Number.isFinite(parsedAmount)) {
      return "Enter an amount in days.";
    }
    if (parsedAmount === 0) {
      return "The adjustment amount must not be zero.";
    }
    if (Math.abs(parsedAmount) > 3650) {
      return "The adjustment must be between -3650 and 3650 days.";
    }
    if (reason.trim().length < 3) {
      return "Enter a reason with at least 3 characters.";
    }
    return null;
  }

  function adjustmentInput() {
    if (!balance) return null;
    return {
      leaveTypeId: balance.leaveTypeId,
      amount: Number(amount),
      reason: reason.trim(),
      periodStart: balance.periodStart,
    };
  }

  async function runPreview() {
    if (previewing || submitting || !balance) return;
    const error = validate();
    if (error) {
      setFormError(error);
      return;
    }
    setFormError(null);
    setSuccess(null);
    setPreviewing(true);
    try {
      const input = adjustmentInput();
      if (!input) return;
      const response = await previewLeaveBalanceAdjustment(
        organizationId,
        balance.employeeId,
        input,
      );
      setPreview(response.data);
    } catch (caught) {
      setFormError(leaveErrorMessage(caught));
    } finally {
      setPreviewing(false);
    }
  }

  async function submitAdjustment() {
    if (submitting || previewing || !balance || !preview) return;
    setFormError(null);
    setSuccess(null);
    setSubmitting(true);
    try {
      const input = adjustmentInput();
      if (!input) return;
      const result = await adjustLeaveBalance(organizationId, balance.employeeId, input);
      setUpdated(result.data.balance);
      setAdjusting(false);
      setAmount("");
      setReason("");
      setPreview(null);
      setSuccess(
        "Balance adjustment recorded. The server recalculated the available balance, wrote the ledger entry, and updated this period only.",
      );
      detail.reload();
      ledger.reload();
      onAdjusted();
    } catch (caught) {
      setFormError(leaveErrorMessage(caught));
    } finally {
      setSubmitting(false);
    }
  }

  const ledgerRows = ledger.data?.data ?? [];

  return (
    <Modal
      open={Boolean(selected)}
      onClose={onClose}
      title="Leave balance"
      description={
        balance.employee
          ? `${balance.employee.name} · ${balance.leaveType?.name ?? "Leave"}`
          : (balance.leaveType?.name ?? "Leave")
      }
      size="lg"
      dismissible={!submitting && !previewing}
      footer={
        adjusting ? (
          <>
            <Button
              variant="secondary"
              onClick={cancelAdjustment}
              disabled={submitting || previewing}
            >
              Back
            </Button>
            <Button
              variant="secondary"
              onClick={runPreview}
              loading={previewing}
              disabled={submitting}
            >
              Preview adjustment
            </Button>
            <Button
              onClick={submitAdjustment}
              loading={submitting}
              disabled={!preview || previewing}
            >
              Confirm adjustment
            </Button>
          </>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose}>
              Close
            </Button>
            <Button onClick={beginAdjustment}>Adjust this period</Button>
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
          <Badge tone="outline">{balancePeriodLabel(balance.periodStart, balance.periodEnd)}</Badge>
          {isCurrentPeriod ? (
            <Badge tone="success">Current period</Badge>
          ) : (
            <Badge tone="neutral">Not the current period</Badge>
          )}
          {balance.leaveType ? (
            <Badge tone={balance.leaveType.isPaid ? "success" : "neutral"}>
              {balance.leaveType.isPaid ? "Paid leave" : "Unpaid leave"}
            </Badge>
          ) : null}
        </div>

        <section aria-labelledby="leave-balance-breakdown">
          <h3
            id="leave-balance-breakdown"
            className="mb-1 text-[11px] font-semibold uppercase tracking-[0.1em] text-muted"
          >
            Balance breakdown
          </h3>
          <div className="grid gap-2 sm:grid-cols-2">
            <BalanceFigure
              label="Available balance"
              value={balance.availableBalance}
              hint="Entitled plus accrued, adjustments, and carried forward, minus approved and pending amounts."
              emphasis
            />
            <BalanceFigure
              label="Pending approval"
              value={balance.pendingReserved}
              hint="Reserved by pending leave requests."
            />
            <BalanceFigure
              label="Approved consumed"
              value={balance.approvedConsumed}
              hint="Approved leave charged in this period."
            />
            <BalanceFigure
              label="Entitled"
              value={balance.entitledBalance}
              hint="Initial entitlement after any proration."
            />
            <BalanceFigure
              label="Accrued"
              value={balance.accruedBalance}
              hint="Scheduled accrual tranches credited to date."
            />
            <BalanceFigure
              label="Adjustments"
              value={balance.adjustmentBalance}
              hint="Net administrator adjustments for this period."
              signed
            />
            <BalanceFigure
              label="Carried forward"
              value={balance.carriedForwardBalance}
              hint="Credited from the previous balance period."
            />
          </div>
        </section>

        <section aria-labelledby="leave-balance-employee">
          <h3
            id="leave-balance-employee"
            className="mb-1 text-[11px] font-semibold uppercase tracking-[0.1em] text-muted"
          >
            Employee
          </h3>
          <dl>
            <DetailRow
              label="Employee"
              value={
                <span className="flex items-center gap-2">
                  <Avatar name={balance.employee?.name ?? "Unknown"} size="sm" />
                  <span className="min-w-0">
                    <span className="block truncate">
                      {balance.employee?.name ?? "Unknown employee"}
                    </span>
                    <span className="block truncate text-xs font-normal text-muted">
                      {balance.employee?.email ?? "—"}
                    </span>
                  </span>
                </span>
              }
            />
            <DetailRow label="Leave type" value={balance.leaveType?.name ?? "Leave"} />
            <DetailRow
              label="Period"
              value={`${formatDay(balance.periodStart)} – ${formatDay(balance.periodEnd)}`}
            />
            <DetailRow
              label="Updated"
              value={formatDateTime(balance.updatedAt, timezone)}
            />
          </dl>
        </section>

        {adjusting ? (
          <section
            aria-labelledby="leave-balance-adjust"
            className="rounded-lg border border-line bg-surface-muted p-3.5"
          >
            <h3 id="leave-balance-adjust" className="text-[13px] font-semibold text-ink">
              Adjust this balance period
            </h3>
            <p className="mt-0.5 text-xs leading-5 text-muted">
              The adjustment is recorded against{" "}
              {balancePeriodLabel(balance.periodStart, balance.periodEnd)} only. Preview it
              first; the server validates the policy cap and negative-balance rules before
              anything is written.
            </p>
            <div className="mt-3 space-y-3">
              <Field
                label="Amount (days)"
                htmlFor="leave-adjustment-amount"
                required
                hint="Use a positive number to credit and a negative number to debit."
              >
                <Input
                  id="leave-adjustment-amount"
                  type="number"
                  inputMode="decimal"
                  step="any"
                  min={-3650}
                  max={3650}
                  value={amount}
                  onChange={(event) => {
                    setAmount(event.target.value);
                    setPreview(null);
                  }}
                  data-autofocus
                />
              </Field>
              <Field
                label="Reason"
                htmlFor="leave-adjustment-reason"
                required
                hint="At least 3 characters. Stored with the adjustment and shown in history."
              >
                <Textarea
                  id="leave-adjustment-reason"
                  value={reason}
                  onChange={(event) => {
                    setReason(event.target.value);
                    setPreview(null);
                  }}
                  maxLength={500}
                />
              </Field>
            </div>

            {preview ? (
              <div className="mt-3 rounded-lg border border-line bg-surface p-3 text-xs">
                <p className="font-medium text-ink">Preview</p>
                <dl className="mt-1.5 grid gap-1 sm:grid-cols-2">
                  <div className="flex justify-between gap-3 sm:block">
                    <dt className="text-muted">Available</dt>
                    <dd className="tnum text-ink">
                      {formatLeaveUnits(preview.availableBefore)} →{" "}
                      {formatLeaveUnits(preview.availableAfter)}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-3 sm:block">
                    <dt className="text-muted">Adjustment balance</dt>
                    <dd className="tnum text-ink">
                      {formatSignedLeaveUnits(preview.adjustmentBefore)} →{" "}
                      {formatSignedLeaveUnits(preview.adjustmentAfter)}
                    </dd>
                  </div>
                </dl>
                <p className="mt-1.5 text-[11px] text-muted">
                  {preview.balanceExists
                    ? "Applying now updates this existing balance."
                    : "Applying now creates this balance period first."}{" "}
                  Nothing has been written yet.
                </p>
              </div>
            ) : null}
          </section>
        ) : null}

        <section aria-labelledby="leave-balance-history">
          <h3
            id="leave-balance-history"
            className="mb-1 text-[11px] font-semibold uppercase tracking-[0.1em] text-muted"
          >
            Ledger history
          </h3>
          {ledger.error ? (
            <ErrorState message={ledger.error} onRetry={ledger.reload} />
          ) : ledger.loading && !ledger.data ? (
            <LoadingBlock label="Loading ledger" rows={3} />
          ) : ledgerRows.length === 0 ? (
            <p className="text-xs leading-5 text-muted">
              No ledger entries yet for this balance period.
            </p>
          ) : (
            <div className="overflow-hidden rounded-lg border border-line">
              <ul className="divide-y divide-line">
                {ledgerRows.map((entry) => (
                  <LedgerRow key={entry.id} entry={entry} timezone={timezone} />
                ))}
              </ul>
              <Pagination
                page={ledger.data?.meta.page ?? ledgerPage}
                totalPages={ledger.data?.meta.totalPages ?? 1}
                onPageChange={setLedgerPage}
              />
            </div>
          )}
        </section>
      </div>
    </Modal>
  );
}

function BalanceFigure({
  label,
  value,
  hint,
  signed = false,
  emphasis = false,
}: {
  label: string;
  value: number;
  hint: string;
  signed?: boolean;
  emphasis?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border px-3 py-2",
        emphasis ? "border-line-strong bg-surface-muted" : "border-line bg-surface",
      )}
    >
      <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
        {label}
      </p>
      <p className="mt-0.5 text-sm font-semibold text-ink tnum">
        {signed ? formatSignedLeaveUnits(value) : formatLeaveUnits(value)}
      </p>
      <p className="mt-0.5 text-[11px] leading-4 text-muted">{hint}</p>
    </div>
  );
}

function LedgerRow({
  entry,
  timezone,
}: {
  entry: LeaveLedgerEntry;
  timezone: string;
}) {
  const credit = entry.availableDelta > 0;
  return (
    <li className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 px-3 py-2 text-[13px]">
      <div className="min-w-0">
        <p className="font-medium text-ink">{ledgerKindLabel(entry.kind)}</p>
        <p className="text-xs text-muted">
          {formatDateTime(entry.createdAt, timezone)}
          {entry.actor ? ` · ${entry.actor.name}` : " · System"}
          {entry.reason ? ` · ${entry.reason}` : ""}
        </p>
        {entry.accrualPeriod ? (
          <p className="text-[11px] text-muted">
            Accrual month {formatDay(entry.accrualPeriod)}
          </p>
        ) : null}
      </div>
      <div className="text-right">
        <p
          className={cn(
            "font-semibold tnum",
            entry.availableDelta === 0
              ? "text-muted"
              : credit
                ? "text-success"
                : "text-danger",
          )}
        >
          {formatSignedLeaveUnits(entry.availableDelta)} days
        </p>
        <p className="text-xs text-muted tnum">
          {formatLeaveUnits(entry.balanceAfter)} available after
        </p>
      </div>
    </li>
  );
}
