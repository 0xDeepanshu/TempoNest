"use client";

import Link from "next/link";
import { useState } from "react";
import { apiRequest } from "@/lib/api-client";
import { formatDateTime } from "@/lib/format";
import {
  PLATFORM_ACTION_LABELS,
  platformActorLabel,
  platformAuditChange,
} from "@/lib/platform";
import type {
  Paginated,
  PlatformAuditAction,
  PlatformAuditEvent,
} from "@/lib/types";
import { useApi } from "@/lib/use-api";
import { ShieldIcon } from "./icons";
import {
  Alert,
  Badge,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  LoadingBlock,
  PageHeader,
  Pagination,
  Select,
  TableShell,
  Td,
  Th,
} from "./ui";

type ActionFilter = PlatformAuditAction | "ALL";

const ACTION_TONES: Record<
  PlatformAuditAction,
  "neutral" | "warning" | "success" | "danger"
> = {
  ORGANIZATION_RENAMED: "neutral",
  ORGANIZATION_SUSPENDED: "warning",
  ORGANIZATION_REACTIVATED: "success",
  ORGANIZATION_SOFT_DELETED: "danger",
};

export function SuperadminAuditView({
  initialOrganizationId,
}: {
  initialOrganizationId?: string;
}) {
  const [action, setAction] = useState<ActionFilter>("ALL");
  const [page, setPage] = useState(1);

  const audit = useApi<Paginated<PlatformAuditEvent>>(
    (signal) =>
      apiRequest("/platform/audit-events", {
        signal,
        query: {
          page,
          limit: 20,
          organizationId: initialOrganizationId || undefined,
          action: action === "ALL" ? undefined : action,
        },
      }),
    [initialOrganizationId, action, page],
  );

  const rows = audit.data?.data ?? [];
  const organizationName = rows[0]?.organization.name;

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Platform administration"
        title="Audit log"
        description="Append-only record of platform actions. Each entry stores the actor, action, target organization, before/after values, IP address, and user agent."
      />

      {initialOrganizationId ? (
        <Alert tone="info">
          Showing events for{" "}
          <strong className="font-semibold">
            {organizationName ?? `organization ${initialOrganizationId}`}
          </strong>
          .{" "}
          <Link href="/superadmin/audit-log" className="underline underline-offset-2">
            Clear organization filter
          </Link>
        </Alert>
      ) : null}

      <Card>
        <CardHeader
          title="Platform events"
          description={
            audit.data
              ? `${audit.data.meta.total} event${audit.data.meta.total === 1 ? "" : "s"}`
              : "Loading events…"
          }
          actions={
            <Select
              aria-label="Filter by action"
              value={action}
              onChange={(event) => {
                setAction(event.target.value as ActionFilter);
                setPage(1);
              }}
              className="w-52"
            >
              <option value="ALL">All actions</option>
              {(Object.keys(PLATFORM_ACTION_LABELS) as PlatformAuditAction[]).map(
                (value) => (
                  <option key={value} value={value}>
                    {PLATFORM_ACTION_LABELS[value]}
                  </option>
                ),
              )}
            </Select>
          }
        />

        {audit.error ? (
          <div className="p-4">
            <ErrorState message={audit.error} onRetry={audit.reload} />
          </div>
        ) : audit.loading && !audit.data ? (
          <LoadingBlock rows={5} label="Loading platform audit events" />
        ) : rows.length === 0 ? (
          <EmptyState
            title="No audit events"
            description="Platform actions matching this filter will appear here."
            icon={<ShieldIcon className="h-5 w-5" />}
          />
        ) : (
          <TableShell>
            <thead>
              <tr>
                <Th>Time</Th>
                <Th>Action</Th>
                <Th>Organization</Th>
                <Th>Actor</Th>
                <Th>Details</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((event) => (
                <tr key={event.id} className="hover:bg-surface-muted">
                  <Td className="whitespace-nowrap text-xs">
                    <time dateTime={event.createdAt}>
                      {formatDateTime(event.createdAt)}
                    </time>
                  </Td>
                  <Td>
                    <Badge tone={ACTION_TONES[event.action]}>
                      {PLATFORM_ACTION_LABELS[event.action]}
                    </Badge>
                  </Td>
                  <Td>
                    {event.organization.id ? (
                      <Link
                        href={`/superadmin/organizations/${event.organization.id}`}
                        className="font-medium text-ink hover:underline"
                      >
                        {event.organization.name}
                      </Link>
                    ) : (
                      <span className="font-medium text-ink">
                        {event.organization.name}
                      </span>
                    )}
                  </Td>
                  <Td className="text-xs">{platformActorLabel(event)}</Td>
                  <Td className="text-xs text-muted">{platformAuditChange(event)}</Td>
                </tr>
              ))}
            </tbody>
          </TableShell>
        )}

        <Pagination
          page={audit.data?.meta.page ?? page}
          totalPages={audit.data?.meta.totalPages ?? 1}
          onPageChange={setPage}
        />
      </Card>
    </div>
  );
}
