"use client";

import { useMemo, useState } from "react";
import { formatDateTime, isDateOnly } from "@/lib/format";
import { hasPermission } from "@/lib/permissions";
import {
  accrualFrequencyLabel,
  formatLeaveUnits,
  workingDaysLabel,
} from "@/lib/leave";
import {
  createLeaveType,
  listLeaveTypes,
  updateLeavePolicy,
  updateLeaveType,
  type CreateLeaveTypeInput,
  type UpdateLeavePolicyInput,
} from "@/lib/leave-api";
import { leaveErrorMessage } from "@/lib/leave-errors";
import {
  LEAVE_ACCRUAL_FREQUENCIES,
  type LeaveAccrualFrequency,
  type LeaveType,
} from "@/lib/types";
import { useApi } from "@/lib/use-api";
import { CalendarIcon, PlusIcon } from "./icons";
import { ConfirmDialog } from "./confirm-dialog";
import { LeaveTabs } from "./leave-tabs";
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
  PageHeader,
  Select,
  TableShell,
  Td,
  Textarea,
  Th,
  cn,
} from "./ui";
import { NoOrganization, useWorkspace } from "./workspace";

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const WEEKDAYS = [
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
  { value: 7, label: "Sun" },
];

const NEW_TYPE_DEFAULTS = {
  name: "",
  description: "",
  isActive: true,
  isPaid: true,
  requiresBalance: true,
  allowNegativeBalance: false,
  maxConsecutiveDays: "",
  minNoticeDays: "0",
  requiresDocumentation: false,
  allowApprovedCancellation: true,
  cancellationRequiresApproval: false,
};

type TypeFormState = typeof NEW_TYPE_DEFAULTS;

