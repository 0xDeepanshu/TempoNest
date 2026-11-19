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
  assignLeaveCredits,
  getEmployeeLeaveBalances,
  getLeaveOverview,
  listLeaveBalances,
  listLeaveLedger,
  listLeaveTypes,
  previewLeaveCredits,
} from "@/lib/leave-api";
import { leaveErrorMessage } from "@/lib/leave-errors";
import type {
  LeaveBalance,
  LeaveCreditAssignmentPreview,
  LeaveCreditMode,
  LeaveLedgerEntry,
} from "@/lib/types";
import { useApi } from "@/lib/use-api";
import { PlusIcon, SearchIcon, UsersIcon } from "./icons";
import { EmployeePicker } from "./employee-picker";
import {
  AccrualPreviewCard,
  BackfillModal,
  BulkAdjustmentModal,
  ReconciliationModal,
} from "./leave-balance-tools";
import { LeaveCreditsModal } from "./leave-credits-modal";
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
  StatCard,
  TableShell,
  Td,
  Textarea,
  Th,
  cn,
} from "./ui";
import { NoOrganization, useWorkspace } from "./workspace";

type Filters = {
  search: string;
  employeeId: string;
  leaveTypeId: string;
  periodStart: string;
};

const EMPTY_FILTERS: Filters = {
  search: "",
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
  const [historyPage, setHistoryPage] = useState(1);
  const [selected, setSelected] = useState<SelectedBalance | null>(null);
  const [tool, setTool] = useState<BalanceTool>(null);
  const [creditsOpen, setCreditsOpen] = useState(false);

  const types = useApi(
    (signal) => listLeaveTypes(organizationId, { signal }),
    [organizationId],
    { enabled: Boolean(organizationId) && canManage },
  );

  const overview = useApi(
    (signal) => getLeaveOverview(organizationId, { signal }),
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
          search: applied.search || undefined,
          employeeId: applied.employeeId || undefined,
          leaveTypeId: applied.leaveTypeId || undefined,
          periodStart: applied.periodStart || undefined,
        },
        { signal },
      ),
    [
      organizationId,
      page,
      applied.search,
      applied.employeeId,
      applied.leaveTypeId,
      applied.periodStart,
      canManage,
    ],
    { enabled: Boolean(organizationId) && canManage },
  );

  const history = useApi(
    (signal) =>
      listLeaveLedger(organizationId, { page: historyPage, limit: 15 }, { signal }),
    [organizationId, historyPage],
    { enabled: Boolean(organizationId) && canManage },
  );

  if (!organization) return <NoOrganization />;

  const rows = balances.data?.data ?? [];
  const typeOptions = (types.data?.data ?? []).filter((type) => type.requiresBalance);
  const hasFilters = Boolean(
    applied.search || applied.employeeId || applied.leaveTypeId || applied.periodStart,
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

  function refreshAll() {
    balances.reload();
    overview.reload();
    history.reload();
  }

  const summary = overview.data?.data;

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={`${organization.name} · ${organization.timezone}`}
        title="Leave balances"
        description="Give employees leave credits, review what they have used, and see every change in one place. 1 credit equals 1 day."
        actions={
          canManage ? (
            <Button onClick={() => setCreditsOpen(true)}>
              <PlusIcon className="h-3.5 w-3.5" />
              Assign leave credits
            </Button>
          ) : undefined
        }
      />

      <LeaveTabs current="balances" />

      {!canManage ? (
        <EmptyState
          title="Balance management requires leave:manage"
          description="Ask an owner or administrator to assign leave credits and review organization-wide balances."
        />
      ) : (
        <>
          {overview.error ? (
            <ErrorState message={overview.error} onRetry={overview.reload} />
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label="Active employees"
              value={summary ? summary.activeEmployees : "—"}
              hint={summary ? `${summary.leaveTypes} balance-based leave types` : "Loading"}
              icon={<UsersIcon className="h-4 w-4" />}
            />
            <StatCard
              label="Employees with credits"
              value={summary ? summary.employeesWithBalances : "—"}
              hint={
                summary ? `${summary.availableCredits} days available in total` : "Loading"
              }
              icon={<UsersIcon className="h-4 w-4" />}
            />
            <StatCard
              label="Credits assigned"
              value={summary ? summary.totalCreditsAssigned : "—"}
              hint={
                summary
                  ? `${summary.approvedConsumed} used · ${summary.pendingReserved} reserved`
                  : "Loading"
              }
            />
            <StatCard
              label="Pending applications"
              value={summary ? summary.pendingApplications : "—"}
              hint={
                summary && summary.pendingCancellations > 0
                  ? `${summary.pendingCancellations} cancellation${summary.pendingCancellations === 1 ? "" : "s"} to review`
                  : "Waiting for a decision"
              }
            />
          </div>

          <Card>
            <form
              onSubmit={applyFilters}
              className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-[minmax(200px,1.2fr)_minmax(200px,1fr)_190px_190px_auto] xl:items-end"
            >
              <Field label="Search" htmlFor="leave-balance-search">
                <div className="relative">
                  <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
                  <Input
                    id="leave-balance-search"
                    value={draft.search}
                    onChange={(event) =>
                      setDraft((current) => ({ ...current, search: event.target.value }))
                    }
                    placeholder="Name or email"
                    className="pl-9"
                  />
                </div>
              </Field>
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
                  <option value="">All leave types</option>
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
                hint="Any date inside the period. Empty uses today."
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
                    !draft.search &&
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
              title="Employee balances"
              description={
                balances.data
                  ? `${balances.data.meta.total} balance record${balances.data.meta.total === 1 ? "" : "s"}${hasFilters ? " match these filters" : ""}`
                  : "Loading balances…"
              }
              actions={
                <>
                  {hasFilters ? (
                    <Button variant="ghost" size="sm" onClick={clearFilters}>
                      Clear filters
                    </Button>
                  ) : null}
                  <Button variant="secondary" size="sm" onClick={() => setCreditsOpen(true)}>
                    <PlusIcon className="h-3.5 w-3.5" />
                    Assign credits
                  </Button>
                </>
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
                title={hasFilters ? "No balances match" : "No employee balances yet"}
                description={
                  hasFilters
                    ? "Try a different search, leave type, or period date."
                    : "Assign leave credits to create a balance for an employee and leave type. Choose all active employees to credit everyone at once."
                }
                icon={<SearchIcon className="h-5 w-5" />}
                action={
                  hasFilters ? (
                    <Button variant="secondary" size="sm" onClick={clearFilters}>
                      Clear filters
                    </Button>
                  ) : (
                    <Button size="sm" onClick={() => setCreditsOpen(true)}>
                      Assign leave credits
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

          <Card>
            <CardHeader
              title="Credit history"
              description="Every credit assignment, reservation, approval, rejection, and correction across the organization."
              actions={
                <Button variant="ghost" size="sm" onClick={history.reload}>
                  Refresh
                </Button>
              }
            />
            {history.error ? (
              <div className="p-4">
                <ErrorState message={history.error} onRetry={history.reload} />
              </div>
            ) : history.loading && !history.data ? (
              <LoadingBlock label="Loading credit history" rows={4} />
            ) : (history.data?.data ?? []).length === 0 ? (
              <EmptyState
                title="No balance history yet"
                description="Credit assignments and leave decisions will be recorded here."
              />
            ) : (
              <>
                <div className="hidden md:block">
                  <HistoryTable rows={history.data?.data ?? []} timezone={organization.timezone} />
                </div>
                <ul className="divide-y divide-line md:hidden">
                  {(history.data?.data ?? []).map((entry) => (
                    <HistoryRow key={entry.id} entry={entry} timezone={organization.timezone} />
                  ))}
                </ul>
                <Pagination
                  page={history.data?.meta.page ?? historyPage}
                  totalPages={history.data?.meta.totalPages ?? 1}
                  onPageChange={setHistoryPage}
                />
              </>
            )}
          </Card>

          <details className="rounded-xl border border-line bg-surface">
            <summary className="cursor-pointer px-4 py-3 text-[13px] font-semibold text-ink">
              Advanced maintenance
            </summary>
            <div className="space-y-3 border-t border-line p-4">
              <p className="text-xs leading-5 text-muted">
                These tools exist for edge cases. Daily work uses “Assign leave credits”
                above; these operations never delete balances or history.
              </p>
              <div className="grid gap-3 md:grid-cols-3">
                <OperationTile
                  title="Bulk adjustment"
                  description="Apply the same signed adjustment to several employees. Use Assign credits for normal allocations."
                  actionLabel="Bulk adjust"
                  onAction={() => setTool("bulk")}
                />
                <OperationTile
                  title="Initialize balances"
                  description="Create the current balance period for active employees and active balance-based leave types. Existing rows are preserved."
                  actionLabel="Preview backfill"
                  onAction={() => setTool("backfill")}
                />
                <OperationTile
                  title="Reconcile periods"
                  description="Find overlapping or incorrectly sized periods and remove only empty rows with no history or requests."
                  actionLabel="Scan balances"
                  onAction={() => setTool("reconcile")}
                />
              </div>
              {summary?.accrualConfigured ? (
                <AccrualPreviewCard organizationId={organization.id} types={typeOptions} />
              ) : null}
            </div>
          </details>
        </>
      )}

      <BalanceDetailModal
        key={selected?.balance.id ?? "closed"}
        organizationId={organization.id}
        timezone={organization.timezone}
        selected={selected}
        onClose={() => setSelected(null)}
        onChanged={refreshAll}
      />

      {canManage ? (
        <>
          {creditsOpen ? (
            <LeaveCreditsModal
              organizationId={organization.id}
              types={typeOptions}
              onClose={() => setCreditsOpen(false)}
              onCompleted={refreshAll}
            />
          ) : null}
          {tool === "bulk" ? (
            <BulkAdjustmentModal
              organizationId={organization.id}
              open
              types={typeOptions}
              onClose={() => setTool(null)}
              onCompleted={refreshAll}
            />
          ) : null}
          {tool === "backfill" ? (
            <BackfillModal
              organizationId={organization.id}
              open
              onClose={() => setTool(null)}
              onCompleted={refreshAll}
            />
          ) : null}
          {tool === "reconcile" ? (
            <ReconciliationModal
              organizationId={organization.id}
              open
              onClose={() => setTool(null)}
              onCompleted={refreshAll}
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
    <TableShell className="min-w-[820px]">
      <thead>
        <tr>
          <Th>Employee</Th>
          <Th>Leave type</Th>
          <Th className="text-right">Assigned</Th>
          <Th className="text-right">Used</Th>
          <Th className="text-right">Pending</Th>
          <Th className="text-right">Available</Th>
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
              <p className="mt-0.5 text-xs text-muted">
                {balancePeriodLabel(balance.periodStart, balance.periodEnd)}
              </p>
            </Td>
            <Td className="whitespace-nowrap text-right tnum">
              {formatLeaveUnits(balance.assignedBalance)}
            </Td>
            <Td className="whitespace-nowrap text-right tnum">
              {formatLeaveUnits(balance.approvedConsumed)}
            </Td>
            <Td className="whitespace-nowrap text-right tnum">
              {formatLeaveUnits(balance.pendingReserved)}
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
        <span>{formatLeaveUnits(balance.assignedBalance)} assigned</span>
        <span>{formatLeaveUnits(balance.pendingReserved)} pending</span>
        <span>{formatLeaveUnits(balance.approvedConsumed)} used</span>
      </div>
    </button>
  );
}

function HistoryTable({ rows, timezone }: { rows: LeaveLedgerEntry[]; timezone: string }) {
  return (
    <TableShell className="min-w-[880px]">
      <thead>
        <tr>
          <Th>Date</Th>
          <Th>Employee</Th>
          <Th>Leave type</Th>
          <Th>Operation</Th>
          <Th className="text-right">Amount</Th>
          <Th className="text-right">Available before → after</Th>
          <Th>Recorded by</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((entry) => {
          const before = entry.balanceAfter - entry.availableDelta;
          return (
            <tr key={entry.id} className="align-top hover:bg-surface-muted">
              <Td className="whitespace-nowrap text-xs text-muted">
                {formatDateTime(entry.createdAt, timezone)}
              </Td>
              <Td>
                <p className="font-medium text-ink">
                  {entry.employee?.name ?? "Unknown employee"}
                </p>
                <p className="text-xs text-muted">{entry.employee?.email ?? ""}</p>
              </Td>
              <Td className="text-xs">{entry.leaveType?.name ?? "Leave"}</Td>
              <Td className="text-xs">
                <span className="font-medium text-ink">{ledgerKindLabel(entry.kind)}</span>
                {entry.reason ? (
                  <p className="max-w-[240px] text-[11px] text-muted">{entry.reason}</p>
                ) : null}
              </Td>
              <Td
                className={cn(
                  "whitespace-nowrap text-right tnum font-medium",
                  entry.availableDelta === 0
                    ? "text-muted"
                    : entry.availableDelta > 0
                      ? "text-success"
                      : "text-danger",
                )}
              >
                {formatSignedLeaveUnits(entry.availableDelta)}
              </Td>
              <Td className="whitespace-nowrap text-right tnum text-xs">
                {formatLeaveUnits(before)} → {formatLeaveUnits(entry.balanceAfter)}
              </Td>
              <Td className="text-xs">{entry.actor ? entry.actor.name : "System"}</Td>
            </tr>
          );
        })}
      </tbody>
    </TableShell>
  );
}

function HistoryRow({ entry, timezone }: { entry: LeaveLedgerEntry; timezone: string }) {
  const before = entry.balanceAfter - entry.availableDelta;
  return (
    <li className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 px-4 py-3 text-[13px]">
      <div className="min-w-0">
        <p className="font-medium text-ink">
          {entry.employee?.name ?? "Unknown employee"} ·{" "}
          {entry.leaveType?.name ?? "Leave"}
        </p>
        <p className="text-xs text-muted">
          {ledgerKindLabel(entry.kind)} · {formatDateTime(entry.createdAt, timezone)}
        </p>
        <p className="text-[11px] text-muted">
          {entry.actor ? `Recorded by ${entry.actor.name}` : "Recorded by system"}
          {entry.reason ? ` · ${entry.reason}` : ""}
        </p>
      </div>
      <div className="text-right">
        <p
          className={cn(
            "font-semibold tnum",
            entry.availableDelta === 0
              ? "text-muted"
              : entry.availableDelta > 0
                ? "text-success"
                : "text-danger",
          )}
        >
          {formatSignedLeaveUnits(entry.availableDelta)} days
        </p>
        <p className="text-xs text-muted tnum">
          {formatLeaveUnits(before)} → {formatLeaveUnits(entry.balanceAfter)}
        </p>
      </div>
    </li>
  );
}

function BalanceDetailModal({
  organizationId,
  timezone,
  selected,
  onClose,
  onChanged,
}: {
  organizationId: string;
  timezone: string;
  selected: SelectedBalance | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [assigning, setAssigning] = useState(false);
  const [mode, setMode] = useState<LeaveCreditMode>("ADD");
  const [credits, setCredits] = useState("");
  const [reason, setReason] = useState("");
  const [preview, setPreview] = useState<LeaveCreditAssignmentPreview | null>(null);
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
  const balance = current ?? selected?.balance ?? null;

  if (!balance) return null;

  const isCurrentPeriod = isCurrentBalancePeriod(
    balance.periodStart,
    balance.periodEnd,
    timezone,
  );

  function beginAssignment() {
    setAssigning(true);
    setMode("ADD");
    setCredits("");
    setReason("");
    setPreview(null);
    setFormError(null);
    setSuccess(null);
  }

  function cancelAssignment() {
    if (submitting || previewing) return;
    setAssigning(false);
    setCredits("");
    setReason("");
    setPreview(null);
    setFormError(null);
  }

  function validate(): string | null {
    const value = Number(credits);
    if (!credits.trim() || !Number.isFinite(value)) {
      return "Enter the number of credits.";
    }
    if (value < 0) return "Credits cannot be negative.";
    if (value > 3650) return "Credits must be 3650 or fewer.";
    if (mode === "ADD" && value === 0) {
      return "Add credits needs an amount greater than zero.";
    }
    if (reason.trim().length < 3) {
      return "Enter a reason with at least 3 characters.";
    }
    return null;
  }

  function creditInput() {
    if (!balance) return null;
    return {
      leaveTypeId: balance.leaveTypeId,
      mode,
      credits: Number(credits),
      employeeIds: [balance.employeeId],
      effectiveDate: balance.periodStart,
      reason: reason.trim(),
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
      const input = creditInput();
      if (!input) return;
      const response = await previewLeaveCredits(organizationId, input);
      setPreview(response.data);
    } catch (caught) {
      setFormError(leaveErrorMessage(caught));
    } finally {
      setPreviewing(false);
    }
  }

  async function submitAssignment() {
    if (submitting || previewing || !balance || !preview) return;
    setFormError(null);
    setSuccess(null);
    setSubmitting(true);
    try {
      const input = creditInput();
      if (!input) return;
      await assignLeaveCredits(organizationId, input);
      setAssigning(false);
      setCredits("");
      setReason("");
      setPreview(null);
      setSuccess("Credits updated. The change is recorded in the balance history.");
      detail.reload();
      ledger.reload();
      onChanged();
    } catch (caught) {
      setFormError(leaveErrorMessage(caught));
    } finally {
      setSubmitting(false);
    }
  }

  const ledgerRows = ledger.data?.data ?? [];
  const previewItem = preview?.items.find((item) => item.ok);

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
        assigning ? (
          <>
            <Button
              variant="secondary"
              onClick={cancelAssignment}
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
              Preview changes
            </Button>
            <Button
              onClick={submitAssignment}
              loading={submitting}
              disabled={!preview || previewing}
            >
              Confirm and save
            </Button>
          </>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose}>
              Close
            </Button>
            <Button onClick={beginAssignment}>Assign credits</Button>
          </>
        )
      }
    >
      <div className="space-y-4">
        {success ? <Alert tone="success">{success}</Alert> : null}
        {detail.error ? (
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
            How this balance is calculated
          </h3>
          <div className="grid gap-2 sm:grid-cols-2">
            <BalanceFigure
              label="Available"
              value={balance.availableBalance}
              hint="Assigned minus used and pending."
              emphasis
            />
            <BalanceFigure
              label="Assigned"
              value={balance.assignedBalance}
              hint="Leave credits given for this period."
            />
            <BalanceFigure
              label="Used"
              value={balance.approvedConsumed}
              hint="Approved leave that has already been taken."
            />
            <BalanceFigure
              label="Pending"
              value={balance.pendingReserved}
              hint="Reserved by requests still waiting for a decision."
            />
          </div>
          <p className="mt-2 rounded-md bg-surface-muted px-3 py-2 text-[11px] leading-4 text-muted tnum">
            {formatLeaveUnits(balance.assignedBalance)} assigned −{" "}
            {formatLeaveUnits(balance.approvedConsumed)} used −{" "}
            {formatLeaveUnits(balance.pendingReserved)} pending ={" "}
            {formatLeaveUnits(balance.availableBalance)} available
          </p>
          <details className="mt-2 text-xs text-muted">
            <summary className="cursor-pointer font-medium text-ink-secondary">
              Credit sources
            </summary>
            <dl className="mt-1.5 grid gap-1 sm:grid-cols-2">
              <div className="flex justify-between gap-3 sm:block">
                <dt className="text-muted">Starting credits</dt>
                <dd className="tnum text-ink">{formatLeaveUnits(balance.entitledBalance)}</dd>
              </div>
              <div className="flex justify-between gap-3 sm:block">
                <dt className="text-muted">Scheduled credits</dt>
                <dd className="tnum text-ink">{formatLeaveUnits(balance.accruedBalance)}</dd>
              </div>
              <div className="flex justify-between gap-3 sm:block">
                <dt className="text-muted">Manual adjustments</dt>
                <dd className="tnum text-ink">
                  {formatSignedLeaveUnits(balance.adjustmentBalance)}
                </dd>
              </div>
              <div className="flex justify-between gap-3 sm:block">
                <dt className="text-muted">Carried forward</dt>
                <dd className="tnum text-ink">
                  {formatLeaveUnits(balance.carriedForwardBalance)}
                </dd>
              </div>
            </dl>
          </details>
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

        {assigning ? (
          <section
            aria-labelledby="leave-balance-assign"
            className="rounded-lg border border-line bg-surface-muted p-3.5"
          >
            <h3 id="leave-balance-assign" className="text-[13px] font-semibold text-ink">
              Assign credits for this period
            </h3>
            <p className="mt-0.5 text-xs leading-5 text-muted">
              Add credits on top of the assigned total, or set the assigned total exactly.
              Preview first; the server validates the policy cap and negative-balance rules
              before anything is written.
            </p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <Field label="Operation" htmlFor="leave-credit-mode">
                <Select
                  id="leave-credit-mode"
                  value={mode}
                  onChange={(event) => {
                    setMode(event.target.value as LeaveCreditMode);
                    setPreview(null);
                  }}
                >
                  <option value="ADD">Add credits</option>
                  <option value="SET">Set balance</option>
                </Select>
              </Field>
              <Field
                label={mode === "ADD" ? "Credits to add" : "New assigned total"}
                htmlFor="leave-credit-amount"
                required
              >
                <Input
                  id="leave-credit-amount"
                  type="number"
                  inputMode="decimal"
                  step="any"
                  min={0}
                  max={3650}
                  value={credits}
                  onChange={(event) => {
                    setCredits(event.target.value);
                    setPreview(null);
                  }}
                  data-autofocus
                />
              </Field>
            </div>
            <div className="mt-3">
              <Field
                label="Reason"
                htmlFor="leave-credit-reason"
                required
                hint="At least 3 characters. Stored with the change and shown in history."
              >
                <Textarea
                  id="leave-credit-reason"
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
                {previewItem && previewItem.ok ? (
                  <dl className="mt-1.5 grid gap-1 sm:grid-cols-2">
                    <div className="flex justify-between gap-3 sm:block">
                      <dt className="text-muted">Assigned</dt>
                      <dd className="tnum text-ink">
                        {formatLeaveUnits(previewItem.assignedBefore)} →{" "}
                        {formatLeaveUnits(previewItem.assignedAfter)}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-3 sm:block">
                      <dt className="text-muted">Available</dt>
                      <dd className="tnum text-ink">
                        {formatLeaveUnits(previewItem.availableBefore)} →{" "}
                        {formatLeaveUnits(previewItem.availableAfter)}
                      </dd>
                    </div>
                  </dl>
                ) : (
                  <p className="mt-1 text-danger">
                    {preview.items.find((item) => !item.ok)?.message ??
                      "This change cannot be applied."}
                  </p>
                )}
                <p className="mt-1.5 text-[11px] text-muted">
                  {previewItem && previewItem.ok && previewItem.unchanged
                    ? "This employee is already at the requested balance. Nothing will change."
                    : "Nothing has been written yet."}
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
            History for this period
          </h3>
          {ledger.error ? (
            <ErrorState message={ledger.error} onRetry={ledger.reload} />
          ) : ledger.loading && !ledger.data ? (
            <LoadingBlock label="Loading history" rows={3} />
          ) : ledgerRows.length === 0 ? (
            <p className="text-xs leading-5 text-muted">
              No credit or leave activity yet for this period.
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
  emphasis = false,
}: {
  label: string;
  value: number;
  hint: string;
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
        {formatLeaveUnits(value)}
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
