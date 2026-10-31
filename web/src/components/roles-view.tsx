"use client";

import { useMemo, useState } from "react";
import { errorMessage } from "@/lib/api-error";
import { formatDate } from "@/lib/format";
import { hasPermission, type Permission } from "@/lib/permissions";
import {
  createRole,
  deleteRole,
  listPermissionCatalog,
  listRoles,
  listRoleUsers,
  resetManagerRole,
  updateManagerRole,
  updateRole,
  type CreateRoleInput,
} from "@/lib/roles-api";
import type {
  DataScope,
  PermissionCatalog,
  PermissionCatalogEntry,
  RoleSummary,
} from "@/lib/types";
import { useApi } from "@/lib/use-api";
import { ConfirmDialog } from "./confirm-dialog";
import { KeyIcon, PlusIcon, SearchIcon, UsersIcon } from "./icons";
import { Modal } from "./modal";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  Field,
  Input,
  LoadingBlock,
  MembershipStatusBadge,
  PageHeader,
  Pagination,
  Select,
  TableShell,
  Td,
  Textarea,
  Th,
  cn,
} from "./ui";
import { NoOrganization, useWorkspace } from "./workspace";

const USERS_PAGE_SIZE = 20;

function scopeLabel(catalog: PermissionCatalog | undefined, scope: DataScope): string {
  return catalog?.dataScopes.find((entry) => entry.value === scope)?.label ?? scope;
}

function scopeTone(scope: DataScope): "neutral" | "info" {
  return scope === "ORGANIZATION" ? "info" : "neutral";
}

function roleKind(role: RoleSummary): {
  label: string;
  tone: "neutral" | "info" | "outline";
} {
  if (!role.builtIn) return { label: "Custom", tone: "outline" };
  if (role.customizable) return { label: "Built-in · Customizable", tone: "info" };
  return { label: "Built-in · Protected", tone: "neutral" };
}

/** Groups whose permissions are not grantable to custom roles are absent from the catalog groups. */
const GROUP_LABEL_FALLBACK: Record<string, string> = {
  screenshot: "Screenshot monitoring",
};

function groupLabel(catalog: PermissionCatalog, key: string): string {
  return (
    catalog.groups.find((group) => group.key === key)?.label ??
    GROUP_LABEL_FALLBACK[key] ??
    key
  );
}

function permissionLabels(
  entries: PermissionCatalogEntry[],
  ids: readonly Permission[],
): string[] {
  const byId = new Map(entries.map((entry) => [entry.id, entry.label]));
  return ids.map((id) => byId.get(id) ?? id);
}

function RoleRow({
  role,
  catalog,
  canManage,
  canCustomizeManager,
  onEdit,
  onDelete,
  onRestore,
  onViewUsers,
}: {
  role: RoleSummary;
  catalog: PermissionCatalog | undefined;
  canManage: boolean;
  canCustomizeManager: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onRestore: () => void;
  onViewUsers: () => void;
}) {
  const labels = useMemo(
    () => permissionLabels(catalog?.permissions ?? [], role.permissions),
    [catalog, role.permissions],
  );
  const preview = labels.slice(0, 3).join(", ");
  const remaining = labels.length - 3;
  const kind = roleKind(role);

  return (
    <tr className="hover:bg-surface-muted">
      <Td>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <p className="font-medium text-ink">{role.name}</p>
            <Badge tone={kind.tone}>{kind.label}</Badge>
            {role.customized ? <Badge tone="warning">Customized</Badge> : null}
            {!role.builtIn && role.onboardingEligible ? (
              <Badge tone="outline">Onboarding</Badge>
            ) : null}
          </div>
          {role.description ? (
            <p className="mt-0.5 max-w-md text-xs leading-5 text-muted">{role.description}</p>
          ) : null}
        </div>
      </Td>
      <Td>
        <p className="text-xs font-medium text-ink-secondary">
          {role.permissionCount} permission{role.permissionCount === 1 ? "" : "s"}
        </p>
        {preview ? (
          <p className="mt-0.5 max-w-md text-[11px] leading-5 text-muted">
            {preview}
            {remaining > 0 ? ` +${remaining} more` : ""}
          </p>
        ) : (
          <p className="mt-0.5 text-[11px] text-muted">No permissions</p>
        )}
      </Td>
      <Td>
        <span className="tnum text-xs text-ink-secondary">
          {role.assignedUserCount} user{role.assignedUserCount === 1 ? "" : "s"}
        </span>
      </Td>
      <Td>
        <Badge tone={scopeTone(role.dataScope)}>
          {scopeLabel(catalog, role.dataScope)}
        </Badge>
      </Td>
      <Td>
        {role.builtIn && !role.customizable ? (
          <span className="block text-right text-[11px] text-muted">Read-only</span>
        ) : (
          <div className="flex flex-wrap justify-end gap-1.5">
            <Button variant="ghost" size="sm" onClick={onViewUsers}>
              <UsersIcon className="h-3.5 w-3.5" />
              Users
            </Button>
            {role.customizable ? (
              canCustomizeManager ? (
                <>
                  <Button variant="secondary" size="sm" onClick={onEdit}>
                    Edit
                  </Button>
                  {role.customized ? (
                    <Button variant="ghost" size="sm" onClick={onRestore}>
                      Restore defaults
                    </Button>
                  ) : null}
                </>
              ) : null
            ) : canManage ? (
              <>
                <Button variant="secondary" size="sm" onClick={onEdit}>
                  Edit
                </Button>
                <Button variant="danger" size="sm" onClick={onDelete}>
                  Delete
                </Button>
              </>
            ) : null}
          </div>
        )}
      </Td>
    </tr>
  );
}

