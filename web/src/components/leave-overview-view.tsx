"use client";

import Link from "next/link";
import { useMemo } from "react";
import { hasPermission } from "@/lib/permissions";
import { formatDateTime, formatDateRange } from "@/lib/format";
import {
  formatLeaveUnits,
  isLowBalance,
  isZeroBalance,
  LOW_BALANCE_THRESHOLD,
} from "@/lib/leave";
import {
  listAllLeaveBalances,
  listLeaveRequests,
  listLeaveTypes,
} from "@/lib/leave-api";
import type { LeaveBalance, LeaveRequest } from "@/lib/types";
import { useApi } from "@/lib/use-api";
import { ArrowRightIcon, CalendarIcon, CheckSquareIcon, ClockIcon, UsersIcon } from "./icons";
import { LeaveTabs } from "./leave-tabs";
import {
  Alert,
  Avatar,
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  LoadingBlock,
  PageHeader,
  StatCard,
  StatusBadge,
  TableShell,
  Td,
  Th,
} from "./ui";
import { NoOrganization, useWorkspace } from "./workspace";

const PREVIEW_LIMIT = 5;

export function LeaveOverviewView() {
  const { organization, membership } = useWorkspace();
  const organizationId = organization?.id ?? "";
  const canReview =
    hasPermission(membership, "leave:approve") || hasPermission(membership, "leave:manage");
  const canManage = hasPermission(membership, "leave:manage");

  const pending = useApi(
    (signal) =>
      listLeaveRequests(
        organizationId,
        { status: "PENDING", page: 1, limit: PREVIEW_LIMIT },
        { signal },
      ),
    [organizationId],
    { enabled: Boolean(organizationId) && canReview },
  );

  const approved = useApi(
    (signal) =>
      listLeaveRequests(
        organizationId,
        { status: "APPROVED", page: 1, limit: 1 },
        { signal },
      ),
    [organizationId],
    { enabled: Boolean(organizationId) && canReview },
  );

  const types = useApi(
    (signal) => listLeaveTypes(organizationId, { signal }),
    [organizationId],
    { enabled: Boolean(organizationId) && canReview },
  );

  const balances = useApi(
    (signal) =>
      listAllLeaveBalances(organizationId, {}, { signal, maxPages: 10 }),
    [organizationId],
    { enabled: Boolean(organizationId) && canManage },
  );

  const lowBalances = useMemo(() => {
    const rows = (balances.data?.rows ?? []).filter(isLowBalance);
    rows.sort((left, right) => left.availableBalance - right.availableBalance);
    return rows;
  }, [balances.data]);

  const lowEmployeeCount = useMemo(
    () => new Set(lowBalances.map((balance) => balance.employeeId)).size,
    [lowBalances],
  );

  if (!organization) return <NoOrganization />;

  const pendingRows = pending.data?.data ?? [];
  const activeTypes = types.data?.data ?? [];
  const activeBalanceTypes = activeTypes.filter((type) => type.requiresBalance);
  const errors = [pending.error, approved.error, types.error, balances.error].filter(
    (value): value is string => Boolean(value),
  );

  const retryAll = () => {
    pending.reload();
    approved.reload();
    types.reload();
    balances.reload();
  };

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={`${organization.name} · ${organization.timezone}`}
        title="Leave"
        description="Review pending requests, track accruals, and keep leave policies and the organization holiday calendar up to date."
        actions={
          <Button variant="secondary" onClick={retryAll}>
            Refresh
          </Button>
        }
      />

      <LeaveTabs current="overview" />

      {errors.length > 0 ? (
        <ErrorState
          message={errors[0]}
          onRetry={retryAll}
        />
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Pending requests"
          value={pending.data?.meta.total ?? "—"}
          hint={
            pendingRows[0]
              ? `Oldest waiting since ${formatDateTime(pendingRows[0].submittedAt, organization.timezone)}`
              : "No requests waiting for review"
          }
          icon={<ClockIcon className="h-4 w-4" />}
        />
        <StatCard
          label="Approved requests"
          value={approved.data?.meta.total ?? "—"}
          hint="Approved requests in this organization"
          icon={<CheckSquareIcon className="h-4 w-4" />}
        />
        <StatCard
          label="Active leave types"
          value={types.data ? activeTypes.length : "—"}
          hint={
            types.data
              ? `${activeTypes.filter((type) => type.isPaid).length} paid · ${activeTypes.filter((type) => !type.isPaid).length} unpaid · ${activeBalanceTypes.length} balance-based`
              : "Loading catalog"
          }
          icon={<CalendarIcon className="h-4 w-4" />}
        />
        <StatCard
          label="Low balances"
          value={canManage ? (balances.data ? lowEmployeeCount : "—") : "—"}
          hint={
            canManage
              ? balances.data
                ? `Employees with ${LOW_BALANCE_THRESHOLD} days or less available${balances.data.truncated ? " · scan capped" : ""}`
                : "Loading balances"
              : "Requires leave:manage"
          }
          icon={<UsersIcon className="h-4 w-4" />}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
        <Card>
          <CardHeader
            title="Pending queue"
            description="The latest requests waiting for a decision."
            actions={
              <Link
                href="/admin/leave/requests"
                className="inline-flex items-center gap-1 text-xs font-medium text-ink-secondary underline decoration-line-strong underline-offset-4 hover:text-ink"
              >
                All requests
                <ArrowRightIcon className="h-3 w-3" />
              </Link>
            }
          />
          {pending.loading && !pending.data ? (
            <LoadingBlock label="Loading pending leave requests" />
          ) : pendingRows.length === 0 ? (
            <EmptyState
              title="No pending requests"
              description="New leave requests will appear here for review."
              icon={<CheckSquareIcon className="h-5 w-5" />}
            />
          ) : (
            <PendingTable requests={pendingRows} timezone={organization.timezone} />
          )}
        </Card>

        <Card>
          <CardHeader
            title="Low or zero balances"
            description={
              balances.data?.truncated
                ? `Balances at or below ${LOW_BALANCE_THRESHOLD} days from the first 1,000 balance records.`
                : `Available balance at or below ${LOW_BALANCE_THRESHOLD} days.`
            }
            actions={
              canManage ? (
                <Link
                  href="/admin/leave/balances"
                  className="inline-flex items-center gap-1 text-xs font-medium text-ink-secondary underline decoration-line-strong underline-offset-4 hover:text-ink"
                >
                  Balances
                  <ArrowRightIcon className="h-3 w-3" />
                </Link>
              ) : undefined
            }
          />
          {!canManage ? (
            <EmptyState
              title="Balance visibility requires leave:manage"
              description="Your role can review requests but cannot inspect employee balances."
            />
          ) : balances.loading && !balances.data ? (
            <LoadingBlock label="Loading employee balances" rows={4} />
          ) : lowBalances.length === 0 ? (
            <EmptyState
              title="No low balances"
              description={`Every active balance is above ${LOW_BALANCE_THRESHOLD} days.`}
              icon={<UsersIcon className="h-5 w-5" />}
            />
          ) : (
            <LowBalanceList balances={lowBalances.slice(0, 6)} />
          )}
        </Card>
      </div>

      {balances.data?.truncated ? (
        <Alert tone="warning" title="Balance scan capped">
          The overview scanned the first 1,000 balance records. Open the balances view and
          filter by employee or leave type for a complete list.
        </Alert>
      ) : null}
    </div>
  );
}

function PendingTable({
  requests,
  timezone,
}: {
  requests: LeaveRequest[];
  timezone: string;
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
                    {formatDateTime(request.submittedAt, timezone)}
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
            <Td className="tnum whitespace-nowrap">
              {formatLeaveUnits(request.units)}
            </Td>
            <Td>
              <StatusBadge status={request.status} />
            </Td>
          </tr>
        ))}
      </tbody>
    </TableShell>
  );
}

function LowBalanceList({ balances }: { balances: LeaveBalance[] }) {
  return (
    <ul className="divide-y divide-line">
      {balances.map((balance) => (
        <li
          key={balance.id}
          className="flex items-center gap-3 px-4 py-2.5 text-[13px]"
        >
          <Avatar name={balance.employee?.name ?? "Unknown"} size="sm" />
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium text-ink">
              {balance.employee?.name ?? "Unknown employee"}
            </p>
            <p className="truncate text-xs text-muted">
              {balance.leaveType?.name ?? "Leave"} · {balance.periodStart} –{" "}
              {balance.periodEnd}
            </p>
          </div>
          <Badge tone={isZeroBalance(balance) ? "danger" : "warning"}>
            {formatLeaveUnits(balance.availableBalance)} available
          </Badge>
        </li>
      ))}
    </ul>
  );
}
