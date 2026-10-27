"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiRequest } from "@/lib/api-client";
import { errorMessage, isApiError } from "@/lib/api-error";
import { formatDate, formatDateTime, isValidTimezone } from "@/lib/format";
import {
  assignableRoles,
  canManageMember,
  hasPermission,
  invitableRoles,
} from "@/lib/permissions";
import type {
  Invitation,
  MemberListItem,
  Organization,
  OrganizationDetails,
  Paginated,
  Role,
} from "@/lib/types";
import { useApi } from "@/lib/use-api";
import { CopyIcon, PlusIcon, UsersIcon } from "./icons";
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
  MembershipStatusBadge,
  PageHeader,
  Pagination,
  RoleBadge,
  Select,
  TableShell,
  Tabs,
  Td,
  Th,
} from "./ui";
import { NoOrganization, useWorkspace } from "./workspace";

type InvitationStatusFilter = "pending" | "accepted" | "revoked" | "expired" | "all";

function invitationStatus(invitation: Invitation): {
  label: string;
  tone: "success" | "warning" | "danger" | "neutral";
} {
  if (invitation.acceptedAt) return { label: "Accepted", tone: "success" };
  if (invitation.revokedAt) return { label: "Revoked", tone: "neutral" };
  if (Date.parse(invitation.expiresAt) <= Date.now()) {
    return { label: "Expired", tone: "danger" };
  }
  return { label: "Pending", tone: "warning" };
}

function MemberRow({
  member,
  actorRole,
  actorUserId,
  timezone,
  onChanged,
}: {
  member: MemberListItem;
  actorRole: Role;
  actorUserId: string;
  timezone: string;
  onChanged: () => void;
}) {
  const currentRole = member.role;
  const roleOptions = assignableRoles(actorRole, currentRole);
  const [selectedRole, setSelectedRole] = useState<Role>(currentRole);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const canManage =
    canManageMember(actorRole, actorUserId, {
      userId: member.userId,
      role: member.role,
    }) && member.status !== "REMOVED";
  const canRemove =
    canManage && hasPermission(actorRole, "member:remove") && member.status !== "REMOVED";

  async function run(
    key: string,
    path: string,
    method: "PATCH" | "POST" | "DELETE",
    body?: unknown,
    confirmMessage?: string,
  ) {
    if (confirmMessage && !window.confirm(confirmMessage)) return;
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      await apiRequest(path, { method, body });
      setNotice("Membership updated.");
      onChanged();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(null);
    }
  }

  return (
    <tr className="hover:bg-surface-muted">
      <Td>
        <div className="flex items-center gap-2.5">
          <Avatar name={member.user.name} size="sm" />
          <div className="min-w-0">
            <p className="truncate font-medium text-ink">
              {member.user.name}
              {member.userId === actorUserId ? (
                <span className="ml-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted">
                  You
                </span>
              ) : null}
            </p>
            <p className="truncate text-xs text-muted">{member.user.email}</p>
          </div>
        </div>
      </Td>
      <Td>
        <div className="space-y-1.5">
          {canManage && roleOptions.length > 1 ? (
            <div className="flex items-center gap-1.5">
              <Select
                aria-label={`Role for ${member.user.name}`}
                value={selectedRole}
                disabled={Boolean(busy)}
                onChange={(event) => setSelectedRole(event.target.value as Role)}
                className="h-8 py-1 text-xs"
              >
                {roleOptions.map((role) => (
                  <option key={role} value={role}>
                    {role.charAt(0) + role.slice(1).toLowerCase()}
                  </option>
                ))}
              </Select>
              <Button
                size="sm"
                variant="secondary"
                loading={busy === "role"}
                disabled={selectedRole === member.role}
                onClick={() =>
                  run(
                    "role",
                    `/organizations/${member.organizationId}/members/${member.id}`,
                    "PATCH",
                    { role: selectedRole },
                  )
                }
              >
                Save
              </Button>
            </div>
          ) : (
            <RoleBadge role={member.role} />
          )}
        </div>
      </Td>
      <Td>
        <MembershipStatusBadge status={member.status} />
      </Td>
      <Td className="text-xs text-muted">
        {formatDate(member.createdAt, timezone)}
      </Td>
      <Td>
        {canManage ? (
          <div className="flex flex-wrap justify-end gap-1.5">
            {member.status === "ACTIVE" ? (
              <Button
                size="sm"
                variant="secondary"
                loading={busy === "suspend"}
                onClick={() =>
                  run(
                    "suspend",
                    `/organizations/${member.organizationId}/members/${member.id}/suspend`,
                    "POST",
                    undefined,
                    `Suspend ${member.user.name}? They will lose access until reactivated.`,
                  )
                }
              >
                Suspend
              </Button>
            ) : null}
            {member.status === "SUSPENDED" ? (
              <Button
                size="sm"
                variant="secondary"
                loading={busy === "reactivate"}
                onClick={() =>
                  run(
                    "reactivate",
                    `/organizations/${member.organizationId}/members/${member.id}/reactivate`,
                    "POST",
                  )
                }
              >
                Reactivate
              </Button>
            ) : null}
            {canRemove ? (
              <Button
                size="sm"
                variant="danger"
                loading={busy === "remove"}
                onClick={() =>
                  run(
                    "remove",
                    `/organizations/${member.organizationId}/members/${member.id}`,
                    "DELETE",
                    undefined,
                    `Remove ${member.user.name} from this organization? You can re-invite them later.`,
                  )
                }
              >
                Remove
              </Button>
            ) : null}
          </div>
        ) : (
          <span className="block text-right text-[11px] text-muted">
            {member.status === "REMOVED" ? "Removed" : "Managed by an admin"}
          </span>
        )}
        {notice ? <p className="mt-1 text-right text-[11px] text-success">{notice}</p> : null}
        {error ? <p className="mt-1 text-right text-[11px] text-danger">{error}</p> : null}
      </Td>
    </tr>
  );
}

