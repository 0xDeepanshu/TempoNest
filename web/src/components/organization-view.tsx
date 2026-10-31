"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { apiRequest } from "@/lib/api-client";
import { errorMessage, isApiError } from "@/lib/api-error";
import { formatDate, formatDateTime, isValidTimezone } from "@/lib/format";
import {
  assignableRoles,
  canManageMember,
  hasPermission,
  invitableRoles,
} from "@/lib/permissions";
import { assignMemberRole, listRoles } from "@/lib/roles-api";
import type {
  Invitation,
  MemberListItem,
  MembershipSummary,
  Organization,
  OrganizationDetails,
  Paginated,
  Role,
  RoleSummary,
} from "@/lib/types";
import { useApi } from "@/lib/use-api";
import { CopyIcon, CalendarIcon, PlusIcon, UsersIcon } from "./icons";
import {
  Alert,
  Avatar,
  Badge,
  Button,
  Card,
  CardBody,
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
  actor,
  actorUserId,
  customRoles,
  timezone,
  onChanged,
}: {
  member: MemberListItem;
  actor: MembershipSummary;
  actorUserId: string;
  customRoles: RoleSummary[];
  timezone: string;
  onChanged: () => void;
}) {
  const actorRole = actor.role;
  const currentRole = member.role;
  const roleOptions = assignableRoles(actorRole, currentRole);
  const [selectedRole, setSelectedRole] = useState<string>(
    member.customRoleId ? `custom:${member.customRoleId}` : currentRole,
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const canManage =
    canManageMember(actor, actorUserId, {
      userId: member.userId,
      role: member.role,
    }) && member.status !== "REMOVED";
  const canRemove =
    canManage && hasPermission(actor, "member:remove") && member.status !== "REMOVED";
  const currentValue = member.customRoleId ? `custom:${member.customRoleId}` : currentRole;

  async function changeRole() {
    setBusy("role");
    setError(null);
    setNotice(null);
    try {
      await assignMemberRole(
        member.organizationId,
        member.id,
        selectedRole.startsWith("custom:")
          ? { customRoleId: selectedRole.slice("custom:".length) }
          : { role: selectedRole as Role },
      );
      setNotice("Membership updated.");
      onChanged();
      window.dispatchEvent(new Event("tn:permissions-changed"));
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(null);
    }
  }

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
          {canManage && (roleOptions.length > 1 || customRoles.length > 0) ? (
            <div className="flex items-center gap-1.5">
              <Select
                aria-label={`Role for ${member.user.name}`}
                value={selectedRole}
                disabled={Boolean(busy)}
                onChange={(event) => setSelectedRole(event.target.value)}
                className="h-8 py-1 text-xs"
              >
                {roleOptions.map((role) => (
                  <option key={role} value={role}>
                    {role.charAt(0) + role.slice(1).toLowerCase()}
                  </option>
                ))}
                {member.customRoleId &&
                !customRoles.some((role) => role.id === member.customRoleId) ? (
                  <option value={currentValue}>
                    {member.customRole?.name ?? "Custom role"}
                  </option>
                ) : null}
                {customRoles.map((role) => (
                  <option key={role.id} value={`custom:${role.id}`}>
                    {role.name}
                  </option>
                ))}
              </Select>
              <Button
                size="sm"
                variant="secondary"
                loading={busy === "role"}
                disabled={selectedRole === currentValue}
                onClick={changeRole}
              >
                Save
              </Button>
            </div>
          ) : (
            <div className="space-y-1">
              <RoleBadge role={member.role} customRoleName={member.customRole?.name} />
              {member.customRole?.name ? (
                <p className="text-[11px] text-muted">Custom role</p>
              ) : null}
            </div>
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
  const canUpdate = hasPermission(membership, "organization:update");

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

export function InvitationsPanel({
  organizationId,
  actor,
  timezone,
}: {
  organizationId: string;
  actor: MembershipSummary;
  timezone: string;
}) {
  const actorRole = actor.role;
  const canInvite = hasPermission(actor, "member:invite");
  const canOnboard = hasPermission(actor, "member:onboard");
  const canCreate = canInvite || canOnboard;
  const canRead = hasPermission(actor, "invitation:read") || canOnboard;
  const canRevoke = hasPermission(actor, "invitation:revoke") || canOnboard;
  const baseRoles = canInvite
    ? invitableRoles(actorRole)
    : canOnboard
      ? (["EMPLOYEE"] as Role[])
      : [];

  const roleCatalog = useApi(
    (signal) => listRoles(organizationId, { signal }),
    [organizationId],
    { enabled: hasPermission(actor, "role:read") },
  );
  const eligibleCustomRoles = (roleCatalog.data?.data ?? []).filter(
    (item) => !item.builtIn && item.onboardingEligible,
  );

  const [status, setStatus] = useState<InvitationStatusFilter>("pending");
  const [page, setPage] = useState(1);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [roleSelection, setRoleSelection] = useState<string>(
    baseRoles[0] ?? "EMPLOYEE",
  );
  const [inviteErrors, setInviteErrors] = useState<Record<string, string>>({});
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteLoading, setInviteLoading] = useState(false);
  const [created, setCreated] = useState<{
    token: string;
    email: string;
    expiresAt: string;
    emailSent: boolean;
  } | null>(null);
  const [copied, setCopied] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [resendingId, setResendingId] = useState<string | null>(null);
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

    const trimmedName = name.trim();
    const trimmed = email.trim();
    const errors: Record<string, string> = {};
    if (trimmedName.length < 2) {
      errors.name = "Enter the invitee's name (at least 2 characters).";
    }
    if (!trimmed) {
      errors.email = "Enter the invitee's email address.";
    }
    if (Object.keys(errors).length > 0) {
      setInviteErrors(errors);
      return;
    }

    const customRoleId = roleSelection.startsWith("custom:")
      ? roleSelection.slice("custom:".length)
      : null;
    setInviteLoading(true);
    try {
      const response = await apiRequest<{
        data: {
          invitation: Invitation;
          token: string;
          expiresAt: string;
          emailSent: boolean;
        };
      }>(`/organizations/${organizationId}/invitations`, {
        method: "POST",
        body: customRoleId
          ? { name: trimmedName, email: trimmed, role: "EMPLOYEE", customRoleId }
          : { name: trimmedName, email: trimmed, role: roleSelection as Role },
      });
      setCreated({
        token: response.data.token,
        email: response.data.invitation.email,
        expiresAt: response.data.expiresAt,
        emailSent: response.data.emailSent,
      });
      setName("");
      setEmail("");
      setStatus("pending");
      setPage(1);
      setRefreshToken((value) => value + 1);
    } catch (caught) {
      if (isApiError(caught)) {
        setInviteErrors({
          name: caught.fieldError("name") ?? "",
          email: caught.fieldError("email") ?? "",
          role: caught.fieldError("role") ?? caught.fieldError("customRoleId") ?? "",
        });
      }
      setInviteError(errorMessage(caught));
    } finally {
      setInviteLoading(false);
    }
  }

  async function resend(invitation: Invitation) {
    setActionError(null);
    setResendingId(invitation.id);
    try {
      const response = await apiRequest<{
        data: {
          invitation: Invitation;
          token: string;
          expiresAt: string;
          emailSent: boolean;
        };
      }>(`/organizations/${organizationId}/invitations/${invitation.id}/resend`, {
        method: "POST",
        body: {},
      });
      setCreated({
        token: response.data.token,
        email: response.data.invitation.email,
        expiresAt: response.data.expiresAt,
        emailSent: response.data.emailSent,
      });
      setCopied(false);
      setRefreshToken((value) => value + 1);
    } catch (caught) {
      setActionError(errorMessage(caught));
    } finally {
      setResendingId(null);
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

  async function copyLink() {
    if (!created) return;
    const link = `${window.location.origin}/invitations/accept?token=${encodeURIComponent(created.token)}`;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      setInviteError("Could not copy automatically. Select the link and copy it manually.");
    }
  }

  if (!canRead) return null;

  return (
    <Card>
      <CardHeader
        title="Invitations"
        description="Invite employees by name, email, and role. They receive an e-mail link to create their password and join the organization."
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

      {canCreate ? (
        <form onSubmit={sendInvitation} className="border-b border-line p-4" noValidate>
          {canOnboard && !canInvite ? (
            <div className="mb-3">
              <Alert tone="info">
                You can invite employee-level members. Administrative and manager invitations are
                limited to owners and administrators.
              </Alert>
            </div>
          ) : null}
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
                {created.emailSent
                  ? "We e-mailed an acceptance link. It expires"
                  : "The e-mail could not be sent. Share this link with the invitee instead. It expires"}{" "}
                {formatDateTime(created.expiresAt, timezone)}.
              </p>
              {created.emailSent ? null : (
                <>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <code className="min-w-0 flex-1 break-all rounded-md border border-line bg-surface px-3 py-2 font-mono text-[11px] text-ink-secondary">
                      /invitations/accept?token={created.token}
                    </code>
                    <Button type="button" size="sm" variant="secondary" onClick={copyLink}>
                      <CopyIcon className="h-3.5 w-3.5" />
                      {copied ? "Copied" : "Copy link"}
                    </Button>
                  </div>
                  <p className="mt-2 text-[11px] leading-5 text-muted">
                    Check the mail settings, or use Resend once e-mail delivery is configured.
                  </p>
                </>
              )}
            </div>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-[1fr_1.3fr_0.8fr_auto] sm:items-end">
            <Field
              label="Name"
              htmlFor="invite-name"
              error={inviteErrors.name || null}
              required
            >
              <Input
                id="invite-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Ada Lovelace"
                autoComplete="name"
                maxLength={120}
                required
              />
            </Field>
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
            <Field
              label="Role"
              htmlFor="invite-role"
              error={inviteErrors.role || null}
              hint="Custom roles must be approved for onboarding."
            >
              <Select
                id="invite-role"
                value={roleSelection}
                onChange={(event) => setRoleSelection(event.target.value)}
              >
                {baseRoles.map((item) => (
                  <option key={item} value={item}>
                    {item.charAt(0) + item.slice(1).toLowerCase()}
                  </option>
                ))}
                {eligibleCustomRoles.map((item) => (
                  <option key={item.id} value={`custom:${item.id}`}>
                    {item.name}
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
              <Th>Name</Th>
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
              const open = !invitation.acceptedAt && !invitation.revokedAt;
              return (
                <tr key={invitation.id} className="hover:bg-surface-muted">
                  <Td className="text-ink">{invitation.name ?? "—"}</Td>
                  <Td className="font-medium text-ink">{invitation.email}</Td>
                  <Td>
                    <RoleBadge
                      role={invitation.role}
                      customRoleName={invitation.customRole?.name}
                    />
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
                    {open && (canCreate || canRevoke) ? (
                      <div className="flex flex-wrap justify-end gap-1.5">
                        {canCreate ? (
                          <Button
                            size="sm"
                            variant="secondary"
                            loading={resendingId === invitation.id}
                            onClick={() => resend(invitation)}
                          >
                            Resend
                          </Button>
                        ) : null}
                        {canRevoke ? (
                          <Button size="sm" variant="danger" onClick={() => revoke(invitation)}>
                            Revoke
                          </Button>
                        ) : null}
                      </div>
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

export function MembersPanel({
  organizationId,
  actor,
  actorUserId,
  timezone,
}: {
  organizationId: string;
  actor: MembershipSummary;
  actorUserId: string;
  timezone: string;
}) {
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [role, setRole] = useState<"" | Role>("");
  const [status, setStatus] = useState<"" | "ACTIVE" | "SUSPENDED" | "REMOVED">("");
  const [page, setPage] = useState(1);
  const [refreshToken, setRefreshToken] = useState(0);

  const roles = useApi(
    (signal) => listRoles(organizationId, { signal }),
    [organizationId, refreshToken],
    { enabled: hasPermission(actor, "role:read") },
  );
  const customRoles = (roles.data?.data ?? []).filter((item) => !item.builtIn);

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
                key={`${member.id}:${member.role}:${member.customRoleId ?? ""}:${member.status}`}
                member={member}
                actor={actor}
                actorUserId={actorUserId}
                customRoles={customRoles}
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
  const canReadMembers = membership ? hasPermission(membership, "member:read") : false;

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

      {membership && hasPermission(membership, "holiday:settings:manage") ? (
        <Card>
          <CardHeader
            title="Holiday calendar"
            description="Working days, optional holidays, half-days, and default applicability are organization-wide settings."
            actions={
              <Link
                href="/admin/leave/holidays/settings"
                className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-medium text-ink-secondary transition-colors hover:bg-surface-hover hover:text-ink"
              >
                <CalendarIcon className="h-3.5 w-3.5" />
                Open holiday settings
              </Link>
            }
          />
          <CardBody className="text-xs leading-5 text-muted">
            Holiday settings live with the rest of the organization configuration. Changes are
            audited and apply to future leave and attendance calculations without rewriting
            historical records.
          </CardBody>
        </Card>
      ) : null}

      {canReadMembers && membership ? (
        <MembersPanel
          organizationId={organization.id}
          actor={membership}
          actorUserId={user.id}
          timezone={current.timezone}
        />
      ) : null}

      {membership ? (
        <InvitationsPanel
          organizationId={organization.id}
          actor={membership}
          timezone={current.timezone}
        />
      ) : null}
    </div>
  );
}

export function OrganizationPageView() {
  const { organization } = useWorkspace();
  if (!organization) return <NoOrganization />;
  return <OrganizationView key={organization.id} organization={organization} />;
}
