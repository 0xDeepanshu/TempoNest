"use client";

import Link from "next/link";
import { useState } from "react";
import { apiRequest } from "@/lib/api-client";
import { formatDate } from "@/lib/format";
import { hasPermission } from "@/lib/permissions";
import type { MemberListItem, Paginated, Role } from "@/lib/types";
import { useApi } from "@/lib/use-api";
import { ArrowRightIcon, SearchIcon, UsersIcon } from "./icons";
import {
  Avatar,
  Button,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  Field,
  Input,
  MembershipStatusBadge,
  PageHeader,
  Pagination,
  RoleBadge,
  Select,
  StatusBadge,
  TableShell,
  Td,
  Th,
} from "./ui";
import { NoOrganization, useWorkspace } from "./workspace";

export function EmployeesView() {
  const { organization, membership } = useWorkspace();
  const organizationId = organization?.id ?? "";
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [role, setRole] = useState<"" | Role>("");
  const [status, setStatus] = useState<"" | "ACTIVE" | "SUSPENDED" | "REMOVED">("");
  const [page, setPage] = useState(1);

  const members = useApi<Paginated<MemberListItem>>(
    (signal) =>
      apiRequest(`/organizations/${organizationId}/members`, {
        signal,
        query: { page, limit: 20, q: search, role, status },
      }),
    [organizationId, page, search, role, status],
    { enabled: Boolean(organizationId) },
  );

  if (!organization) return <NoOrganization />;
  const rows = members.data?.data ?? [];

  function applyFilters(event: React.FormEvent) {
    event.preventDefault();
    setSearch(query.trim());
    setPage(1);
  }

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={`${organization.name} · ${organization.timezone}`}
        title="People"
        description="Employee directory with membership and account status. Open a profile for current tracking and a recent activity summary; use Reports for date-range analysis."
        actions={
          hasPermission(membership?.role, "report:read") ? (
            <Link href="/admin/reports">
              <Button variant="secondary">Open reports</Button>
            </Link>
          ) : undefined
        }
      />

      <Card>
        <form onSubmit={applyFilters} className="grid gap-3 p-4 lg:grid-cols-[1fr_170px_170px_auto] lg:items-end">
          <Field label="Search" htmlFor="member-search">
            <div className="relative">
              <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
              <Input
                id="member-search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Name or email"
                className="pl-9"
              />
            </div>
          </Field>
          <Field label="Role" htmlFor="member-role">
            <Select
              id="member-role"
              value={role}
              onChange={(event) => {
                setRole(event.target.value as "" | Role);
                setPage(1);
              }}
            >
              <option value="">All roles</option>
              <option value="OWNER">Owner</option>
              <option value="ADMIN">Admin</option>
              <option value="MANAGER">Manager</option>
              <option value="EMPLOYEE">Employee</option>
            </Select>
          </Field>
          <Field label="Status" htmlFor="member-status">
            <Select
              id="member-status"
              value={status}
              onChange={(event) => {
                setStatus(event.target.value as typeof status);
                setPage(1);
              }}
            >
              <option value="">All statuses</option>
              <option value="ACTIVE">Active</option>
              <option value="SUSPENDED">Suspended</option>
              <option value="REMOVED">Removed</option>
            </Select>
          </Field>
          <Button type="submit">Apply</Button>
        </form>
      </Card>

      {members.error ? <ErrorState message={members.error} onRetry={members.reload} /> : null}

      <Card>
        <CardHeader
          title="Members"
          description={
            members.data ? `${members.data.meta.total} membership${members.data.meta.total === 1 ? "" : "s"}` : "Loading…"
          }
          actions={
            <Link href="/admin/organization" className="text-xs font-medium text-ink-secondary underline decoration-line-strong underline-offset-4 hover:text-ink">
              Manage members
            </Link>
          }
        />
        {rows.length === 0 && !members.loading ? (
          <EmptyState
            title="No members match"
            description="Try a different search, role, or status."
            icon={<UsersIcon className="h-5 w-5" />}
          />
        ) : (
          <>
            <TableShell>
              <thead>
                <tr>
                  <Th>Member</Th>
                  <Th>Role</Th>
                  <Th>Status</Th>
                  <Th>Joined</Th>
                  <Th className="text-right"> </Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((member) => (
                  <tr key={member.id} className="hover:bg-surface-muted">
                    <Td>
                      <div className="flex items-center gap-2.5">
                        <Avatar name={member.user.name} size="sm" />
                        <div className="min-w-0">
                          <p className="truncate font-medium text-ink">{member.user.name}</p>
                          <p className="truncate text-xs text-muted">{member.user.email}</p>
                        </div>
                      </div>
                    </Td>
                    <Td>
                      <RoleBadge role={member.role} />
                    </Td>
                    <Td>
                      <div className="flex flex-wrap items-center gap-1">
                        <MembershipStatusBadge status={member.status} />
                        <StatusBadge status={member.user.status} />
                      </div>
                    </Td>
                    <Td className="text-xs text-muted">{formatDate(member.createdAt, organization.timezone)}</Td>
                    <Td className="text-right">
                      <Link
                        href={`/admin/employees/${member.userId}`}
                        className="inline-flex items-center gap-1 text-xs font-medium text-ink underline decoration-line-strong underline-offset-4 hover:decoration-ink"
                      >
                        View
                        <ArrowRightIcon className="h-3 w-3" />
                      </Link>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </TableShell>
            <Pagination
              page={members.data?.meta.page ?? page}
              totalPages={members.data?.meta.totalPages ?? 1}
              onPageChange={setPage}
            />
          </>
        )}
      </Card>
    </div>
  );
}