export function LeaveTypesView() {
  const { organization, membership } = useWorkspace();
  const organizationId = organization?.id ?? "";
  const canManage = hasPermission(membership, "leave:manage");
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<LeaveType | null>(null);
  const [policyType, setPolicyType] = useState<LeaveType | null>(null);
  const [toggleTarget, setToggleTarget] = useState<LeaveType | null>(null);
  const [toggleBusy, setToggleBusy] = useState(false);
  const [toggleError, setToggleError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const types = useApi(
    (signal) =>
      listLeaveTypes(organizationId, { signal, includeInactive: true }),
    [organizationId],
    { enabled: Boolean(organizationId) && canManage },
  );

  const rows = useMemo(
    () =>
      [...(types.data?.data ?? [])].sort(
        (left, right) =>
          Number(right.isActive) - Number(left.isActive) ||
          left.name.localeCompare(right.name),
      ),
    [types.data],
  );

  if (!organization) return <NoOrganization />;

  async function confirmToggle() {
    if (!toggleTarget || toggleBusy) return;
    setToggleBusy(true);
    setToggleError(null);
    try {
      const result = await updateLeaveType(organizationId, toggleTarget.id, {
        isActive: !toggleTarget.isActive,
      });
      setNotice(
        `${result.data.leaveType.name} is now ${result.data.leaveType.isActive ? "active" : "inactive"}.`,
      );
      setToggleTarget(null);
      types.reload();
    } catch (error) {
      setToggleError(leaveErrorMessage(error));
    } finally {
      setToggleBusy(false);
    }
  }

  function saved(message: string) {
    setCreating(false);
    setEditing(null);
    setPolicyType(null);
    setNotice(message);
    types.reload();
  }

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={`${organization.name} · ${organization.timezone}`}
        title="Leave types and policies"
        description="Configure the leave catalog, whether each type requires a balance, and the accrual and working-day policies that drive calculations."
        actions={
          canManage ? (
            <Button onClick={() => setCreating(true)}>
              <PlusIcon className="h-3.5 w-3.5" />
              Create leave type
            </Button>
          ) : undefined
        }
      />

      <LeaveTabs current="types" />

      {notice ? (
        <Alert tone="success">
          <span className="flex items-start justify-between gap-3">
            <span>{notice}</span>
            <button
              type="button"
              onClick={() => setNotice(null)}
              className="shrink-0 text-xs font-medium underline underline-offset-2"
            >
              Dismiss
            </button>
          </span>
        </Alert>
      ) : null}

      {!canManage ? (
        <EmptyState
          title="Catalog management requires leave:manage"
          description="Ask an owner or administrator to update leave types and policies."
        />
      ) : types.error ? (
        <ErrorState message={types.error} onRetry={types.reload} />
      ) : (
        <Card>
          <CardHeader
            title="Leave types"
            description={
              types.data
                ? `${rows.filter((type) => type.isActive).length} active · ${rows.filter((type) => !type.isActive).length} inactive`
                : "Loading leave types…"
            }
          />

          {types.loading && !types.data ? (
            <LoadingBlock label="Loading leave types" rows={4} />
          ) : rows.length === 0 ? (
            <EmptyState
              title="No leave types yet"
              description="Create a leave type to define its balance and eligibility rules."
              icon={<CalendarIcon className="h-5 w-5" />}
              action={
                canManage ? (
                  <Button size="sm" onClick={() => setCreating(true)}>
                    Create leave type
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <>
              <div className="hidden md:block">
                <TypeTable
                  types={rows}
                  timezone={organization.timezone}
                  onEdit={setEditing}
                  onPolicy={setPolicyType}
                  onToggle={(type) => {
                    setToggleError(null);
                    setToggleTarget(type);
                  }}
                />
              </div>
              <div className="divide-y divide-line md:hidden">
                {rows.map((type) => (
                  <TypeCard
                    key={type.id}
                    type={type}
                    onEdit={() => setEditing(type)}
                    onPolicy={() => setPolicyType(type)}
                    onToggle={() => {
                      setToggleError(null);
                      setToggleTarget(type);
                    }}
                  />
                ))}
              </div>
            </>
          )}
        </Card>
      )}

      {creating ? (
        <TypeFormModal
          key="new"
          organizationId={organization.id}
          type={null}
          onClose={() => setCreating(false)}
          onSaved={saved}
        />
      ) : null}

      {editing ? (
        <TypeFormModal
          key={editing.id}
          organizationId={organization.id}
          type={editing}
          onClose={() => setEditing(null)}
          onSaved={saved}
        />
      ) : null}

      {policyType ? (
        <PolicyFormModal
          key={`${policyType.id}:${policyType.policy?.updatedAt ?? "none"}`}
          organizationId={organization.id}
          type={policyType}
          onClose={() => setPolicyType(null)}
          onSaved={saved}
        />
      ) : null}

      <ConfirmDialog
        open={Boolean(toggleTarget)}
        title={
          toggleTarget
            ? `${toggleTarget.isActive ? "Deactivate" : "Activate"} ${toggleTarget.name}?`
            : "Update leave type"
        }
        description={
          toggleTarget?.isActive
            ? "Employees can no longer submit new requests for this leave type. Existing requests, balances, and ledger history are retained."
            : "Employees can submit new requests for this leave type again. Its policy status is managed separately."
        }
        confirmLabel={
          toggleTarget?.isActive ? "Deactivate leave type" : "Activate leave type"
        }
        tone={toggleTarget?.isActive ? "danger" : "primary"}
        busy={toggleBusy}
        error={toggleError}
        onConfirm={confirmToggle}
        onClose={() => {
          if (!toggleBusy) {
            setToggleTarget(null);
            setToggleError(null);
          }
        }}
      >
        {toggleTarget ? (
          <dl className="space-y-2 text-xs text-ink-secondary">
            <div className="flex justify-between gap-3">
              <dt className="text-muted">Current status</dt>
              <dd>{toggleTarget.isActive ? "Active" : "Inactive"}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted">Balance policy</dt>
              <dd>
                {toggleTarget.policy
                  ? toggleTarget.policy.isActive
                    ? "Active"
                    : "Inactive"
                  : "Not loaded"}
              </dd>
            </div>
          </dl>
        ) : null}
      </ConfirmDialog>
    </div>
  );
}

function TypeBadges({ type }: { type: LeaveType }) {
  return (
    <div className="flex flex-wrap gap-1">
      <Badge tone={type.isActive ? "success" : "neutral"}>
        {type.isActive ? "Active" : "Inactive"}
      </Badge>
      <Badge tone={type.isPaid ? "success" : "neutral"}>
        {type.isPaid ? "Paid" : "Unpaid"}
      </Badge>
      <Badge tone="outline">
        {type.requiresBalance ? "Balance required" : "No balance"}
      </Badge>
      {type.requiresBalance && type.allowNegativeBalance ? (
        <Badge tone="warning">Negative allowed</Badge>
      ) : null}
      {type.requiresDocumentation ? <Badge tone="info">Documentation</Badge> : null}
      {type.policy && !type.policy.isActive ? (
        <Badge tone="warning">Policy inactive</Badge>
      ) : null}
    </div>
  );
}

function policySummary(type: LeaveType): string {
  if (!type.policy) return "No policy loaded";
  const parts: string[] = [];
  if (type.requiresBalance) {
    parts.push(`${formatLeaveUnits(type.policy.initialEntitlement)} initial`);
    if (type.policy.accrualFrequency !== "NONE") {
      parts.push(
        `${accrualFrequencyLabel(type.policy.accrualFrequency)} · ${formatLeaveUnits(type.policy.accrualAmount)}`,
      );
    }
  }
  parts.push(`${workingDaysLabel(type.policy.workingDays)}`);
  return parts.join(" · ");
}

function TypeTable({
  types,
  timezone,
  onEdit,
  onPolicy,
  onToggle,
}: {
  types: LeaveType[];
  timezone: string;
  onEdit: (type: LeaveType) => void;
  onPolicy: (type: LeaveType) => void;
  onToggle: (type: LeaveType) => void;
}) {
  return (
    <TableShell className="min-w-[900px]">
      <thead>
        <tr>
          <Th>Leave type</Th>
          <Th>Classification</Th>
          <Th>Request rules</Th>
          <Th>Policy</Th>
          <Th>Updated</Th>
          <Th className="text-right"> </Th>
        </tr>
      </thead>
      <tbody>
        {types.map((type) => (
          <tr key={type.id} className="align-top hover:bg-surface-muted">
            <Td>
              <p className="font-medium text-ink">{type.name}</p>
              {type.description ? (
                <p className="mt-0.5 max-w-[260px] text-xs text-muted">
                  {type.description}
                </p>
              ) : null}
            </Td>
            <Td>
              <TypeBadges type={type} />
            </Td>
            <Td className="text-xs">
              <p>{type.minNoticeDays === 0 ? "No notice required" : `${type.minNoticeDays} day notice`}</p>
              <p className="text-muted">
                {type.maxConsecutiveDays === null
                  ? "No consecutive-day limit"
                  : `Up to ${type.maxConsecutiveDays} consecutive days`}
              </p>
              <p className="text-muted">
                {type.allowApprovedCancellation
                  ? type.cancellationRequiresApproval
                    ? "Approved cancellation needs review"
                    : "Approved cancellation allowed"
                  : "Approved cancellation blocked"}
              </p>
            </Td>
            <Td className="max-w-[280px] text-xs text-muted">{policySummary(type)}</Td>
            <Td className="whitespace-nowrap text-xs text-muted">
              {formatDateTime(type.updatedAt, timezone)}
            </Td>
            <Td>
              <div className="flex flex-wrap justify-end gap-1">
                <Button variant="secondary" size="sm" onClick={() => onEdit(type)}>
                  Edit
                </Button>
                <Button variant="ghost" size="sm" onClick={() => onPolicy(type)}>
                  Policy
                </Button>
                <Button variant="ghost" size="sm" onClick={() => onToggle(type)}>
                  {type.isActive ? "Deactivate" : "Activate"}
                </Button>
              </div>
            </Td>
          </tr>
        ))}
      </tbody>
    </TableShell>
  );
}

function TypeCard({
  type,
  onEdit,
  onPolicy,
  onToggle,
}: {
  type: LeaveType;
  onEdit: () => void;
  onPolicy: () => void;
  onToggle: () => void;
}) {
  return (
    <article className="px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[13px] font-semibold text-ink">{type.name}</p>
          {type.description ? (
            <p className="mt-0.5 text-xs leading-5 text-muted">{type.description}</p>
          ) : null}
        </div>
      </div>
      <div className="mt-2">
        <TypeBadges type={type} />
      </div>
      <p className="mt-2 text-xs text-muted">{policySummary(type)}</p>
      <p className="mt-1 text-xs text-muted">
        {type.minNoticeDays === 0 ? "No notice required" : `${type.minNoticeDays} day notice`}
        {" · "}
        {type.maxConsecutiveDays === null
          ? "No consecutive-day limit"
          : `Up to ${type.maxConsecutiveDays} consecutive days`}
      </p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <Button variant="secondary" size="sm" onClick={onEdit}>
          Edit
        </Button>
        <Button variant="secondary" size="sm" onClick={onPolicy}>
          Policy
        </Button>
        <Button variant="ghost" size="sm" onClick={onToggle}>
          {type.isActive ? "Deactivate" : "Activate"}
        </Button>
      </div>
    </article>
  );
}

function TypeFormModal({
  organizationId,
  type,
  onClose,
  onSaved,
}: {
  organizationId: string;
  type: LeaveType | null;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [form, setForm] = useState<TypeFormState>(() =>
    type
      ? {
          name: type.name,
          description: type.description ?? "",
          isActive: type.isActive,
          isPaid: type.isPaid,
          requiresBalance: type.requiresBalance,
          allowNegativeBalance: type.allowNegativeBalance,
          maxConsecutiveDays:
            type.maxConsecutiveDays === null ? "" : String(type.maxConsecutiveDays),
          minNoticeDays: String(type.minNoticeDays),
          requiresDocumentation: type.requiresDocumentation,
          allowApprovedCancellation: type.allowApprovedCancellation,
          cancellationRequiresApproval: type.cancellationRequiresApproval,
        }
      : NEW_TYPE_DEFAULTS,
  );
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function update<K extends keyof TypeFormState>(key: K, value: TypeFormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (submitting) return;
    setFormError(null);

    const name = form.name.trim();
    if (name.length < 2 || name.length > 120) {
      setFormError("The leave type name must be between 2 and 120 characters.");
      return;
    }
    const description = form.description.trim();
    if (description.length > 2000) {
      setFormError("The description must be 2000 characters or fewer.");
      return;
    }
    const maxConsecutiveRaw = form.maxConsecutiveDays.trim();
    const maxConsecutiveDays = maxConsecutiveRaw ? Number(maxConsecutiveRaw) : null;
    if (
      maxConsecutiveDays !== null &&
      (!Number.isInteger(maxConsecutiveDays) ||
        maxConsecutiveDays < 1 ||
        maxConsecutiveDays > 365)
    ) {
      setFormError("Maximum consecutive days must be a whole number from 1 to 365, or blank.");
      return;
    }
    const minNoticeDays = Number(form.minNoticeDays.trim() || "0");
    if (!Number.isInteger(minNoticeDays) || minNoticeDays < 0 || minNoticeDays > 365) {
      setFormError("Minimum notice must be a whole number of days from 0 to 365.");
      return;
    }

    const payload: CreateLeaveTypeInput = {
      name,
      description: description || null,
      isActive: form.isActive,
      isPaid: form.isPaid,
      requiresBalance: form.requiresBalance,
      allowNegativeBalance: form.requiresBalance && form.allowNegativeBalance,
      maxConsecutiveDays,
      minNoticeDays,
      requiresDocumentation: form.requiresDocumentation,
      allowApprovedCancellation: form.allowApprovedCancellation,
      cancellationRequiresApproval:
        form.allowApprovedCancellation && form.cancellationRequiresApproval,
    };

    setSubmitting(true);
    try {
      if (type) {
        await updateLeaveType(organizationId, type.id, payload);
        onSaved(`${name} was updated.`);
      } else {
        await createLeaveType(organizationId, payload);
        onSaved(
          `${name} was created with a default policy. Review its policy to set entitlement, accrual, and working days.`,
        );
      }
    } catch (error) {
      setFormError(leaveErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      dismissible={!submitting}
      title={type ? "Edit leave type" : "Create leave type"}
      description={
        type
          ? "Update how this leave type is classified and requested."
          : "Creates the type and a default policy. Policy amounts start at zero until you configure them."
      }
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button type="submit" form="leave-type-form" loading={submitting}>
            {type ? "Save changes" : "Create leave type"}
          </Button>
        </>
      }
    >
      <form id="leave-type-form" onSubmit={submit} className="space-y-4">
        {formError ? <Alert tone="danger">{formError}</Alert> : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" htmlFor="leave-type-name" required>
            <Input
              id="leave-type-name"
              value={form.name}
              maxLength={120}
              onChange={(event) => update("name", event.target.value)}
              data-autofocus
            />
          </Field>
          <Field
            label="Minimum notice (days)"
            htmlFor="leave-type-notice"
            hint="Days before the start date. 0 allows same-day requests."
          >
            <Input
              id="leave-type-notice"
              type="number"
              min={0}
              max={365}
              step={1}
              value={form.minNoticeDays}
              onChange={(event) => update("minNoticeDays", event.target.value)}
            />
          </Field>
        </div>

        <Field
          label="Description"
          htmlFor="leave-type-description"
          hint="Shown in the catalog. Up to 2000 characters."
        >
          <Textarea
            id="leave-type-description"
            value={form.description}
            maxLength={2000}
            onChange={(event) => update("description", event.target.value)}
          />
        </Field>

        <Field
          label="Maximum consecutive days"
          htmlFor="leave-type-max-days"
          hint="Leave blank for no limit."
        >
          <Input
            id="leave-type-max-days"
            type="number"
            min={1}
            max={365}
            step={1}
            value={form.maxConsecutiveDays}
            onChange={(event) => update("maxConsecutiveDays", event.target.value)}
          />
        </Field>

        <div className="grid gap-2 sm:grid-cols-2">
          <CheckField
            label="Paid leave"
            description="Distinguishes paid from unpaid leave in the catalog."
            checked={form.isPaid}
            onChange={(value) => update("isPaid", value)}
          />
          <CheckField
            label="Active"
            description="Inactive types are hidden from employees and reject new requests."
            checked={form.isActive}
            onChange={(value) => update("isActive", value)}
          />
          <CheckField
            label="Requires a balance"
            description="Requests reserve and consume balance. Unchecking is blocked while active requests exist."
            checked={form.requiresBalance}
            onChange={(value) => update("requiresBalance", value)}
          />
          <CheckField
            label="Allow negative balance"
            description="Only applies when this type requires a balance."
            checked={form.requiresBalance && form.allowNegativeBalance}
            disabled={!form.requiresBalance}
            onChange={(value) => update("allowNegativeBalance", value)}
          />
          <CheckField
            label="Requires documentation"
            description="Employees must supply a documentation reference when requesting leave."
            checked={form.requiresDocumentation}
            onChange={(value) => update("requiresDocumentation", value)}
          />
          <CheckField
            label="Allow approved leave cancellation"
            description="When off, approved requests cannot be cancelled."
            checked={form.allowApprovedCancellation}
            onChange={(value) => update("allowApprovedCancellation", value)}
          />
          <CheckField
            label="Cancellation needs review"
            description="Employee cancellations of approved leave wait for a reviewer."
            checked={form.allowApprovedCancellation && form.cancellationRequiresApproval}
            disabled={!form.allowApprovedCancellation}
            onChange={(value) => update("cancellationRequiresApproval", value)}
          />
        </div>
      </form>
    </Modal>
  );
}

type PolicyFormState = {
  initialEntitlement: string;
  accrualFrequency: LeaveAccrualFrequency;
  accrualAmount: string;
  accrualDayOfMonth: string;
  accrualEffectiveFrom: string;
  prorateAccrual: boolean;
  balancePeriodStartMonth: string;
  balancePeriodStartDay: string;
  carryForwardAllowance: string;
  maxBalance: string;
  prorateInitialEntitlement: boolean;
  workingDays: number[];
  isActive: boolean;
};

function PolicyFormModal({
  organizationId,
  type,
  onClose,
  onSaved,
}: {
  organizationId: string;
  type: LeaveType;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const policy = type.policy;
  const [form, setForm] = useState<PolicyFormState>(() => ({
    initialEntitlement: String(policy?.initialEntitlement ?? 0),
    accrualFrequency: policy?.accrualFrequency ?? "NONE",
    accrualAmount: String(policy?.accrualAmount ?? 0),
    accrualDayOfMonth: String(policy?.accrualDayOfMonth ?? 1),
    accrualEffectiveFrom: policy?.accrualEffectiveFrom ?? "",
    prorateAccrual: policy?.prorateAccrual ?? false,
    balancePeriodStartMonth: String(policy?.balancePeriodStartMonth ?? 1),
    balancePeriodStartDay: String(policy?.balancePeriodStartDay ?? 1),
    carryForwardAllowance: String(policy?.carryForwardAllowance ?? 0),
    maxBalance: policy?.maxBalance === null || policy?.maxBalance === undefined
      ? ""
      : String(policy.maxBalance),
    prorateInitialEntitlement: policy?.prorateInitialEntitlement ?? false,
    workingDays: policy?.workingDays ?? [1, 2, 3, 4, 5],
    isActive: policy?.isActive ?? true,
  }));
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function update<K extends keyof PolicyFormState>(key: K, value: PolicyFormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function toggleWorkingDay(day: number) {
    setForm((current) => ({
      ...current,
      workingDays: current.workingDays.includes(day)
        ? current.workingDays.filter((value) => value !== day)
        : [...current.workingDays, day].sort((left, right) => left - right),
    }));
  }

  if (!policy) {
    return (
      <Modal
        open
        onClose={onClose}
        title="Leave policy"
        description={`${type.name} has no policy loaded.`}
        size="sm"
        footer={
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        }
      >
        <Alert tone="warning">
          The catalog did not return a policy for this leave type. Refresh the catalog or
          contact support before changing its policy.
        </Alert>
      </Modal>
    );
  }

  const policyId = policy.id;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (submitting) return;
    setFormError(null);

    const initialEntitlement = Number(form.initialEntitlement.trim() || "0");
    const accrualAmount = Number(form.accrualAmount.trim() || "0");
    const accrualDayOfMonth = Number(form.accrualDayOfMonth);
    const carryForwardAllowance = Number(form.carryForwardAllowance.trim() || "0");
    const maxBalanceRaw = form.maxBalance.trim();
    const maxBalance = maxBalanceRaw ? Number(maxBalanceRaw) : null;
    const month = Number(form.balancePeriodStartMonth);
    const day = Number(form.balancePeriodStartDay);

    const amounts: Array<{ label: string; value: number }> = [
      { label: "Initial entitlement", value: initialEntitlement },
      { label: "Accrual amount", value: accrualAmount },
      { label: "Carry-forward allowance", value: carryForwardAllowance },
      ...(maxBalance === null
        ? []
        : [{ label: "Maximum balance", value: maxBalance }]),
    ];
    for (const { label, value } of amounts) {
      if (!Number.isFinite(value) || value < 0 || value > 3650) {
        setFormError(`${label} must be between 0 and 3650 days.`);
        return;
      }
    }
    if (!Number.isInteger(month) || month < 1 || month > 12) {
      setFormError("The balance period start month must be between January and December.");
      return;
    }
    if (!Number.isInteger(day) || day < 1 || day > 31) {
      setFormError("The balance period start day must be a whole number from 1 to 31.");
      return;
    }
    if (!Number.isInteger(accrualDayOfMonth) || accrualDayOfMonth < 1 || accrualDayOfMonth > 31) {
      setFormError("The accrual day of month must be a whole number from 1 to 31.");
      return;
    }
    if (form.accrualEffectiveFrom && !isDateOnly(form.accrualEffectiveFrom)) {
      setFormError("The accrual effective date must be a valid date.");
      return;
    }
    if (form.workingDays.length === 0) {
      setFormError("Select at least one working day.");
      return;
    }

    const payload: UpdateLeavePolicyInput = {
      initialEntitlement,
      accrualFrequency: form.accrualFrequency,
      accrualAmount,
      accrualDayOfMonth,
      accrualEffectiveFrom: form.accrualEffectiveFrom || null,
      prorateAccrual: form.prorateAccrual,
      balancePeriodStartMonth: month,
      balancePeriodStartDay: day,
      carryForwardAllowance,
      maxBalance,
      prorateInitialEntitlement: form.prorateInitialEntitlement,
      workingDays: [...form.workingDays].sort((left, right) => left - right),
      isActive: form.isActive,
    };

    setSubmitting(true);
    try {
      await updateLeavePolicy(organizationId, policyId, payload);
      onSaved(`${type.name} policy was updated.`);
    } catch (error) {
      setFormError(leaveErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      dismissible={!submitting}
      title={`${type.name} policy`}
      description="Policy changes affect subsequent lazy balance calculations for the current and future periods."
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button type="submit" form="leave-policy-form" loading={submitting}>
            Save policy
          </Button>
        </>
      }
    >
      <form id="leave-policy-form" onSubmit={submit} className="space-y-5">
        {formError ? <Alert tone="danger">{formError}</Alert> : null}

        {!type.requiresBalance ? (
          <Alert tone="info">
            This type does not require a balance, so entitlement, accrual, carry-forward, and
            cap settings do not affect requests today. Working days still determine which
            dates are chargeable.
          </Alert>
        ) : null}

        <section className="space-y-3" aria-labelledby="leave-policy-amounts">
          <h3
            id="leave-policy-amounts"
            className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted"
          >
            Entitlement and accrual
          </h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              label="Initial entitlement (days)"
              htmlFor="leave-policy-initial"
              hint="Credited at the start of each balance period."
            >
              <Input
                id="leave-policy-initial"
                type="number"
                min={0}
                max={3650}
                step="any"
                value={form.initialEntitlement}
                onChange={(event) => update("initialEntitlement", event.target.value)}
              />
            </Field>
            <Field
              label="Accrual frequency"
              htmlFor="leave-policy-frequency"
              hint="Tranches credit once their date is on or before today."
            >
              <Select
                id="leave-policy-frequency"
                value={form.accrualFrequency}
                onChange={(event) =>
                  update("accrualFrequency", event.target.value as LeaveAccrualFrequency)
                }
              >
                {LEAVE_ACCRUAL_FREQUENCIES.map((frequency) => (
                  <option key={frequency} value={frequency}>
                    {accrualFrequencyLabel(frequency)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              label="Accrual amount (days)"
              htmlFor="leave-policy-accrual"
              hint="Amount credited per tranche when accrual is enabled."
            >
              <Input
                id="leave-policy-accrual"
                type="number"
                min={0}
                max={3650}
                step="any"
                value={form.accrualAmount}
                onChange={(event) => update("accrualAmount", event.target.value)}
              />
            </Field>
            <Field
              label="Accrual day of month"
              htmlFor="leave-policy-accrual-day"
              hint="Day of the month each tranche credits, evaluated in the organization timezone."
            >
              <Input
                id="leave-policy-accrual-day"
                type="number"
                min={1}
                max={31}
                step={1}
                value={form.accrualDayOfMonth}
                onChange={(event) => update("accrualDayOfMonth", event.target.value)}
              />
            </Field>
            <Field
              label="Accrual effective from"
              htmlFor="leave-policy-accrual-effective"
              hint="No accrual is granted before this date. Leave blank to use today when accrual is first enabled."
            >
              <Input
                id="leave-policy-accrual-effective"
                type="date"
                value={form.accrualEffectiveFrom}
                onChange={(event) => update("accrualEffectiveFrom", event.target.value)}
              />
            </Field>
            <Field
              label="Carry-forward allowance (days)"
              htmlFor="leave-policy-carry"
              hint="Maximum credited from the previous period at period start."
            >
              <Input
                id="leave-policy-carry"
                type="number"
                min={0}
                max={3650}
                step="any"
                value={form.carryForwardAllowance}
                onChange={(event) => update("carryForwardAllowance", event.target.value)}
              />
            </Field>
            <Field
              label="Maximum balance (days)"
              htmlFor="leave-policy-max"
              hint="Blank means no cap. Caps automatic credits and rejects oversized credits."
            >
              <Input
                id="leave-policy-max"
                type="number"
                min={0}
                max={3650}
                step="any"
                value={form.maxBalance}
                onChange={(event) => update("maxBalance", event.target.value)}
              />
            </Field>
          </div>
        </section>

        <section className="space-y-3" aria-labelledby="leave-policy-period">
          <h3
            id="leave-policy-period"
            className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted"
          >
            Balance period
          </h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Start month" htmlFor="leave-policy-month">
              <Select
                id="leave-policy-month"
                value={form.balancePeriodStartMonth}
                onChange={(event) =>
                  update("balancePeriodStartMonth", event.target.value)
                }
              >
                {MONTHS.map((month, index) => (
                  <option key={month} value={String(index + 1)}>
                    {month}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              label="Start day"
              htmlFor="leave-policy-day"
              hint="Clamped to the month's length when the period starts."
            >
              <Input
                id="leave-policy-day"
                type="number"
                min={1}
                max={31}
                step={1}
                value={form.balancePeriodStartDay}
                onChange={(event) => update("balancePeriodStartDay", event.target.value)}
              />
            </Field>
          </div>
        </section>

        <section className="space-y-3" aria-labelledby="leave-policy-working">
          <h3
            id="leave-policy-working"
            className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted"
          >
            Working days
          </h3>
          <p className="text-xs leading-5 text-muted">
            Working days determine which weekdays are chargeable. Organization holidays are
            excluded automatically.
          </p>
          <div className="flex flex-wrap gap-2">
            {WEEKDAYS.map((weekday) => {
              const selected = form.workingDays.includes(weekday.value);
              return (
                <label
                  key={weekday.value}
                  className={cn(
                    "inline-flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium transition",
                    selected
                      ? "border-ink/30 bg-surface-muted text-ink"
                      : "border-line bg-surface text-muted hover:bg-surface-muted",
                  )}
                >
                  <input
                    type="checkbox"
                    className="h-3.5 w-3.5 accent-ink"
                    checked={selected}
                    onChange={() => toggleWorkingDay(weekday.value)}
                  />
                  {weekday.label}
                </label>
              );
            })}
          </div>
          <p className="text-[11px] text-muted">
            Selected: {workingDaysLabel(form.workingDays) || "None"}
          </p>
        </section>

        <div className="grid gap-2">
          <CheckField
            label="Prorate initial entitlement"
            description="Applies a proportional entitlement for employees who joined mid-period."
            checked={form.prorateInitialEntitlement}
            onChange={(value) => update("prorateInitialEntitlement", value)}
          />
          <CheckField
            label="Prorate accrual for mid-month joiners"
            description="Credits the first accrual tranche in proportion to the days remaining in the month the employee joined."
            checked={form.prorateAccrual}
            onChange={(value) => update("prorateAccrual", value)}
          />
          <CheckField
            label="Policy active"
            description="Inactive policies block new requests and balance adjustments for this type. Existing balances and requests are retained."
            checked={form.isActive}
            onChange={(value) => update("isActive", value)}
          />
        </div>
      </form>
    </Modal>
  );
}

function CheckField({
  label,
  description,
  checked,
  onChange,
  disabled = false,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label
      className={cn(
        "flex cursor-pointer items-start gap-3 rounded-lg border border-line bg-surface p-3 transition",
        disabled && "cursor-not-allowed opacity-60",
      )}
    >
      <input
        type="checkbox"
        className="mt-0.5 h-4 w-4 accent-ink"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="min-w-0">
        <span className="block text-xs font-semibold text-ink">{label}</span>
        <span className="mt-0.5 block text-[11px] leading-4 text-muted">{description}</span>
      </span>
    </label>
  );
}