function OrganizationSettings({
  organization,
  memberCount,
  onSaved,
}: {
  organization: Organization;
  memberCount: number | undefined;
  onSaved: () => void;
}) {
  const { membership } = useWorkspace();
  const [name, setName] = useState(organization.name);
  const [timezone, setTimezone] = useState(organization.timezone);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const canUpdate = hasPermission(membership?.role, "organization:update");

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSuccess(null);
    setFieldErrors({});

    const trimmedName = name.trim();
    const trimmedTimezone = timezone.trim();
    if (trimmedName.length < 2) {
      setFieldErrors({ name: "Name must be at least 2 characters." });
      return;
    }
    if (!isValidTimezone(trimmedTimezone)) {
      setFieldErrors({ timezone: "Enter a valid IANA timezone, such as Europe/Berlin." });
      return;
    }

    setLoading(true);
    try {
      await apiRequest(`/organizations/${organization.id}`, {
        method: "PATCH",
        body: { name: trimmedName, timezone: trimmedTimezone },
      });
      setSuccess("Organization settings saved.");
      onSaved();
    } catch (caught) {
      if (isApiError(caught)) {
        setFieldErrors({
          name: caught.fieldError("name") ?? "",
          timezone: caught.fieldError("timezone") ?? "",
        });
      }
      setError(errorMessage(caught));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <CardHeader
        title="Organization settings"
        description={`${memberCount ?? "—"} active and inactive memberships · created ${formatDate(organization.createdAt)}`}
      />
      <form onSubmit={save} className="space-y-4 p-4">
        {error ? <Alert tone="danger">{error}</Alert> : null}
        {success ? <Alert tone="success">{success}</Alert> : null}
        {!canUpdate ? (
          <Alert tone="info">
            Your role can read organization details but cannot change settings. Ask an owner
            or admin to update the name or timezone.
          </Alert>
        ) : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Organization name"
            htmlFor="org-name"
            error={fieldErrors.name || null}
            required
          >
            <Input
              id="org-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              disabled={!canUpdate}
              maxLength={120}
              required
            />
          </Field>
          <Field
            label="Timezone"
            htmlFor="org-timezone"
            error={fieldErrors.timezone || null}
            hint="IANA timezone used for attendance summaries and report dates."
            required
          >
            <Input
              id="org-timezone"
              value={timezone}
              onChange={(event) => setTimezone(event.target.value)}
              disabled={!canUpdate}
              maxLength={64}
              placeholder="Europe/Berlin"
              required
            />
          </Field>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" loading={loading} disabled={!canUpdate}>
            Save settings
          </Button>
          <span className="text-xs text-muted">
            Slug <code className="rounded bg-surface-hover px-1.5 py-0.5 text-ink-secondary">{organization.slug}</code>{" "}
            cannot be changed. Organization status is{" "}
            <Badge tone={organization.status === "ACTIVE" ? "success" : "warning"}>
              {organization.status}
            </Badge>
          </span>
        </div>
      </form>
    </Card>
  );
}

function InvitationsPanel({
  organizationId,
  actorRole,
  timezone,
}: {
  organizationId: string;
  actorRole: Role;
  timezone: string;
}) {
  const canInvite = hasPermission(actorRole, "member:invite");
  const canRead = hasPermission(actorRole, "invitation:read");
  const canRevoke = hasPermission(actorRole, "invitation:revoke");
  const roles = invitableRoles(actorRole);

  const [status, setStatus] = useState<InvitationStatusFilter>("pending");
  const [page, setPage] = useState(1);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>(roles[0] ?? "EMPLOYEE");
  const [inviteErrors, setInviteErrors] = useState<Record<string, string>>({});
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteLoading, setInviteLoading] = useState(false);
  const [created, setCreated] = useState<{ token: string; email: string; expiresAt: string } | null>(
    null,
  );
  const [copied, setCopied] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);

  const invitations = useApi<Paginated<Invitation>>(
    (signal) =>
      apiRequest(`/organizations/${organizationId}/invitations`, {
        signal,
        query: { status, page, limit: 10 },
      }),
    [organizationId, status, page, refreshToken],
    { enabled: canRead },
  );

  const rows = invitations.data?.data ?? [];

  async function sendInvitation(event: React.FormEvent) {
    event.preventDefault();
    setInviteError(null);
    setInviteErrors({});
    setCreated(null);
    setCopied(false);

    const trimmed = email.trim();
    if (!trimmed) {
      setInviteErrors({ email: "Enter the invitee's email address." });
      return;
    }

    setInviteLoading(true);
    try {
      const response = await apiRequest<{
        data: { invitation: Invitation; token: string; expiresAt: string };
      }>(`/organizations/${organizationId}/invitations`, {
        method: "POST",
        body: { email: trimmed, role },
      });
      setCreated({
        token: response.data.token,
        email: response.data.invitation.email,
        expiresAt: response.data.expiresAt,
      });
      setEmail("");
      setStatus("pending");
      setPage(1);
      setRefreshToken((value) => value + 1);
    } catch (caught) {
      if (isApiError(caught)) {
        setInviteErrors({
          email: caught.fieldError("email") ?? "",
          role: caught.fieldError("role") ?? "",
        });
      }
      setInviteError(errorMessage(caught));
    } finally {
      setInviteLoading(false);
    }
  }

  async function revoke(invitation: Invitation) {
    if (
      !window.confirm(`Revoke the invitation for ${invitation.email}? The link will stop working.`)
    ) {
      return;
    }
    setActionError(null);
    try {
      await apiRequest(
        `/organizations/${organizationId}/invitations/${invitation.id}`,
        { method: "DELETE" },
      );
      setRefreshToken((value) => value + 1);
    } catch (caught) {
      setActionError(errorMessage(caught));
    }
  }

  async function copyToken() {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.token);
      setCopied(true);
    } catch {
      setInviteError("Could not copy automatically. Select the token and copy it manually.");
    }
  }

  if (!canRead) return null;

  return (
    <Card>
      <CardHeader
        title="Invitations"
        description="Invitation tokens are shown once. Deliver them out of band; the invited account must sign in with the same email before accepting."
        actions={
          <Tabs
            value={status}
            onChange={(value) => {
              setStatus(value);
              setPage(1);
            }}
            tabs={[
              { value: "pending", label: "Pending" },
              { value: "accepted", label: "Accepted" },
              { value: "revoked", label: "Revoked" },
              { value: "expired", label: "Expired" },
              { value: "all", label: "All" },
            ]}
          />
        }
      />

      {canInvite ? (
        <form onSubmit={sendInvitation} className="border-b border-line p-4">
          {inviteError ? (
            <div className="mb-3">
              <Alert tone="danger">{inviteError}</Alert>
            </div>
          ) : null}
          {created ? (
            <div className="mb-4 rounded-lg border border-line bg-surface-muted p-4">
              <p className="text-sm font-semibold text-ink">
                Invitation created for {created.email}
              </p>
              <p className="mt-1 text-xs leading-5 text-muted">
                Expires {formatDateTime(created.expiresAt, timezone)}. This token is shown only
                now.
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <code className="min-w-0 flex-1 break-all rounded-md border border-line bg-surface px-3 py-2 font-mono text-[11px] text-ink-secondary">
                  {created.token}
                </code>
                <Button type="button" size="sm" variant="secondary" onClick={copyToken}>
                  <CopyIcon className="h-3.5 w-3.5" />
                  {copied ? "Copied" : "Copy token"}
                </Button>
              </div>
              <p className="mt-2 text-[11px] leading-5 text-muted">
                The invitee signs in, opens <code>/invitations/accept?token=…</code>, and submits
                this token. Invitation acceptance is handled by the API and is not e-mailed by this
                portal.
              </p>
            </div>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-[1.4fr_0.8fr_auto] sm:items-end">
            <Field
              label="Email"
              htmlFor="invite-email"
              error={inviteErrors.email || null}
              required
            >
              <Input
                id="invite-email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="newhire@example.com"
                autoComplete="email"
                required
              />
            </Field>
            <Field label="Role" htmlFor="invite-role" error={inviteErrors.role || null}>
              <Select
                id="invite-role"
                value={role}
                onChange={(event) => setRole(event.target.value as Role)}
              >
                {roles.map((item) => (
                  <option key={item} value={item}>
                    {item.charAt(0) + item.slice(1).toLowerCase()}
                  </option>
                ))}
              </Select>
            </Field>
            <Button type="submit" loading={inviteLoading}>
              <PlusIcon className="h-4 w-4" />
              Invite
            </Button>
          </div>
        </form>
      ) : null}

      {actionError ? (
        <div className="px-4 pt-4">
          <Alert tone="danger">{actionError}</Alert>
        </div>
      ) : null}
      {invitations.error ? (
        <div className="p-4">
          <ErrorState message={invitations.error} onRetry={invitations.reload} />
        </div>
      ) : rows.length === 0 && !invitations.loading ? (
        <EmptyState
          title="No invitations"
          description="Invitations matching this status will appear here."
          icon={<UsersIcon className="h-5 w-5" />}
        />
      ) : (
        <TableShell>
          <thead>
            <tr>
              <Th>Email</Th>
              <Th>Role</Th>
              <Th>Status</Th>
              <Th>Invited by</Th>
              <Th>Expires</Th>
              <Th className="text-right">Actions</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((invitation) => {
              const statusInfo = invitationStatus(invitation);
              return (
                <tr key={invitation.id} className="hover:bg-surface-muted">
                  <Td className="font-medium text-ink">{invitation.email}</Td>
                  <Td>
                    <RoleBadge role={invitation.role} />
                  </Td>
                  <Td>
                    <Badge tone={statusInfo.tone}>{statusInfo.label}</Badge>
                  </Td>
                  <Td className="text-xs text-muted">
                    {invitation.invitedBy?.name ?? "—"}
                  </Td>
                  <Td className="text-xs text-muted">
                    {formatDateTime(invitation.expiresAt, timezone)}
                  </Td>
                  <Td className="text-right">
                    {canRevoke && !invitation.acceptedAt && !invitation.revokedAt ? (
                      <Button size="sm" variant="danger" onClick={() => revoke(invitation)}>
                        Revoke
                      </Button>
                    ) : (
                      <span className="text-[11px] text-muted">—</span>
                    )}
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </TableShell>
      )}
      <Pagination
        page={invitations.data?.meta.page ?? page}
        totalPages={invitations.data?.meta.totalPages ?? 1}
        onPageChange={setPage}
      />
    </Card>
  );
}

function MembersPanel({
  organizationId,
  actorRole,
  actorUserId,
  timezone,
}: {
  organizationId: string;
  actorRole: Role;
  actorUserId: string;
  timezone: string;
}) {
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [role, setRole] = useState<"" | Role>("");
  const [status, setStatus] = useState<"" | "ACTIVE" | "SUSPENDED" | "REMOVED">("");
  const [page, setPage] = useState(1);
  const [refreshToken, setRefreshToken] = useState(0);

  const members = useApi<Paginated<MemberListItem>>(
    (signal) =>
      apiRequest(`/organizations/${organizationId}/members`, {
        signal,
        query: {
          page,
          limit: 20,
          q: search || undefined,
          role: role || undefined,
          status: status || undefined,
        },
      }),
    [organizationId, page, search, role, status, refreshToken],
    { enabled: true },
  );

  const rows = members.data?.data ?? [];

  function applyFilters(event: React.FormEvent) {
    event.preventDefault();
    setSearch(query.trim());
    setPage(1);
  }

  return (
    <Card>
      <CardHeader
        title="Members"
        description={
          members.data
            ? `${members.data.meta.total} membership${members.data.meta.total === 1 ? "" : "s"}`
            : "Loading…"
        }
      />
      <form
        onSubmit={applyFilters}
        className="grid gap-3 border-b border-line p-4 lg:grid-cols-[1fr_170px_170px_auto] lg:items-end"
      >
        <Field label="Search" htmlFor="manage-member-search">
          <Input
            id="manage-member-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Name or email"
          />
        </Field>
        <Field label="Role" htmlFor="manage-member-role">
          <Select
            id="manage-member-role"
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
        <Field label="Status" htmlFor="manage-member-status">
          <Select
            id="manage-member-status"
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
        <Button type="submit" variant="secondary">
          Apply
        </Button>
      </form>

      {members.error ? (
        <div className="p-4">
          <ErrorState message={members.error} onRetry={members.reload} />
        </div>
      ) : rows.length === 0 && !members.loading ? (
        <EmptyState
          title="No members match"
          description="Try a different search, role, or status."
          icon={<UsersIcon className="h-5 w-5" />}
        />
      ) : (
        <TableShell>
          <thead>
            <tr>
              <Th>Member</Th>
              <Th>Role</Th>
              <Th>Status</Th>
              <Th>Joined</Th>
              <Th className="text-right">Actions</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((member) => (
              <MemberRow
                key={`${member.id}:${member.role}:${member.status}`}
                member={member}
                actorRole={actorRole}
                actorUserId={actorUserId}
                timezone={timezone}
                onChanged={() => setRefreshToken((value) => value + 1)}
              />
            ))}
          </tbody>
        </TableShell>
      )}
      <Pagination
        page={members.data?.meta.page ?? page}
        totalPages={members.data?.meta.totalPages ?? 1}
        onPageChange={setPage}
      />
    </Card>
  );
}

function OrganizationView({ organization }: { organization: Organization }) {
  const router = useRouter();
  const { user, membership } = useWorkspace();
  const [detailsRefresh, setDetailsRefresh] = useState(0);

  const details = useApi<{ data: OrganizationDetails }>(
    (signal) =>
      apiRequest(`/organizations/${organization.id}`, { signal }),
    [organization.id, detailsRefresh],
  );

  const current = details.data?.data.organization ?? organization;
  const memberCount = details.data?.data.memberCount;
  const actorRole = membership?.role ?? "EMPLOYEE";
  const canReadMembers = hasPermission(actorRole, "member:read");

  function refreshAll() {
    setDetailsRefresh((value) => value + 1);
    router.refresh();
  }

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={current.slug}
        title="Organization"
        description="Manage the organization profile, memberships, and invitations. Every change is authorized by the backend."
      />

      {details.error ? (
        <ErrorState message={details.error} onRetry={details.reload} />
      ) : null}

      <OrganizationSettings
        key={`${current.id}:${current.name}:${current.timezone}`}
        organization={current}
        memberCount={memberCount}
        onSaved={refreshAll}
      />

      {canReadMembers ? (
        <MembersPanel
          organizationId={organization.id}
          actorRole={actorRole}
          actorUserId={user.id}
          timezone={current.timezone}
        />
      ) : null}

      <InvitationsPanel
        organizationId={organization.id}
        actorRole={actorRole}
        timezone={current.timezone}
      />
    </div>
  );
}

export function OrganizationPageView() {
  const { organization } = useWorkspace();
  if (!organization) return <NoOrganization />;
  return <OrganizationView key={organization.id} organization={organization} />;
}
