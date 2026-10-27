"use client";

import Link from "next/link";
import { useState } from "react";
import { apiRequest } from "@/lib/api-client";
import { errorMessage, isApiError } from "@/lib/api-error";
import { formatDate, formatDateTime } from "@/lib/format";
import {
  platformActionLabel,
  platformActorLabel,
  platformAuditChange,
} from "@/lib/platform";
import type {
  Paginated,
  PlatformAuditEvent,
  PlatformOrganization,
} from "@/lib/types";
import { useApi } from "@/lib/use-api";
import { ArrowRightIcon, ShieldIcon } from "./icons";
import { Modal } from "./modal";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  DetailRow,
  EmptyState,
  ErrorState,
  Field,
  Input,
  LoadingBlock,
  PageHeader,
  StatusBadge,
} from "./ui";

function RenameForm({
  organization,
  onSaved,
}: {
  organization: PlatformOrganization;
  onSaved: (updated: PlatformOrganization) => void;
}) {
  const [name, setName] = useState(organization.name);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const readOnly = organization.status === "DELETED";
  const unchanged = name.trim() === organization.name;

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setFieldError(null);

    const trimmed = name.trim();
    if (trimmed.length < 2) {
      setFieldError("Name must be at least 2 characters.");
      return;
    }

    setLoading(true);
    try {
      const response = await apiRequest<{ data: PlatformOrganization }>(
        `/platform/organizations/${organization.id}`,
        { method: "PATCH", body: { name: trimmed } },
      );
      onSaved(response.data);
    } catch (caught) {
      if (isApiError(caught)) {
        setFieldError(caught.fieldError("name") ?? null);
      }
      setError(errorMessage(caught));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <CardHeader
        title="Rename organization"
        description="Only the display name changes. The organization ID, slug, memberships, sessions, attendance, evidence, settings, and audit history are preserved."
      />
      <form onSubmit={save} className="space-y-4 p-4">
        {readOnly ? (
          <Alert tone="info">
            This organization is soft-deleted and read-only. Restoring it is not available from
            this panel.
          </Alert>
        ) : null}
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
          <Field
            label="Display name"
            htmlFor="platform-org-name"
            error={fieldError}
            hint="At least 2 characters, up to 120."
            required
          >
            <Input
              id="platform-org-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              disabled={readOnly}
              maxLength={120}
              required
            />
          </Field>
          <Button
            type="submit"
            loading={loading}
            disabled={readOnly || unchanged || name.trim().length < 2}
          >
            Save name
          </Button>
        </div>
      </form>
    </Card>
  );
}

