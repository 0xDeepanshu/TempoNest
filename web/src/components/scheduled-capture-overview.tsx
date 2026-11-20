"use client";

import { apiRequest } from "@/lib/api-client";
import { formatDateTime } from "@/lib/format";
import type { ScheduledCaptureOverviewResponse } from "@/lib/types";
import { useApi } from "@/lib/use-api";
import { CameraIcon } from "./icons";
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  ErrorState,
  LoadingBlock,
  PageHeader,
  TableShell,
  Td,
  Th,
} from "./ui";
import { NoOrganization, useWorkspace } from "./workspace";

function statusFor(employee: ScheduledCaptureOverviewResponse["data"]["employees"][number]) {
  if (employee.scheduledCaptureActive) {
    return { label: "Active", tone: "success" as const };
  }
  if (employee.scheduledCaptureEnabled) {
    return { label: "Paused", tone: "warning" as const };
  }
  return { label: "Never", tone: "neutral" as const };
}

/**
 * Organization-wide view of the per-employee scheduled capture switch.
 *
 * Only employees with the dedicated monitoring permission reach this page.
 * It lists every active member, including those left on "Never", so owners
 * and administrators can see who is actually captured automatically.
 */
export function ScheduledCaptureOverviewView() {
  const { organization } = useWorkspace();
  const organizationId = organization?.id ?? "";
  const overview = useApi<ScheduledCaptureOverviewResponse>(
    (signal) =>
      apiRequest(`/admin/scheduled-capture`, {
        signal,
        headers: { "X-Organization-Id": organizationId },
      }),
    [organizationId],
    { enabled: Boolean(organizationId) },
  );

  if (!organization) return <NoOrganization />;

  const employees = [...(overview.data?.data.employees ?? [])].sort((left, right) => {
    const rank = (value: { scheduledCaptureActive: boolean; scheduledCaptureEnabled: boolean }) =>
      value.scheduledCaptureActive ? 0 : value.scheduledCaptureEnabled ? 1 : 2;
    return rank(left) - rank(right) || left.name.localeCompare(right.name);
  });
  const activeCount = employees.filter((employee) => employee.scheduledCaptureActive).length;
  const scheduledCount = employees.filter(
    (employee) => employee.scheduledCaptureEnabled,
  ).length;

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={organization.name}
        title="Scheduled screenshots"
        description="Who has automatic screenshots on, and how often they are taken."
      />

      {overview.loading && !overview.data ? (
        <Card>
          <LoadingBlock label="Loading scheduled capture overview" rows={4} />
        </Card>
      ) : overview.error && !overview.data ? (
        <ErrorState message={overview.error} onRetry={overview.reload} />
      ) : (
        <Card>
          <CardHeader
            title="Automatic screenshots"
            description={
              employees.length === 0
                ? "No active employees in this organization."
                : `${activeCount} of ${employees.length} employees take screenshots automatically · ${scheduledCount} have a schedule set.`
            }
          />
          <CardBody className="p-0">
            {employees.length === 0 ? (
              <EmptyState
                icon={<CameraIcon className="h-5 w-5" />}
                title="No employees yet"
                description="Invite employees, then their screenshot schedule shows up here."
              />
            ) : (
              <TableShell>
                <thead>
                  <tr>
                    <Th>Employee</Th>
                    <Th>Status</Th>
                    <Th>How often</Th>
                    <Th>Next screenshot</Th>
                    <Th>Last screenshot</Th>
                  </tr>
                </thead>
                <tbody>
                  {employees.map((employee) => {
                    const status = statusFor(employee);
                    return (
                      <tr key={employee.employeeId}>
                        <Td>
                          <p className="font-medium text-ink">{employee.name || "Unnamed employee"}</p>
                          <p className="text-xs text-muted">{employee.email}</p>
                        </Td>
                        <Td>
                          <Badge tone={status.tone}>{status.label}</Badge>
                        </Td>
                        <Td>
                          {employee.scheduledCaptureEnabled
                            ? `Every ${employee.captureIntervalMinutes} min`
                            : "Never"}
                        </Td>
                        <Td>
                          {employee.scheduledCaptureActive && employee.nextCaptureAt
                            ? formatDateTime(employee.nextCaptureAt, organization.timezone)
                            : "Never"}
                        </Td>
                        <Td>
                          {employee.lastCaptureAt
                            ? formatDateTime(employee.lastCaptureAt, organization.timezone)
                            : "None yet"}
                        </Td>
                      </tr>
                    );
                  })}
                </tbody>
              </TableShell>
            )}
          </CardBody>
        </Card>
      )}

      <p className="text-xs leading-5 text-muted">
        Scheduled screenshots consume additional storage and database resources. Change an
        employee&apos;s interval from their profile under People.
      </p>
    </div>
  );
}