function PermissionCheckbox({
  entry,
  checked,
  onChange,
}: {
  entry: PermissionCatalogEntry;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <label
      className={cn(
        "flex cursor-pointer items-start gap-2 rounded-lg border px-2.5 py-2 transition-colors",
        checked
          ? "border-ink/20 bg-surface-muted"
          : "border-line hover:bg-surface-muted",
      )}
    >
      <input
        type="checkbox"
        className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-ink"
        checked={checked}
        onChange={onChange}
      />
      <span className="min-w-0">
        <span className="block text-xs font-medium text-ink">{entry.label}</span>
        <span className="block text-[11px] leading-4 text-muted">{entry.description}</span>
      </span>
    </label>
  );
}

function RoleEditorModal({
  organizationId,
  role,
  catalog,
  manager = false,
  onClose,
  onSaved,
}: {
  organizationId: string;
  role: RoleSummary | null;
  catalog: PermissionCatalog;
  manager?: boolean;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [name, setName] = useState(role?.name ?? "");
  const [description, setDescription] = useState(role?.description ?? "");
  const [dataScope, setDataScope] = useState<DataScope>(
    role?.dataScope ?? (manager ? "ORGANIZATION" : "SELF"),
  );
  const [selected, setSelected] = useState<Set<Permission>>(
    () => new Set(role?.permissions ?? []),
  );
  const [onboardingEligible, setOnboardingEligible] = useState(
    role?.onboardingEligible ?? false,
  );
  const [search, setSearch] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [pendingSave, setPendingSave] = useState<{
    removed: string[];
    payload: CreateRoleInput;
  } | null>(null);

  const grantable = catalog.permissions.filter((entry) =>
    manager ? entry.grantableToManager : entry.grantableToCustomRole,
  );
  const groups = (() => {
    const byKey = new Map<string, { key: string; label: string; permissions: Permission[] }>();
    for (const entry of grantable) {
      const group = byKey.get(entry.group) ?? {
        key: entry.group,
        label: groupLabel(catalog, entry.group),
        permissions: [],
      };
      group.permissions.push(entry.id);
      byKey.set(entry.group, group);
    }
    const order = new Map(catalog.groups.map((group, index) => [group.key, index]));
    return [...byKey.values()].sort(
      (left, right) => (order.get(left.key) ?? 999) - (order.get(right.key) ?? 999),
    );
  })();
  const selectedScope = catalog.dataScopes.find((entry) => entry.value === dataScope);
  const protectedEntries = catalog.permissions.filter((entry) =>
    manager ? !entry.grantableToManager : !entry.grantableToCustomRole,
  );
  const order = new Map(catalog.permissions.map((entry, index) => [entry.id, index]));
  const query = search.trim().toLowerCase();
  const matches = (entry: PermissionCatalogEntry) =>
    !query ||
    entry.label.toLowerCase().includes(query) ||
    entry.description.toLowerCase().includes(query) ||
    entry.id.toLowerCase().includes(query);

  const selectedEntries = catalog.permissions.filter((entry) => selected.has(entry.id));

  function toggle(permission: Permission) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(permission)) next.delete(permission);
      else next.add(permission);
      return next;
    });
  }

  function selectGroup(permissions: Permission[]) {
    setSelected((current) => new Set([...current, ...permissions]));
  }

  function clearGroup(permissions: Permission[]) {
    setSelected((current) => {
      const next = new Set(current);
      for (const permission of permissions) next.delete(permission);
      return next;
    });
  }

  function buildPayload(): CreateRoleInput | null {
    const trimmedName = name.trim();
    if (!manager && (trimmedName.length < 2 || trimmedName.length > 80)) {
      setFormError("The role name must be between 2 and 80 characters.");
      return null;
    }
    const trimmedDescription = description.trim();
    if (trimmedDescription.length > 500) {
      setFormError("The description must be 500 characters or fewer.");
      return null;
    }
    if (selected.size === 0) {
      setFormError("Select at least one permission for the role.");
      return null;
    }
    const permissions = [...selected].sort(
      (left, right) => (order.get(left) ?? 0) - (order.get(right) ?? 0),
    );
    return {
      name: manager ? (role?.name ?? "Manager") : trimmedName,
      description: trimmedDescription || null,
      permissions,
      dataScope,
      ...(manager ? {} : { onboardingEligible }),
    };
  }

  async function save(payload: CreateRoleInput) {
    if (submitting) return;
    setFormError(null);
    setSubmitting(true);
    try {
      if (manager && role) {
        await updateManagerRole(organizationId, {
          description: payload.description,
          permissions: payload.permissions,
          dataScope: payload.dataScope,
        });
        onSaved("Manager role was updated.");
      } else if (role) {
        await updateRole(organizationId, role.id, payload);
        onSaved(`${payload.name} was updated.`);
      } else {
        await createRole(organizationId, payload);
        onSaved(`${payload.name} was created.`);
      }
      window.dispatchEvent(new Event("tn:permissions-changed"));
    } catch (caught) {
      setFormError(errorMessage(caught));
      setSubmitting(false);
    }
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const payload = buildPayload();
    if (!payload) return;

    if (role && role.assignedUserCount > 0) {
      const labelById = new Map(catalog.permissions.map((entry) => [entry.id, entry.label]));
      const removed = role.permissions
        .filter((permission) => !selected.has(permission))
        .map((permission) => labelById.get(permission) ?? permission);
      if (removed.length > 0) {
        setPendingSave({ removed, payload });
        return;
      }
    }
    void save(payload);
  }

  return (
    <>
      <Modal
        open
        onClose={onClose}
        dismissible={!submitting}
        title={manager ? "Customize Manager role" : role ? `Edit ${role.name}` : "Create a custom role"}
        description={
          manager
            ? "Manager changes apply only to this organization. Owner, admin, and employee roles stay protected."
            : "Choose exactly what this role can do. Administrator-only permissions are never available to custom roles."
        }
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={onClose} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" form="role-form" loading={submitting}>
              {role ? "Save changes" : "Create role"}
            </Button>
          </>
        }
      >
        <form id="role-form" onSubmit={submit} className="space-y-4">
          {formError ? <Alert tone="danger">{formError}</Alert> : null}

          <div className={manager ? "grid gap-4" : "grid gap-4 sm:grid-cols-2"}>
            {manager ? (
              <div className="rounded-lg border border-line bg-surface-muted px-3 py-2">
                <p className="text-xs font-semibold text-ink">{role?.name ?? "Manager"}</p>
                <p className="text-[11px] leading-5 text-muted">
                  Built-in · Customizable for this organization only. Ownership, admin, and
                  employee roles remain protected.
                </p>
              </div>
            ) : (
              <Field label="Role name" htmlFor="role-name" required>
                <Input
                  id="role-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Support lead"
                  maxLength={80}
                />
              </Field>
            )}
            <Field
              label="Data access scope"
              htmlFor="role-scope"
              hint="Limits whose records this role can see. Each action is still checked against the selected permissions."
              required
            >
              <Select
                id="role-scope"
                value={dataScope}
                onChange={(event) => setDataScope(event.target.value as DataScope)}
                className="h-9"
              >
                {catalog.dataScopes.map((entry) => (
                  <option key={entry.value} value={entry.value}>
                    {entry.label}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          {selectedScope ? (
            <div className="-mt-1 rounded-lg border border-line bg-surface-muted px-3 py-2 text-[11px] leading-5 text-muted">
              <p>{selectedScope.description}</p>
              <p className="mt-1">{catalog.dataScopeNote}</p>
            </div>
          ) : null}

          <Field label="Description" htmlFor="role-description">
            <Textarea
              id="role-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="What is this role responsible for?"
              maxLength={500}
              rows={2}
            />
          </Field>

          {manager ? null : (
            <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-line px-3 py-2">
              <input
                type="checkbox"
                className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-ink"
                checked={onboardingEligible}
                onChange={() => setOnboardingEligible((value) => !value)}
              />
              <span className="min-w-0">
                <span className="block text-xs font-medium text-ink">
                  Allow this role to invite and onboard employees
                </span>
                <span className="block text-[11px] leading-4 text-muted">
                  Members with this role can send employee-level invitations. They cannot invite
                  administrators, change another member&apos;s role, or modify existing memberships.
                </span>
              </span>
            </label>
          )}

          <div className="rounded-lg border border-line">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-surface-muted px-3 py-2">
              <div>
                <p className="text-xs font-semibold text-ink">Permissions</p>
                <p className="text-[11px] text-muted">
                  {selected.size} of {grantable.length} available selected
                </p>
              </div>
              <div className="relative">
                <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
                <input
                  type="search"
                  aria-label="Search permissions"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search permissions"
                  className="h-8 w-56 rounded-lg border border-line bg-surface pl-8 pr-2 text-xs text-ink outline-none transition focus:border-ink focus:ring-2 focus:ring-ink/10"
                />
              </div>
            </div>

            <div className="max-h-80 space-y-4 overflow-y-auto p-3">
              {groups.map((group) => {
                const entries = group.permissions
                  .map((permission) => grantable.find((entry) => entry.id === permission))
                  .filter((entry): entry is PermissionCatalogEntry => Boolean(entry))
                  .filter(matches);
                if (entries.length === 0) return null;
                const groupIds = entries.map((entry) => entry.id);
                const allSelected = groupIds.every((id) => selected.has(id));
                return (
                  <div key={group.key} role="group" aria-label={group.label} className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                        {group.label}
                      </p>
                      <div className="flex gap-1">
                        <button
                          type="button"
                          className="text-[11px] font-medium text-ink-secondary underline-offset-2 hover:underline disabled:opacity-40"
                          disabled={allSelected}
                          onClick={() => selectGroup(groupIds)}
                        >
                          Select all
                        </button>
                        <span className="text-[11px] text-muted">·</span>
                        <button
                          type="button"
                          className="text-[11px] font-medium text-ink-secondary underline-offset-2 hover:underline"
                          onClick={() => clearGroup(groupIds)}
                        >
                          Clear
                        </button>
                      </div>
                    </div>
                    <div className="grid gap-1.5 sm:grid-cols-2">
                      {entries.map((entry) => (
                        <PermissionCheckbox
                          key={entry.id}
                          entry={entry}
                          checked={selected.has(entry.id)}
                          onChange={() => toggle(entry.id)}
                        />
                      ))}
                    </div>
                  </div>
                );
              })}
              {query &&
              grantable.every((entry) => !matches(entry)) ? (
                <p className="py-4 text-center text-xs text-muted">
                  No grantable permissions match “{search.trim()}”.
                </p>
              ) : null}
            </div>
          </div>

          <div className="rounded-lg border border-line bg-surface-muted px-3 py-2.5">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-semibold text-ink">Selected permissions</p>
              {selected.size > 0 ? (
                <button
                  type="button"
                  className="text-[11px] font-medium text-ink-secondary underline-offset-2 hover:underline"
                  onClick={() => setSelected(new Set())}
                >
                  Clear all
                </button>
              ) : null}
            </div>
            {selectedEntries.length === 0 ? (
              <p className="mt-1 text-[11px] text-muted">
                Nothing selected yet. A role needs at least one permission.
              </p>
            ) : (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {selectedEntries.map((entry) => (
                  <Badge key={entry.id} tone="outline">
                    {entry.label}
                  </Badge>
                ))}
              </div>
            )}
          </div>

          <details className="rounded-lg border border-line px-3 py-2">
            <summary className="cursor-pointer text-xs font-medium text-ink-secondary">
              Administrator-only permissions ({protectedEntries.length})
            </summary>
            <p className="mt-1.5 text-[11px] leading-5 text-muted">
              {manager
                ? "These stay with the built-in OWNER and ADMIN roles so customizing Manager cannot grant member administration, monitoring, or role management."
                : "These stay with the built-in OWNER and ADMIN roles so a custom role can never gain member administration, monitoring, or role management. They cannot be selected here."}
            </p>
            <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
              {protectedEntries.map((entry) => (
                  <label
                    key={entry.id}
                    className="flex items-start gap-2 rounded-lg border border-line px-2.5 py-2 opacity-60"
                  >
                    <input
                      type="checkbox"
                      className="mt-0.5 h-3.5 w-3.5 shrink-0"
                      checked={false}
                      disabled
                      readOnly
                    />
                    <span className="min-w-0">
                      <span className="block text-xs font-medium text-ink">{entry.label}</span>
                      <span className="block text-[11px] leading-4 text-muted">
                        {entry.description}
                      </span>
                    </span>
                  </label>
                ))}
            </div>
          </details>
        </form>
      </Modal>

      <ConfirmDialog
        open={pendingSave !== null}
        title={
          manager
            ? "Remove permissions from the Manager role?"
            : "Remove permissions from a role in use?"
        }
        description={`${role?.assignedUserCount ?? 0} ${
          manager ? "manager" : "user"
        }${role?.assignedUserCount === 1 ? "" : "s"} currently use this role. Removing permissions takes effect immediately for them.`}
        confirmLabel="Save changes"
        tone="danger"
        busy={submitting}
        onClose={() => {
          if (!submitting) setPendingSave(null);
        }}
        onConfirm={() => {
          if (pendingSave) {
            const payload = pendingSave.payload;
            setPendingSave(null);
            void save(payload);
          }
        }}
      >
        <div>
          <p className="text-xs font-medium text-ink-secondary">Permissions being removed</p>
          <div className="mt-1.5 flex flex-wrap gap-1">
            {pendingSave?.removed.map((label) => (
              <Badge key={label} tone="danger">
                {label}
              </Badge>
            ))}
          </div>
        </div>
      </ConfirmDialog>
    </>
  );
}

function RoleUsersModal({
  organizationId,
  role,
  timezone,
  onClose,
}: {
  organizationId: string;
  role: RoleSummary;
  timezone: string;
  onClose: () => void;
}) {
  const [page, setPage] = useState(1);
  const users = useApi(
    (signal) =>
      listRoleUsers(
        organizationId,
        role.id,
        { page, limit: USERS_PAGE_SIZE },
        { signal },
      ),
    [organizationId, role.id, page],
  );

  return (
    <Modal
      open
      onClose={onClose}
      title={`Users with ${role.name}`}
      description={`Members currently assigned the ${role.name} role.`}
      size="lg"
      footer={
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
      }
    >
      {users.loading && !users.data ? (
        <LoadingBlock label="Loading users" rows={3} />
      ) : users.error ? (
        <ErrorState message={users.error} onRetry={users.reload} />
      ) : (users.data?.data.length ?? 0) === 0 ? (
        <EmptyState
          title="No users assigned"
          description="Assign this role from the People page in Organization."
          icon={<UsersIcon className="h-5 w-5" />}
        />
      ) : (
        <div className="space-y-3">
          <TableShell>
            <thead>
              <tr>
                <Th>Member</Th>
                <Th>Status</Th>
                <Th>Assigned</Th>
              </tr>
            </thead>
            <tbody>
              {users.data?.data.map((member) => (
                <tr key={member.id} className="hover:bg-surface-muted">
                  <Td>
                    <p className="font-medium text-ink">{member.user?.name ?? member.userId}</p>
                    <p className="text-xs text-muted">{member.user?.email ?? ""}</p>
                  </Td>
                  <Td>
                    <MembershipStatusBadge status={member.status} />
                  </Td>
                  <Td className="text-xs text-muted">
                    {formatDate(member.createdAt, timezone)}
                  </Td>
                </tr>
              ))}
            </tbody>
          </TableShell>
          <Pagination
            page={page}
            totalPages={users.data?.meta.totalPages ?? 1}
            onPageChange={setPage}
          />
        </div>
      )}
    </Modal>
  );
}

export function RolesView() {
  const { organization, membership } = useWorkspace();
  const organizationId = organization?.id ?? "";
  const timezone = organization?.timezone ?? "UTC";
  const canManage = hasPermission(membership, "role:manage");
  const canCustomizeManager = canManage && membership?.role === "OWNER";
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<RoleSummary | null>(null);
  const [usersRole, setUsersRole] = useState<RoleSummary | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<RoleSummary | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [restoreTarget, setRestoreTarget] = useState<RoleSummary | null>(null);
  const [restoreBusy, setRestoreBusy] = useState(false);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const roles = useApi(
    (signal) => listRoles(organizationId, { signal }),
    [organizationId],
    { enabled: Boolean(organizationId) },
  );
  const catalog = useApi(
    (signal) => listPermissionCatalog(organizationId, { signal }),
    [organizationId],
    { enabled: Boolean(organizationId) },
  );

  if (!organization) return <NoOrganization />;

  const allRoles = roles.data?.data ?? [];
  const query = search.trim().toLowerCase();
  const filtered = query
    ? allRoles.filter(
        (role) =>
          role.name.toLowerCase().includes(query) ||
          (role.description ?? "").toLowerCase().includes(query) ||
          role.permissions.some((permission) => permission.toLowerCase().includes(query)),
      )
    : allRoles;
  const customCount = allRoles.filter((role) => !role.builtIn).length;

  function handleSaved(message: string) {
    setNotice(message);
    setCreating(false);
    setEditing(null);
    roles.reload();
  }

  async function confirmDelete() {
    if (!deleteTarget || deleteBusy) return;
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      await deleteRole(organizationId, deleteTarget.id);
      setNotice(`${deleteTarget.name} was deleted.`);
      setDeleteTarget(null);
      roles.reload();
      window.dispatchEvent(new Event("tn:permissions-changed"));
    } catch (caught) {
      setDeleteError(errorMessage(caught));
    } finally {
      setDeleteBusy(false);
    }
  }

  async function confirmRestore() {
    if (!restoreTarget || restoreBusy) return;
    setRestoreBusy(true);
    setRestoreError(null);
    try {
      await resetManagerRole(organizationId);
      setNotice("Manager role restored to defaults.");
      setRestoreTarget(null);
      roles.reload();
      window.dispatchEvent(new Event("tn:permissions-changed"));
    } catch (caught) {
      setRestoreError(errorMessage(caught));
    } finally {
      setRestoreBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={organization.name}
        title="Roles & permissions"
        description="Owner, admin, and employee roles are protected. Owners can customize the Manager role for this organization, and owners or admins can create custom roles with explicit permissions."
        actions={
          canManage ? (
            <Button onClick={() => setCreating(true)} disabled={!catalog.data}>
              <PlusIcon className="h-4 w-4" />
              Create role
            </Button>
          ) : null
        }
      />

      {notice ? (
        <Alert tone="success">
          {notice}
        </Alert>
      ) : null}

      {!canManage ? (
        <Alert tone="info" title="Read-only access">
          You can review roles. Only the organization owner can customize the Manager role;
          owners and administrators can create, edit, assign, or delete custom roles.
        </Alert>
      ) : null}

      <Card>
        <CardHeader
          title="Organization roles"
          description={`${customCount} custom role${customCount === 1 ? "" : "s"} · ${
            allRoles.length
          } total`}
          actions={
            <div className="relative">
              <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
              <input
                type="search"
                aria-label="Search roles"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search roles"
                className="h-8 w-56 rounded-lg border border-line bg-surface pl-8 pr-2 text-xs text-ink outline-none transition focus:border-ink focus:ring-2 focus:ring-ink/10"
              />
            </div>
          }
        />

        {roles.loading && !roles.data ? (
          <LoadingBlock label="Loading roles" rows={4} />
        ) : roles.error ? (
          <div className="p-4">
            <ErrorState message={roles.error} onRetry={roles.reload} />
          </div>
        ) : catalog.error ? (
          <div className="p-4">
            <ErrorState message={catalog.error} onRetry={catalog.reload} />
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            title="No roles match your search"
            description="Try a different name, description, or permission."
            icon={<KeyIcon className="h-5 w-5" />}
            action={
              <Button variant="secondary" size="sm" onClick={() => setSearch("")}>
                Clear search
              </Button>
            }
          />
        ) : (
          <TableShell>
            <thead>
              <tr>
                <Th>Role</Th>
                <Th>Permissions</Th>
                <Th>Assigned</Th>
                <Th>Data scope</Th>
                <Th className="text-right">Actions</Th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((role) => (
                <RoleRow
                  key={role.key}
                  role={role}
                  catalog={catalog.data?.data}
                  canManage={canManage}
                  canCustomizeManager={canCustomizeManager}
                  onEdit={() => setEditing(role)}
                  onDelete={() => {
                    setDeleteError(null);
                    setDeleteTarget(role);
                  }}
                  onRestore={() => {
                    setRestoreError(null);
                    setRestoreTarget(role);
                  }}
                  onViewUsers={() => setUsersRole(role)}
                />
              ))}
            </tbody>
          </TableShell>
        )}

        {customCount === 0 && !roles.loading && !query ? (
          <div className="border-t border-line px-4 py-3 text-xs leading-5 text-muted">
            No custom roles yet. Owner, admin, and employee roles are protected; the owner can
            customize the Manager role. Create a custom role to delegate specific access, then
            assign it from the People page.
          </div>
        ) : null}
      </Card>

      {creating && catalog.data ? (
        <RoleEditorModal
          organizationId={organizationId}
          role={null}
          catalog={catalog.data.data}
          onClose={() => setCreating(false)}
          onSaved={handleSaved}
        />
      ) : null}

      {editing && catalog.data ? (
        <RoleEditorModal
          key={`${editing.id}:${editing.customized}:${editing.permissions.length}`}
          organizationId={organizationId}
          role={editing}
          catalog={catalog.data.data}
          manager={editing.customizable}
          onClose={() => setEditing(null)}
          onSaved={handleSaved}
        />
      ) : null}

      {usersRole ? (
        <RoleUsersModal
          organizationId={organizationId}
          role={usersRole}
          timezone={timezone}
          onClose={() => setUsersRole(null)}
        />
      ) : null}

      <ConfirmDialog
        open={deleteTarget !== null}
        title={`Delete ${deleteTarget?.name ?? "role"}?`}
        description="This permanently removes the custom role. It cannot be undone."
        confirmLabel="Delete role"
        busy={deleteBusy}
        error={deleteError}
        onClose={() => {
          if (!deleteBusy) {
            setDeleteTarget(null);
            setDeleteError(null);
          }
        }}
        onConfirm={confirmDelete}
      >
        <p className="text-xs leading-5 text-ink-secondary">
          {deleteTarget && deleteTarget.assignedUserCount > 0
            ? `${deleteTarget.assignedUserCount} user${
                deleteTarget.assignedUserCount === 1 ? "" : "s"
              } still use this role. Reassign them from the People page first.`
            : "Only custom roles with no assigned users can be deleted. Built-in roles can never be deleted."}
        </p>
      </ConfirmDialog>

      <ConfirmDialog
        open={restoreTarget !== null}
        title="Restore the default Manager role?"
        description="This removes the organization-specific customization and returns Manager to its built-in permissions and data access scope."
        confirmLabel="Restore defaults"
        busy={restoreBusy}
        error={restoreError}
        onClose={() => {
          if (!restoreBusy) {
            setRestoreTarget(null);
            setRestoreError(null);
          }
        }}
        onConfirm={confirmRestore}
      >
        <p className="text-xs leading-5 text-ink-secondary">
          Managers keep their assignments. Only the permissions and data access scope change, and
          the change takes effect on their next request.
        </p>
      </ConfirmDialog>
    </div>
  );
}
