"use client";

import Link from "next/link";
import { useState } from "react";
import { apiRequest } from "@/lib/api-client";
import { errorMessage } from "@/lib/api-error";
import { formatDate } from "@/lib/format";
import type {
  Paginated,
  PlatformOrganization,
  PlatformOrganizationStatus,
  PlatformOverview,
} from "@/lib/types";
import { useApi } from "@/lib/use-api";
import { BuildingIcon, CloseIcon, SearchIcon } from "./icons";
import { Modal } from "./modal";
import {
  Alert,
  Button,
  Card,
  CardHeader,
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
  Th,
} from "./ui";

type StatusFilter = PlatformOrganizationStatus | "ALL";
type PendingAction = "SUSPEND" | "REACTIVATE";

const STATUS_FILTERS: Array<{ value: StatusFilter; label: string }> = [
  { value: "ALL", label: "All organizations" },
  { value: "ACTIVE", label: "Active" },
  { value: "SUSPENDED", label: "Suspended" },
  { value: "DELETED", label: "Deleted" },
];

function OverviewMetrics({ overview }: { overview: PlatformOverview | undefined }) {
  const metrics = [
    { label: "Total organizations", value: overview?.total, hint: "Includes deleted" },
    { label: "Active", value: overview?.active, hint: "Full access" },
    { label: "Suspended", value: overview?.suspended, hint: "Access blocked" },
    { label: "Deleted", value: overview?.deleted, hint: "Data retained" },
  ];

  return (
    <Card className="overflow-hidden">
      <div className="grid grid-cols-2 gap-px bg-line sm:grid-cols-4">
        {metrics.map((metric) => (
          <div key={metric.label} className="bg-surface px-4 py-3.5">
            <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
              {metric.label}
            </p>
            <p className="mt-1 text-[22px] font-semibold tnum tracking-tight text-ink">
              {metric.value ?? "—"}
            </p>
            <p className="text-[11px] text-muted">{metric.hint}</p>
          </div>
        ))}
      </div>
    </Card>
  );
}