export function SuperadminOrganizationDetailView({
  organizationId,
}: {
  organizationId: string;
}) {
  const [override, setOverride] = useState<PlatformOrganization | null>(null);
  const [auditRefresh, setAuditRefresh] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [statusAction, setStatusAction] = useState<"SUSPEND" | "REACTIVATE" | null>(null);
  const [statusBusy, setStatusBusy] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [confirmationName, setConfirmationName] = useState("");
  const [password, setPassword] = useState("");
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteFieldErrors, setDeleteFieldErrors] = useState<Record<string, string>>({});

  const organization = useApi<{ data: PlatformOrganization }>(
    (signal) =>
      apiRequest(`/platform/organizations/${organizationId}`, { signal }),
    [organizationId],
  );

  const audit = useApi<Paginated<PlatformAuditEvent>>(
    (signal) =>
      apiRequest("/platform/audit-events", {
        signal,
        query: { organizationId, page: 1, limit: 8 },
      }),
    [organizationId, auditRefresh],
  );

  // Mutation responses already contain the updated record, so the page avoids
  // replacing itself with a loading skeleton after every action.
  const current = override ?? organization.data?.data;
  const events = audit.data?.data ?? [];
  const deleted = current?.status === "DELETED";
  const nameMismatch = confirmationName.length > 0 && confirmationName !== current?.name;

  function applyMutation(updated: PlatformOrganization) {
    setOverride(updated);
    setAuditRefresh((value) => value + 1);
  }

  function openDelete() {
    setConfirmationName("");
    setPassword("");
    setDeleteError(null);
    setDeleteFieldErrors({});
    setDeleteOpen(true);
  }

  async function confirmStatus() {
    if (!current || !statusAction) return;
    setStatusBusy(true);
    setStatusError(null);
    try {
      const response = await apiRequest<{ data: PlatformOrganization }>(
        `/platform/organizations/${current.id}/${
          statusAction === "SUSPEND" ? "suspend" : "reactivate"
        }`,
        { method: "POST" },
      );
      setNotice(
        statusAction === "SUSPEND"
          ? `${current.name} suspended. Members and agents lose access immediately; data is retained.`
          : `${current.name} reactivated. Members and agents can resume access.`,
      );
      setStatusAction(null);
      applyMutation(response.data);
    } catch (caught) {
      setStatusError(errorMessage(caught));
    } finally {
      setStatusBusy(false);
    }
  }

  async function confirmDelete(event?: React.FormEvent) {
    event?.preventDefault();
    if (!current) return;
    setDeleteBusy(true);
    setDeleteError(null);
    setDeleteFieldErrors({});
    try {
      const response = await apiRequest<{ data: PlatformOrganization }>(
        `/platform/organizations/${current.id}`,
        {
          method: "DELETE",
          body: { confirmationName, password },
        },
      );
      setDeleteOpen(false);
      setConfirmationName("");
      setPassword("");
      setNotice(
        `${current.name} soft-deleted. Access is revoked and all tenant data remains retained.`,
      );
      applyMutation(response.data);
    } catch (caught) {
      if (isApiError(caught)) {
        if (caught.code === "ORGANIZATION_NAME_MISMATCH") {
          setDeleteFieldErrors({ confirmationName: "The organization name does not match." });
        } else if (caught.code === "REAUTH_FAILED") {
          setDeleteFieldErrors({ password: "Password confirmation failed." });
        }
      }
      setDeleteError(errorMessage(caught));
    } finally {
      setDeleteBusy(false);
    }
  }

  if (organization.error) {
    return (
      <div className="space-y-4">
        <BackLink />
        <ErrorState message={organization.error} onRetry={organization.reload} />
      </div>
    );
  }

  if (!current) {
    return (
      <div className="space-y-4">
        <BackLink />
        <Card>
          <LoadingBlock rows={4} label="Loading organization" />
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <BackLink />

      <PageHeader
        eyebrow={current.slug}
        title={current.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge status={current.status} />
            <span className="font-mono text-[11px] text-muted">{current.id}</span>
          </span>
        }
      />

      {notice ? <Alert tone="success">{notice}</Alert> : null}

      <Card>
        <CardHeader
          title="Organization record"
          description="Stable identifiers and usage counts across all memberships, including suspended memberships."
        />
        <CardBody className="py-2">
          <dl>
            <DetailRow
              label="Stable ID"
              value={<span className="break-all font-mono text-xs">{current.id}</span>}
            />
            <DetailRow
              label="Slug"
              value={<span className="font-mono text-xs">{current.slug}</span>}
            />
            <DetailRow label="Status" value={<StatusBadge status={current.status} />} />
            <DetailRow label="Timezone" value={current.timezone} />
            <DetailRow
              label="Members"
              value={`${current.memberCount} total · ${current.activeMemberCount} active`}
            />
            <DetailRow label="Created" value={formatDate(current.createdAt)} />
            <DetailRow label="Updated" value={formatDateTime(current.updatedAt)} />
            {current.deletedAt ? (
              <DetailRow label="Deleted" value={formatDateTime(current.deletedAt)} />
            ) : null}
          </dl>
        </CardBody>
      </Card>

      <RenameForm
        key={current.id}
        organization={current}
        onSaved={(updated) => {
          applyMutation(updated);
          setNotice(
            `${updated.name} renamed. The stable ID, slug, and all relationships are unchanged.`,
          );
        }}
      />

      <Card>
        <CardHeader
          title="Access and retention"
          description="Suspension is enforced by the backend for every organization-scoped request, agent connection, and signed evidence link."
        />
        <CardBody className="space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="flex items-center gap-2 text-[13px] font-medium text-ink">
                {current.status === "ACTIVE" ? "Access is active" : "Access is blocked"}
                <StatusBadge status={current.status} />
              </p>
              <p className="mt-1 max-w-2xl text-xs leading-5 text-muted">
                {current.status === "ACTIVE"
                  ? "Suspending revokes access immediately for members, desktop agents, realtime connections, and previously issued evidence links. Sessions and all tenant data are retained."
                  : current.status === "SUSPENDED"
                    ? "Members, desktop agents, and evidence links are blocked. Reactivating restores access; agents may need to reconnect."
                    : "This organization is soft-deleted. Access is blocked permanently from this panel. All tenant data and audit history are retained for recovery or compliance."}
              </p>
            </div>
            {!deleted ? (
              <Button
                variant={current.status === "ACTIVE" ? "secondary" : "primary"}
                onClick={() => {
                  setStatusError(null);
                  setStatusAction(current.status === "ACTIVE" ? "SUSPEND" : "REACTIVATE");
                }}
              >
                {current.status === "ACTIVE" ? "Suspend organization" : "Reactivate organization"}
              </Button>
            ) : null}
          </div>

          <div className="rounded-lg border border-danger-border bg-danger-surface p-3.5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[13px] font-semibold text-danger">Delete organization</p>
                <p className="mt-1 max-w-2xl text-xs leading-5 text-danger/90">
                  This is a soft delete, not a data purge. It cannot be undone from this panel.
                  No tenant rows or stored files are erased.
                </p>
              </div>
              {deleted ? (
                <Badge tone="danger">Already deleted</Badge>
              ) : (
                <Button variant="danger" onClick={openDelete}>
                  Delete organization
                </Button>
              )}
            </div>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Platform audit events"
          description="Actor, action, target organization, and before/after values. Credentials, tokens, and private evidence URLs are never recorded here."
          actions={
            <Link
              href={`/superadmin/audit-log?organizationId=${current.id}`}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line-strong bg-surface px-2.5 text-xs font-medium text-ink transition-colors hover:bg-surface-muted"
            >
              View all
              <ArrowRightIcon className="h-3.5 w-3.5" />
            </Link>
          }
        />
        {audit.error ? (
          <div className="p-4">
            <ErrorState message={audit.error} onRetry={audit.reload} />
          </div>
        ) : audit.loading && !audit.data ? (
          <LoadingBlock rows={3} label="Loading audit events" />
        ) : events.length === 0 ? (
          <EmptyState
            title="No platform audit events"
            description="Renames, suspensions, reactivations, and deletions will appear here."
            icon={<ShieldIcon className="h-5 w-5" />}
          />
        ) : (
          <ul className="divide-y divide-line">
            {events.map((event) => (
              <li
                key={event.id}
                className="flex flex-wrap items-start justify-between gap-2 px-4 py-2.5"
              >
                <div className="min-w-0">
                  <p className="text-[13px] font-medium text-ink">
                    {platformActionLabel(event.action)}
                  </p>
                  <p className="text-xs text-muted">{platformAuditChange(event)}</p>
                  <p className="mt-0.5 text-[11px] text-muted">
                    {platformActorLabel(event)}
                  </p>
                </div>
                <time
                  className="whitespace-nowrap text-[11px] text-muted"
                  dateTime={event.createdAt}
                >
                  {formatDateTime(event.createdAt)}
                </time>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Modal
        open={statusAction !== null}
        onClose={() => {
          if (!statusBusy) setStatusAction(null);
        }}
        dismissible={!statusBusy}
        title={
          statusAction === "SUSPEND"
            ? `Suspend ${current.name}?`
            : `Reactivate ${current.name}?`
        }
        description={
          statusAction === "SUSPEND"
            ? "All organization-scoped access is blocked immediately. No data is deleted."
            : "Members and agents can resume access immediately."
        }
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => setStatusAction(null)}
              disabled={statusBusy}
            >
              Cancel
            </Button>
            <Button
              variant={statusAction === "SUSPEND" ? "danger" : "primary"}
              loading={statusBusy}
              onClick={confirmStatus}
            >
              {statusAction === "SUSPEND" ? "Suspend organization" : "Reactivate organization"}
            </Button>
          </>
        }
      >
        {statusError ? <Alert tone="danger">{statusError}</Alert> : null}
      </Modal>

      <Modal
        open={deleteOpen}
        onClose={() => {
          if (!deleteBusy) setDeleteOpen(false);
        }}
        dismissible={!deleteBusy}
        size="lg"
        title={`Delete ${current.name}?`}
        description="This is a high-risk action and requires your password."
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => setDeleteOpen(false)}
              disabled={deleteBusy}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="danger"
              loading={deleteBusy}
              onClick={() => confirmDelete()}
              disabled={
                confirmationName !== current.name || password.length === 0
              }
            >
              Delete organization
            </Button>
          </>
        }
      >
        <form id="platform-delete-form" onSubmit={confirmDelete} className="space-y-4">
          <Alert tone="warning" title="Tenant data is preserved">
            <ul className="list-disc space-y-1 pl-4">
              <li>
                All members, desktop agents, realtime connections, and signed evidence links
                lose access immediately.
              </li>
              <li>
                Memberships, users, sessions, attendance, evidence files, settings, and audit
                history are retained.
              </li>
              <li>
                The organization cannot be reactivated from this panel. Recovery requires
                engineering intervention.
              </li>
              <li>The organization ID and slug are preserved and are not reused.</li>
            </ul>
          </Alert>

          {deleteError ? <Alert tone="danger">{deleteError}</Alert> : null}

          <Field
            label={`Type the organization name (${current.name}) to confirm`}
            htmlFor="platform-delete-name"
            error={
              nameMismatch
                ? "The name does not match exactly."
                : deleteFieldErrors.confirmationName ?? null
            }
            required
          >
            <Input
              id="platform-delete-name"
              data-autofocus
              value={confirmationName}
              onChange={(event) => setConfirmationName(event.target.value)}
              autoComplete="off"
              disabled={deleteBusy}
              required
            />
          </Field>

          <Field
            label="Your password"
            htmlFor="platform-delete-password"
            error={deleteFieldErrors.password ?? null}
            hint="Step-up confirmation. The password is verified by the backend inside the deletion transaction and is never stored in audit metadata."
            required
          >
            <Input
              id="platform-delete-password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              disabled={deleteBusy}
              required
            />
          </Field>
        </form>
      </Modal>
    </div>
  );
}

function BackLink() {
  return (
    <Link
      href="/superadmin"
      className="inline-flex items-center gap-1.5 text-xs font-medium text-muted transition-colors hover:text-ink"
    >
      <ArrowRightIcon className="h-3.5 w-3.5 rotate-180" />
      All organizations
    </Link>
  );
}
