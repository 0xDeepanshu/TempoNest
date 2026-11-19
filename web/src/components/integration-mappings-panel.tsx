"use client";

import { useState } from "react";
import { apiRequest } from "@/lib/api-client";
import { errorMessage } from "@/lib/api-error";
import { formatDate } from "@/lib/format";
import type { MembershipSummary, Paginated, PaginationMeta } from "@/lib/types";
import { useApi } from "@/lib/use-api";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  Pagination,
  TableShell,
  Td,
  Th,
} from "./ui";
import { UsersIcon } from "./icons";

// ---------------------------------------------------------------------------
// Local types (mirror the backend's toConnectionView / toMappingView shapes)
// ---------------------------------------------------------------------------

type ConnectionSummary = {
  id: string;
  status: "ACTIVE" | "DISCONNECTED" | "REVOKED";
  client: { name: string; description: string } | null;
  externalOrganizationId: string | null;
  connectedAt: string | null;
};

type MappingStatus = "PENDING" | "ACTIVE" | "CONFLICT" | "REVOKED";

type MappingView = {
  id: string;
  connectionId: string;
  externalEmployeeId: string;
  externalEmployeeEmail: string;
  status: MappingStatus;
  matchMethod: string | null;
  conflictReason: string | null;
  employee: { id: string; name: string; email: string } | null;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type MappingsResponse = { data: MappingView[]; meta: PaginationMeta };
type ConnectionsResponse = { data: ConnectionSummary[]; meta: PaginationMeta };
type MemberSearchResult = { data: { userId: string; user: { name: string; email: string } }[] };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function conflictLabel(reason: string | null): string {
  if (!reason) return "—";
  if (reason === "MANUAL_APPROVAL_REQUIRED") return "Awaiting approval";
  if (reason === "EMPLOYEE_NOT_FOUND") return "No WorkZen account found";
  if (reason === "ALREADY_MAPPED") return "Already mapped elsewhere";
  return reason;
}

function statusTone(status: MappingStatus): "warning" | "success" | "danger" | "neutral" {
  if (status === "PENDING") return "warning";
  if (status === "ACTIVE") return "success";
  if (status === "CONFLICT") return "danger";
  return "neutral";
}

// ---------------------------------------------------------------------------
// Row-level action buttons
// ---------------------------------------------------------------------------

function MappingRow({
  mapping,
  organizationId,
  onResolved,
  timezone,
}: {
  mapping: MappingView;
  organizationId: string;
  onResolved: () => void;
  timezone: string;
}) {
  const [busy, setBusy] = useState<"link" | "reject" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canAct = mapping.status === "PENDING" || mapping.status === "CONFLICT";
  const canLink =
    canAct && mapping.conflictReason !== "EMPLOYEE_NOT_FOUND" && mapping.conflictReason !== "ALREADY_MAPPED";
  const isRevoked = mapping.status === "REVOKED";

  async function findMemberByEmail(): Promise<string | null> {
    const search: MemberSearchResult = await apiRequest(
      `/organizations/${organizationId}/members`,
      { query: { q: mapping.externalEmployeeEmail, limit: 10 } },
    );
    const match = search.data.find(
      (m) => m.user.email.toLowerCase() === mapping.externalEmployeeEmail.toLowerCase(),
    );
    return match?.userId ?? null;
  }

  async function link() {
    if (
      !window.confirm(
        `Link Flowtrium account ${mapping.externalEmployeeEmail} to WorkZen?\n\n` +
          "This will make their time-tracking data visible in Flowtrium.",
      )
    ) {
      return;
    }
    setBusy("link");
    setError(null);
    try {
      const userId = await findMemberByEmail();
      if (!userId) {
        setError(
          `No active WorkZen account found for ${mapping.externalEmployeeEmail}. ` +
            "Ask them to sign in to WorkZen first.",
        );
        return;
      }
      await apiRequest(
        `/organizations/${organizationId}/integrations/connections/${mapping.connectionId}/mappings/${mapping.id}/resolve`,
        { method: "POST", body: { action: "LINK", workzenUserId: userId } },
      );
      onResolved();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(null);
    }
  }

  async function relink() {
    if (
      !window.confirm(
        `Re-link ${mapping.externalEmployeeEmail}?\n\n` +
          "This overrides the previous rejection and links the account directly.",
      )
    ) {
      return;
    }
    setBusy("link");
    setError(null);
    try {
      const userId = await findMemberByEmail();
      if (!userId) {
        setError(
          `No active WorkZen account found for ${mapping.externalEmployeeEmail}. ` +
            "Ask them to sign in to WorkZen first.",
        );
        return;
      }
      // createManualMapping updates a REVOKED row to ACTIVE directly.
      await apiRequest(
        `/organizations/${organizationId}/integrations/connections/${mapping.connectionId}/mappings`,
        {
          method: "POST",
          body: {
            externalEmployeeId: mapping.externalEmployeeId,
            externalEmployeeEmail: mapping.externalEmployeeEmail,
            workzenUserId: userId,
          },
        },
      );
      onResolved();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(null);
    }
  }

  async function reject() {
    if (
      !window.confirm(
        `Reject the mapping request for ${mapping.externalEmployeeEmail}? ` +
          "Use Re-link later if you change your mind.",
      )
    ) {
      return;
    }
    setBusy("reject");
    setError(null);
    try {
      await apiRequest(
        `/organizations/${organizationId}/integrations/connections/${mapping.connectionId}/mappings/${mapping.id}/resolve`,
        { method: "POST", body: { action: "REJECT" } },
      );
      onResolved();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(null);
    }
  }

  return (
    <tr className="hover:bg-surface-muted">
      <Td>
        <p className="font-mono text-xs text-ink-secondary">{mapping.externalEmployeeId}</p>
      </Td>
      <Td>
        <p className="text-sm text-ink">{mapping.externalEmployeeEmail}</p>
      </Td>
      <Td>
        <Badge tone={statusTone(mapping.status)}>{mapping.status}</Badge>
      </Td>
      <Td className="text-xs text-muted">
        {conflictLabel(mapping.conflictReason)}
      </Td>
      <Td className="text-xs text-muted">
        {formatDate(mapping.createdAt, timezone)}
      </Td>
      <Td className="text-right">
        {canAct || isRevoked ? (
          <div className="space-y-1">
            <div className="flex flex-wrap justify-end gap-1.5">
              {isRevoked ? (
                <Button
                  size="sm"
                  variant="secondary"
                  loading={busy === "link"}
                  disabled={Boolean(busy)}
                  onClick={relink}
                >
                  Re-link
                </Button>
              ) : canLink ? (
                <Button
                  size="sm"
                  variant="secondary"
                  loading={busy === "link"}
                  disabled={Boolean(busy)}
                  onClick={link}
                >
                  Link
                </Button>
              ) : null}
              {canAct ? (
                <Button
                  size="sm"
                  variant="danger"
                  loading={busy === "reject"}
                  disabled={Boolean(busy)}
                  onClick={reject}
                >
                  Reject
                </Button>
              ) : null}
            </div>
            {error ? <p className="text-right text-[11px] text-danger">{error}</p> : null}
          </div>
        ) : (
          <span className="text-[11px] text-muted">
            {mapping.status === "ACTIVE" ? "Linked" : "—"}
          </span>
        )}
      </Td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Mappings list for one connection
// ---------------------------------------------------------------------------

function ConnectionMappings({
  connection,
  organizationId,
  timezone,
}: {
  connection: ConnectionSummary;
  organizationId: string;
  timezone: string;
}) {
  const [page, setPage] = useState(1);
  const [refreshKey, setRefreshKey] = useState(0);

  const mappings = useApi<MappingsResponse>(
    (signal) =>
      apiRequest(
        `/organizations/${organizationId}/integrations/connections/${connection.id}/mappings`,
        // Fetch everything that needs attention: PENDING, CONFLICT (actionable) and REVOKED (re-linkable).
        { signal, query: { page, limit: 20 } },
      ),
    [organizationId, connection.id, page, refreshKey],
  );

  // Show only rows that need attention: pending approval, conflicted, or previously rejected.
  const rows = (mappings.data?.data ?? []).filter((m) => m.status !== "ACTIVE");

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 px-4 pt-4">
        <Badge tone="success">Connected</Badge>
        <span className="text-xs text-muted">
          {connection.client?.name ?? "Flowtrium"}
          {connection.externalOrganizationId
            ? ` · org ${connection.externalOrganizationId}`
            : null}
        </span>
      </div>

      {mappings.error ? (
        <div className="px-4 pb-4">
          <ErrorState message={mappings.error} onRetry={mappings.reload} />
        </div>
      ) : rows.length === 0 && !mappings.loading ? (
        <EmptyState
          title="No pending mapping requests"
          description="When Flowtrium submits employee link requests they appear here. Rejected requests can be re-linked at any time."
          icon={<UsersIcon className="h-5 w-5" />}
        />
      ) : (
        <>
          <TableShell>
            <thead>
              <tr>
                <Th>Flowtrium ID</Th>
                <Th>Email</Th>
                <Th>Status</Th>
                <Th>Reason</Th>
                <Th>Received</Th>
                <Th className="text-right">Actions</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((mapping) => (
                <MappingRow
                  key={mapping.id}
                  mapping={mapping}
                  organizationId={organizationId}
                  onResolved={() => setRefreshKey((k) => k + 1)}
                  timezone={timezone}
                />
              ))}
            </tbody>
          </TableShell>
          <Pagination
            page={mappings.data?.meta.page ?? page}
            totalPages={mappings.data?.meta.totalPages ?? 1}
            onPageChange={setPage}
          />
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Public panel — added to OrganizationView
// ---------------------------------------------------------------------------

/**
 * Shows pending Flowtrium → WorkZen employee mapping requests for all active
 * integration connections. Only rendered when the user has organization:update
 * access (Owner / Admin); the backend enforces integration:manage on each call.
 */
export function IntegrationMappingsPanel({
  organizationId,
  actor,
  timezone,
}: {
  organizationId: string;
  actor: MembershipSummary;
  timezone: string;
}) {
  const connections = useApi<ConnectionsResponse>(
    (signal) =>
      apiRequest(`/organizations/${organizationId}/integrations/connections`, {
        signal,
        query: { status: "ACTIVE", page: 1, limit: 10 },
      }),
    [organizationId],
  );

  const activeConnections = (connections.data?.data ?? []).filter((c) => c.status === "ACTIVE");

  // Don't render anything if there are no active connections and the data has
  // settled — no connection means nothing to review.
  if (!connections.loading && !connections.error && activeConnections.length === 0) {
    return null;
  }

  return (
    <Card>
      <CardHeader
        title="Flowtrium employee links"
        description="Review pending requests to link Flowtrium employee accounts to WorkZen. Each link must be approved here before attendance data is shared."
      />

      {connections.loading && !connections.data ? (
        <div className="p-4">
          <div className="h-20 animate-pulse rounded-lg bg-surface-muted" />
        </div>
      ) : connections.error ? (
        <div className="p-4">
          <Alert tone="danger">{connections.error}</Alert>
        </div>
      ) : (
        activeConnections.map((connection) => (
          <ConnectionMappings
            key={connection.id}
            connection={connection}
            organizationId={organizationId}
            timezone={timezone}
          />
        ))
      )}
    </Card>
  );
}