export function SuperadminOrganizationsView() {
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StatusFilter>("ALL");
  const [page, setPage] = useState(1);
  const [refreshToken, setRefreshToken] = useState(0);
  const [pending, setPending] = useState<{
    organization: PlatformOrganization;
    action: PendingAction;
  } | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const overview = useApi<{ data: PlatformOverview }>(
    (signal) => apiRequest("/platform/overview", { signal }),
    [refreshToken],
  );

  const organizations = useApi<Paginated<PlatformOrganization>>(
    (signal) =>
      apiRequest("/platform/organizations", {
        signal,
        query: { page, limit: 20, status, q: search || undefined },
      }),
    [page, search, status, refreshToken],
  );

  const rows = organizations.data?.data ?? [];

  function reload() {
    setRefreshToken((value) => value + 1);
  }

  function applySearch(event: React.FormEvent) {
    event.preventDefault();
    setSearch(query.trim());
    setPage(1);
  }

  function clearSearch() {
    setQuery("");
    setSearch("");
    setPage(1);
  }

  async function confirmAction() {
    if (!pending) return;
    setActionBusy(true);
    setActionError(null);
    try {
      await apiRequest(
        `/platform/organizations/${pending.organization.id}/${
          pending.action === "SUSPEND" ? "suspend" : "reactivate"
        }`,
        { method: "POST" },
      );
      setNotice(
        `${pending.organization.name} ${
          pending.action === "SUSPEND" ? "suspended" : "reactivated"
        }.`,
      );
      setPending(null);
      reload();
    } catch (caught) {
      setActionError(errorMessage(caught));
    } finally {
      setActionBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Platform administration"
        title="Organizations"
        description="Manage every organization on this TempoNest instance. Suspension blocks access immediately. Deletion is a soft delete that preserves all tenant records and audit history."
      />

      {overview.error ? (
        <ErrorState message={overview.error} onRetry={overview.reload} />
      ) : overview.loading && !overview.data ? (
        <Card>
          <LoadingBlock rows={1} label="Loading platform overview" />
        </Card>
      ) : (
        <OverviewMetrics overview={overview.data?.data} />
      )}

      {notice ? <Alert tone="success">{notice}</Alert> : null}

      <Card>
        <CardHeader
          title="All organizations"
          description={
            organizations.data
              ? `${organizations.data.meta.total} organization${
                  organizations.data.meta.total === 1 ? "" : "s"
                }`
              : "Search by name, slug, or stable ID."
          }
        />
        <form
          onSubmit={applySearch}
          className="grid gap-3 border-b border-line p-4 sm:grid-cols-[1fr_180px_auto] sm:items-end"
        >
          <Field label="Search" htmlFor="platform-organization-search">
            <div className="relative">
              <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
              <Input
                id="platform-organization-search"
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Name, slug, or organization ID"
                className="pl-8 pr-8"
              />
              {query ? (
                <button
                  type="button"
                  onClick={clearSearch}
                  aria-label="Clear organization search"
                  className="absolute right-0 top-0 flex h-full w-8 items-center justify-center rounded-r-lg text-muted transition-colors hover:text-ink"
                >
                  <CloseIcon className="h-3.5 w-3.5" />
                </button>
              ) : null}
            </div>
          </Field>
          <Field label="Status" htmlFor="platform-organization-status">
            <Select
              id="platform-organization-status"
              value={status}
              onChange={(event) => {
                setStatus(event.target.value as StatusFilter);
                setPage(1);
              }}
            >
              {STATUS_FILTERS.map((filter) => (
                <option key={filter.value} value={filter.value}>
                  {filter.label}
                </option>
              ))}
            </Select>
          </Field>
          <div className="flex gap-2">
            <Button type="submit">Search</Button>
          </div>
        </form>

        {organizations.error ? (
          <div className="p-4">
            <ErrorState message={organizations.error} onRetry={organizations.reload} />
          </div>
        ) : organizations.loading && !organizations.data ? (
          <LoadingBlock rows={5} label="Loading organizations" />
        ) : rows.length === 0 ? (
          <EmptyState
            title="No organizations found"
            description="Try a different name, slug, ID, or status filter."
            icon={<BuildingIcon className="h-5 w-5" />}
          />
        ) : (
          <TableShell>
            <thead>
              <tr>
                <Th>Organization</Th>
                <Th>Created</Th>
                <Th>Members</Th>
                <Th>Status</Th>
                <Th className="text-right">Actions</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((organization) => {
                const deleted = organization.status === "DELETED";
                return (
                  <tr key={organization.id} className="hover:bg-surface-muted">
                    <Td>
                      <Link
                        href={`/superadmin/organizations/${organization.id}`}
                        className="font-medium text-ink hover:underline"
                      >
                        {organization.name}
                      </Link>
                      <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted">
                        <span className="font-mono text-[10px]" title={organization.id}>
                          {organization.id}
                        </span>
                        <span aria-hidden>·</span>
                        <span className="font-mono">{organization.slug}</span>
                      </p>
                    </Td>
                    <Td className="whitespace-nowrap text-xs">
                      {formatDate(organization.createdAt)}
                    </Td>
                    <Td className="whitespace-nowrap">
                      <span className="tnum text-ink">{organization.memberCount}</span>
                      <span className="ml-1.5 text-[11px] text-muted">
                        {organization.activeMemberCount} active
                      </span>
                    </Td>
                    <Td>
                      <StatusBadge status={organization.status} />
                    </Td>
                    <Td>
                      <div className="flex flex-wrap items-center justify-end gap-1.5">
                        <Link
                          href={`/superadmin/organizations/${organization.id}`}
                          className="inline-flex h-8 items-center rounded-lg border border-line-strong bg-surface px-2.5 text-xs font-medium text-ink transition-colors hover:bg-surface-muted"
                        >
                          Manage
                        </Link>
                        {deleted ? (
                          <span className="text-[11px] text-muted">Read-only</span>
                        ) : (
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => {
                              setActionError(null);
                              setPending({
                                organization,
                                action:
                                  organization.status === "ACTIVE"
                                    ? "SUSPEND"
                                    : "REACTIVATE",
                              });
                            }}
                          >
                            {organization.status === "ACTIVE" ? "Suspend" : "Reactivate"}
                          </Button>
                        )}
                      </div>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </TableShell>
        )}
        <Pagination
          page={organizations.data?.meta.page ?? page}
          totalPages={organizations.data?.meta.totalPages ?? 1}
          onPageChange={setPage}
        />
      </Card>

      <Modal
        open={Boolean(pending)}
        onClose={() => {
          if (!actionBusy) setPending(null);
        }}
        dismissible={!actionBusy}
        title={
          pending
            ? `${pending.action === "SUSPEND" ? "Suspend" : "Reactivate"} ${
                pending.organization.name
              }?`
            : "Update organization"
        }
        description={
          pending?.action === "SUSPEND"
            ? "Members, desktop agents, and previously issued evidence links lose access immediately. Sessions and all tenant data are retained."
            : "Members and desktop agents can resume access immediately. Agents may need to reconnect."
        }
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => setPending(null)}
              disabled={actionBusy}
            >
              Cancel
            </Button>
            <Button
              variant={pending?.action === "SUSPEND" ? "danger" : "primary"}
              loading={actionBusy}
              onClick={confirmAction}
            >
              {pending?.action === "SUSPEND" ? "Suspend organization" : "Reactivate organization"}
            </Button>
          </>
        }
      >
        {actionError ? <Alert tone="danger">{actionError}</Alert> : null}
        {pending ? (
          <dl className="space-y-2 text-xs text-ink-secondary">
            <div className="flex justify-between gap-3">
              <dt className="text-muted">Stable ID</dt>
              <dd className="max-w-[70%] break-all text-right font-mono text-[11px]">
                {pending.organization.id}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted">Members</dt>
              <dd className="text-right">
                {pending.organization.memberCount} total ·{" "}
                {pending.organization.activeMemberCount} active
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted">Current status</dt>
              <dd className="text-right">{pending.organization.status}</dd>
            </div>
          </dl>
        ) : null}
      </Modal>
    </div>
  );
}
