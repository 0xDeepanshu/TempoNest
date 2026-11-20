"use client";

import { useMemo, useState } from "react";
import { isDateOnly } from "@/lib/format";
import { hasPermission } from "@/lib/permissions";
import {
  accrualFrequencyLabel,
  carryForwardOrderLabel,
  formatLeaveUnits,
  resetPeriodLabel,
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
  LEAVE_CARRY_FORWARD_ORDERS,
  LEAVE_RESET_PERIODS,
  type LeaveAccrualFrequency,
  type LeaveCarryForwardOrder,
  type LeaveResetPeriod,
  type LeaveType,
} from "@/lib/types";
import { useApi } from "@/lib/use-api";
import { CalendarIcon, PlusIcon } from "./icons";
import { ConfirmDialog } from "./confirm-dialog";
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
  allowHalfDay: true,
  maxConsecutiveDays: "",
  minNoticeDays: "0",
  requiresDocumentation: false,
  allowApprovedCancellation: true,
  cancellationRequiresApproval: false,
};

type TypeFormState = typeof NEW_TYPE_DEFAULTS;

export function LeaveTypesView({ embedded = false }: { embedded?: boolean } = {}) {
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
      {embedded ? (
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold tracking-tight text-ink">Leave types</h2>
            <p className="mt-0.5 max-w-3xl text-[13px] leading-5 text-muted">
              What your team can request, and how each type earns days.
            </p>
          </div>
          {canManage ? (
            <Button onClick={() => setCreating(true)}>
              <PlusIcon className="h-3.5 w-3.5" />
              Create leave type
            </Button>
          ) : null}
        </div>
      ) : (
        <>
          <PageHeader
            eyebrow={`${organization.name} · ${organization.timezone}`}
            title="Leave types"
            description="Set up the leave your team can request, how many days they earn, and which days count as working days."
            actions={
              canManage ? (
                <Button onClick={() => setCreating(true)}>
                  <PlusIcon className="h-3.5 w-3.5" />
                  Create leave type
                </Button>
              ) : undefined
            }
          />
        </>
      )}

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
          title="You cannot change leave types"
          description="Ask an owner or administrator for leave-management access."
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
              description="Add a leave type so employees know what they can request."
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
            ? "Employees can no longer ask for this leave type. Past requests, balances, and history stay as they are."
            : "Employees can ask for this leave type again. Earning rules are handled separately."
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
              <dt className="text-muted">Earning rules</dt>
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
      <Badge tone="outline">{type.requiresBalance ? "Uses balance" : "No balance"}</Badge>
      {type.requiresBalance && type.allowNegativeBalance ? (
        <Badge tone="warning">Can go negative</Badge>
      ) : null}
      {!type.allowHalfDay ? <Badge tone="neutral">Full days only</Badge> : null}
      {type.requiresDocumentation ? <Badge tone="info">Proof needed</Badge> : null}
      {type.policy && !type.policy.isActive ? (
        <Badge tone="warning">Earning rules paused</Badge>
      ) : null}
    </div>
  );
}

const RESET_SUMMARY: Record<LeaveResetPeriod, string> = {
  CALENDAR_YEAR: "resets every January",
  FINANCIAL_YEAR: "resets each financial year",
  JOINING_ANNIVERSARY: "resets on the work anniversary",
  CUSTOM: "resets on a custom date",
  NEVER: "never resets",
};

function policySummary(type: LeaveType): string {
  if (!type.policy) return "No earning rules yet";
  const parts: string[] = [];

  if (type.requiresBalance) {
    parts.push(`${formatLeaveUnits(type.policy.initialEntitlement)} to start`);

    if (type.policy.accrualFrequency !== "NONE") {
      parts.push(
        `+${formatLeaveUnits(type.policy.accrualAmount)} ${accrualFrequencyLabel(
          type.policy.accrualFrequency,
        ).toLowerCase()}`,
      );
    }

    if (type.policy.carryForwardEnabled) {
      const expiry = type.policy.carryForwardExpiryMonths;
      parts.push(
        `carries over up to ${formatLeaveUnits(type.policy.carryForwardAllowance)}${
          expiry ? ` for ${expiry} month${expiry === 1 ? "" : "s"}` : ""
        }`,
      );
    }

    parts.push(RESET_SUMMARY[type.policy.resetPeriod]);

    if (type.policy.maxBalance !== null) {
      parts.push(`up to ${formatLeaveUnits(type.policy.maxBalance)} in total`);
    }
  } else {
    parts.push("Unlimited");
  }

  parts.push(`Working days: ${workingDaysLabel(type.policy.workingDays)}`);
  return parts.join(" · ");
}

function requestRules(type: LeaveType): string[] {
  return [
    type.minNoticeDays === 0
      ? "No advance notice"
      : `${type.minNoticeDays} day${type.minNoticeDays === 1 ? "" : "s"} notice`,
    type.maxConsecutiveDays === null
      ? "No limit per request"
      : `Up to ${type.maxConsecutiveDays} day${type.maxConsecutiveDays === 1 ? "" : "s"} per request`,
    type.allowApprovedCancellation
      ? type.cancellationRequiresApproval
        ? "Can cancel after approval (needs review)"
        : "Can cancel after approval"
      : "Cannot cancel after approval",
  ];
}

function TypeTable({
  types,
  onEdit,
  onPolicy,
  onToggle,
}: {
  types: LeaveType[];
  onEdit: (type: LeaveType) => void;
  onPolicy: (type: LeaveType) => void;
  onToggle: (type: LeaveType) => void;
}) {
  return (
    <TableShell className="min-w-[760px]">
      <thead>
        <tr>
          <Th>Leave type</Th>
          <Th>Request rules</Th>
          <Th>How days are earned</Th>
          <Th className="text-right">Actions</Th>
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
              <div className="mt-1.5">
                <TypeBadges type={type} />
              </div>
            </Td>
            <Td className="text-xs">
              {requestRules(type).map((rule, index) => (
                <p key={rule} className={index === 0 ? undefined : "text-muted"}>
                  {rule}
                </p>
              ))}
            </Td>
            <Td className="max-w-[280px] text-xs text-muted">{policySummary(type)}</Td>
            <Td>
              <div className="flex flex-wrap justify-end gap-1">
                <Button variant="secondary" size="sm" onClick={() => onEdit(type)}>
                  Edit details
                </Button>
                <Button variant="ghost" size="sm" onClick={() => onPolicy(type)}>
                  Earning rules
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
      <p className="mt-1 text-xs text-muted">{requestRules(type).join(" · ")}</p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <Button variant="secondary" size="sm" onClick={onEdit}>
          Edit details
        </Button>
        <Button variant="secondary" size="sm" onClick={onPolicy}>
          Earning rules
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
          allowHalfDay: type.allowHalfDay,
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
      allowHalfDay: form.allowHalfDay,
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
          `${name} was created with zero days. Open its earning rules to add starting days, carry-over, and working days.`,
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
          ? "Change the name, who can request it, and the request rules."
          : "We start the type at zero days. Set how days are earned next."
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
            label="Advance notice (days)"
            htmlFor="leave-type-notice"
            hint="How many days before the start date a request must be made. 0 allows same-day requests."
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
          hint="Shown to employees when they pick a leave type."
        >
          <Textarea
            id="leave-type-description"
            value={form.description}
            maxLength={2000}
            onChange={(event) => update("description", event.target.value)}
          />
        </Field>

        <Field
          label="Max days per request"
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
            description="Tells employees whether this leave is paid or unpaid."
            checked={form.isPaid}
            onChange={(value) => update("isPaid", value)}
          />
          <CheckField
            label="Active"
            description="Inactive types are hidden from employees and cannot be requested."
            checked={form.isActive}
            onChange={(value) => update("isActive", value)}
          />
          <CheckField
            label="Uses a balance"
            description="Requests hold and then use days from the employee's balance. You cannot turn this off while requests are open."
            checked={form.requiresBalance}
            onChange={(value) => update("requiresBalance", value)}
          />
          <CheckField
            label="Can go negative"
            description="Only applies when this type uses a balance."
            checked={form.requiresBalance && form.allowNegativeBalance}
            disabled={!form.requiresBalance}
            onChange={(value) => update("allowNegativeBalance", value)}
          />
          <CheckField
            label="Allow half days"
            description="Employees can take a half day on the first and/or last day."
            checked={form.allowHalfDay}
            onChange={(value) => update("allowHalfDay", value)}
          />
          <CheckField
            label="Needs proof"
            description="Employees must attach a document reference when they apply."
            checked={form.requiresDocumentation}
            onChange={(value) => update("requiresDocumentation", value)}
          />
          <CheckField
            label="Can cancel after approval"
            description="When off, approved requests stay approved."
            checked={form.allowApprovedCancellation}
            onChange={(value) => update("allowApprovedCancellation", value)}
          />
          <CheckField
            label="Cancellation needs review"
            description="Cancelling approved leave waits for a reviewer."
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
  carryForwardEnabled: boolean;
  carryForwardAllowance: string;
  carryForwardExpiryMonths: string;
  carryForwardOrder: LeaveCarryForwardOrder;
  resetPeriod: LeaveResetPeriod;
  maxCreditsPerApplication: string;
  monthlyUsageLimitEnabled: boolean;
  monthlyUsageLimit: string;
  maxBalance: string;
  prorateInitialEntitlement: boolean;
  workingDays: number[];
  isActive: boolean;
};

/** Expiry durations offered by the UI; the API accepts 1–120 months. */
const EXPIRY_MONTH_OPTIONS = [
  { value: "", label: "No expiry" },
  { value: "1", label: "1 month" },
  { value: "2", label: "2 months" },
  { value: "3", label: "3 months" },
  { value: "6", label: "6 months" },
  { value: "12", label: "12 months" },
];

function optionalNumber(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

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
    carryForwardEnabled:
      policy?.carryForwardEnabled ?? (policy?.carryForwardAllowance ?? 0) > 0,
    carryForwardAllowance: String(policy?.carryForwardAllowance ?? 0),
    carryForwardExpiryMonths:
      policy?.carryForwardExpiryMonths === null ||
      policy?.carryForwardExpiryMonths === undefined
        ? ""
        : String(policy.carryForwardExpiryMonths),
    carryForwardOrder: policy?.carryForwardOrder ?? "EXPIRY_FIRST",
    resetPeriod: policy?.resetPeriod ?? "CUSTOM",
    maxCreditsPerApplication:
      policy?.maxCreditsPerApplication === null ||
      policy?.maxCreditsPerApplication === undefined
        ? ""
        : String(policy.maxCreditsPerApplication),
    monthlyUsageLimitEnabled: policy?.monthlyUsageLimitEnabled ?? false,
    monthlyUsageLimit:
      policy?.monthlyUsageLimit === null || policy?.monthlyUsageLimit === undefined
        ? ""
        : String(policy.monthlyUsageLimit),
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
        title="Earning rules"
        description={`${type.name} has no earning rules loaded.`}
        size="sm"
        footer={
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        }
      >
        <Alert tone="warning">
          This leave type has no earning rules yet. Refresh the page, and contact support if it
          still does not appear, before changing anything.
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
    const carryForwardAllowance = form.carryForwardEnabled
      ? Number(form.carryForwardAllowance.trim() || "0")
      : 0;
    const carryForwardExpiryMonths = form.carryForwardEnabled
      ? optionalNumber(form.carryForwardExpiryMonths)
      : null;
    const maxCreditsPerApplication = optionalNumber(form.maxCreditsPerApplication);
    const monthlyUsageLimit = optionalNumber(form.monthlyUsageLimit);
    const maxBalance = optionalNumber(form.maxBalance);
    const month = Number(form.balancePeriodStartMonth);
    const day = Number(form.balancePeriodStartDay);

    const amounts: Array<{ label: string; value: number }> = [
      { label: "Starting days", value: initialEntitlement },
      { label: "Days added each time", value: accrualAmount },
      { label: "Max days carried over", value: carryForwardAllowance },
      ...(maxBalance === null
        ? []
        : [{ label: "Max balance", value: maxBalance }]),
      ...(maxCreditsPerApplication === null
        ? []
        : [{ label: "Max days per request", value: maxCreditsPerApplication }]),
      ...(monthlyUsageLimit === null
        ? []
        : [{ label: "Max days per month", value: monthlyUsageLimit }]),
    ];
    for (const { label, value } of amounts) {
      if (!Number.isFinite(value) || value < 0 || value > 3650) {
        setFormError(`${label} must be between 0 and 3650 days.`);
        return;
      }
    }
    if (form.carryForwardEnabled && carryForwardAllowance <= 0) {
      setFormError(
        "Enter a number of days to carry over greater than zero, or turn carry-over off.",
      );
      return;
    }
    if (maxCreditsPerApplication !== null && maxCreditsPerApplication <= 0) {
      setFormError(
        "Max days per request must be greater than zero, or left blank for no limit.",
      );
      return;
    }
    if (
      form.monthlyUsageLimitEnabled &&
      (monthlyUsageLimit === null || monthlyUsageLimit <= 0)
    ) {
      setFormError("Enter a positive monthly usage limit, or turn the limit off.");
      return;
    }
    if (
      form.carryForwardEnabled &&
      form.carryForwardExpiryMonths &&
      (carryForwardExpiryMonths === null ||
        !Number.isInteger(carryForwardExpiryMonths) ||
        carryForwardExpiryMonths < 1 ||
        carryForwardExpiryMonths > 120)
    ) {
      setFormError("The carry-forward expiry must be between 1 and 120 months.");
      return;
    }
    if (!Number.isInteger(month) || month < 1 || month > 12) {
      setFormError("The period start month must be between January and December.");
      return;
    }
    if (!Number.isInteger(day) || day < 1 || day > 31) {
      setFormError("The period start day must be a whole number from 1 to 31.");
      return;
    }
    if (!Number.isInteger(accrualDayOfMonth) || accrualDayOfMonth < 1 || accrualDayOfMonth > 31) {
      setFormError("The day of the month must be a whole number from 1 to 31.");
      return;
    }
    if (form.accrualEffectiveFrom && !isDateOnly(form.accrualEffectiveFrom)) {
      setFormError("The start-adding-days date must be a valid date.");
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
      carryForwardEnabled: form.carryForwardEnabled,
      carryForwardAllowance,
      carryForwardExpiryMonths,
      carryForwardOrder: form.carryForwardOrder,
      resetPeriod: form.resetPeriod,
      maxCreditsPerApplication,
      monthlyUsageLimitEnabled: form.monthlyUsageLimitEnabled,
      monthlyUsageLimit: form.monthlyUsageLimitEnabled ? monthlyUsageLimit : null,
      maxBalance,
      prorateInitialEntitlement: form.prorateInitialEntitlement,
      workingDays: [...form.workingDays].sort((left, right) => left - right),
      isActive: form.isActive,
    };

    setSubmitting(true);
    try {
      await updateLeavePolicy(organizationId, policyId, payload);
      onSaved(`${type.name} earning rules were updated.`);
    } catch (error) {
      setFormError(leaveErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  }

  const summaryInitial = Number(form.initialEntitlement.trim() || "0");
  const summaryAccrual = Number(form.accrualAmount.trim() || "0");
  const summaryAllowance = Number(form.carryForwardAllowance.trim() || "0");
  const summaryExpiry = optionalNumber(form.carryForwardExpiryMonths);
  const summaryMaxBalance = optionalNumber(form.maxBalance);
  const summaryMaxPerApplication = optionalNumber(form.maxCreditsPerApplication);
  const summaryMonthlyLimit = optionalNumber(form.monthlyUsageLimit);
  const summaryParts: string[] = [];

  if (!type.requiresBalance) {
    summaryParts.push(
      "This type does not use a balance, so earning and limit settings do not block requests.",
    );
  } else {
    if (summaryInitial > 0) {
      summaryParts.push(`${formatLeaveUnits(summaryInitial)} at the start of each period`);
    }
    if (form.accrualFrequency !== "NONE" && summaryAccrual > 0) {
      summaryParts.push(
        `+${formatLeaveUnits(summaryAccrual)} ${accrualFrequencyLabel(
          form.accrualFrequency,
        ).toLowerCase()}`,
      );
    }
    if (form.carryForwardEnabled) {
      const base =
        summaryAllowance > 0
          ? `carries over up to ${formatLeaveUnits(summaryAllowance)} of unused leave`
          : "carries over unused leave";
      summaryParts.push(
        summaryExpiry
          ? `${base}, expiring after ${summaryExpiry} month${summaryExpiry === 1 ? "" : "s"}`
          : `${base} with no expiry`,
      );
      summaryParts.push(
        `used ${carryForwardOrderLabel(form.carryForwardOrder).toLowerCase()}`,
      );
    } else {
      summaryParts.push("no carry-over");
    }
    summaryParts.push(RESET_SUMMARY[form.resetPeriod]);
    if (summaryMaxPerApplication !== null) {
      summaryParts.push(`max ${formatLeaveUnits(summaryMaxPerApplication)} per request`);
    }
    if (form.monthlyUsageLimitEnabled && summaryMonthlyLimit !== null) {
      summaryParts.push(`max ${formatLeaveUnits(summaryMonthlyLimit)} a month`);
    }
    if (summaryMaxBalance !== null) {
      summaryParts.push(`up to ${formatLeaveUnits(summaryMaxBalance)} in total`);
    }
  }

  const summaryText = summaryParts.join(" · ");
  const showPeriodFields =
    form.resetPeriod === "CUSTOM" || form.resetPeriod === "FINANCIAL_YEAR";

  return (
    <Modal
      open
      onClose={onClose}
      dismissible={!submitting}
      title={`${type.name} earning rules`}
      description="Changes apply from now on. Past balances, requests, and history stay as they are."
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button type="submit" form="leave-policy-form" loading={submitting}>
            Save changes
          </Button>
        </>
      }
    >
      <form id="leave-policy-form" onSubmit={submit} className="space-y-5">
        {formError ? <Alert tone="danger">{formError}</Alert> : null}

        {!type.requiresBalance ? (
          <Alert tone="info">
            This type does not use an allowance, so starting days, scheduled days, carry-over,
            and caps do not affect requests. Working days still decide which dates count.
          </Alert>
        ) : null}

        <div className="rounded-lg border border-accent-soft bg-accent-soft p-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">
            In plain English
          </p>
          <p className="mt-1 text-[13px] leading-5 text-ink">{summaryText}</p>
        </div>

        <section className="space-y-3" aria-labelledby="leave-policy-amounts">
          <h3
            id="leave-policy-amounts"
            className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted"
          >
            Leave allocation
          </h3>
          <p className="text-xs leading-5 text-muted">
            Days granted at the start of each period. Owners can also add extra days to one
            person at any time.
          </p>
          <Field
            label="Starting days each period"
            htmlFor="leave-policy-initial"
            hint="Added automatically at the start of every balance period."
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
          <CheckField
            label="Prorate starting days"
            description="People who joined part-way through a period get a share instead of the full amount."
            checked={form.prorateInitialEntitlement}
            onChange={(value) => update("prorateInitialEntitlement", value)}
          />
        </section>

        <section className="space-y-3" aria-labelledby="leave-policy-accrual">
          <h3
            id="leave-policy-accrual"
            className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted"
          >
            Monthly or yearly credits
          </h3>
          <p className="text-xs leading-5 text-muted">
            Leave this off if you add days yourself. When on, WorkZen adds them automatically on
            the schedule below.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              label="How often days are added"
              htmlFor="leave-policy-frequency"
              hint="Each scheduled batch is added once its date arrives."
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
            {form.accrualFrequency !== "NONE" ? (
              <>
                <Field
                  label="Days added each time"
                  htmlFor="leave-policy-accrual-amount"
                  hint="How many days are added on each scheduled date."
                >
                  <Input
                    id="leave-policy-accrual-amount"
                    type="number"
                    min={0}
                    max={3650}
                    step="any"
                    value={form.accrualAmount}
                    onChange={(event) => update("accrualAmount", event.target.value)}
                  />
                </Field>
                <Field
                  label="Day of the month"
                  htmlFor="leave-policy-accrual-day"
                  hint="Which day of the month to add them, in the organization's timezone."
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
                  label="Start adding days from"
                  htmlFor="leave-policy-accrual-effective"
                  hint="Nothing is added before this date. Leave blank to start today."
                >
                  <Input
                    id="leave-policy-accrual-effective"
                    type="date"
                    value={form.accrualEffectiveFrom}
                    onChange={(event) => update("accrualEffectiveFrom", event.target.value)}
                  />
                </Field>
              </>
            ) : null}
          </div>
          {form.accrualFrequency !== "NONE" ? (
            <CheckField
              label="Prorate the first month"
              description="Someone who joined part-way through the month gets a share of it."
              checked={form.prorateAccrual}
              onChange={(value) => update("prorateAccrual", value)}
            />
          ) : (
            <p className="text-[11px] text-muted">
              Days are only added when you add them yourself.
            </p>
          )}
        </section>

        <section className="space-y-3" aria-labelledby="leave-policy-usage">
          <h3
            id="leave-policy-usage"
            className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted"
          >
            Usage restrictions
          </h3>
          <p className="text-xs leading-5 text-muted">
            Limits are checked when someone applies. Pending and approved leave both count;
            rejected and cancelled requests do not.
          </p>
          <CheckField
            label="Limit days per month"
            description="Caps how many days of this leave type one person can take in a calendar month."
            checked={form.monthlyUsageLimitEnabled}
            onChange={(value) => update("monthlyUsageLimitEnabled", value)}
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              label="Max days per request"
              htmlFor="leave-policy-max-application"
              hint="Leave blank for no limit."
            >
              <Input
                id="leave-policy-max-application"
                type="number"
                min={0}
                max={3650}
                step="any"
                value={form.maxCreditsPerApplication}
                onChange={(event) => update("maxCreditsPerApplication", event.target.value)}
              />
            </Field>
            {form.monthlyUsageLimitEnabled ? (
              <Field
                label="Max days per month"
                htmlFor="leave-policy-monthly-limit"
                hint="Counts pending and approved leave. A request that spans two months is checked against each one."
              >
                <Input
                  id="leave-policy-monthly-limit"
                  type="number"
                  min={0}
                  max={3650}
                  step="any"
                  value={form.monthlyUsageLimit}
                  onChange={(event) => update("monthlyUsageLimit", event.target.value)}
                />
              </Field>
            ) : null}
          </div>
          <p className="text-[11px] text-muted">
            Half days count as 0.5.{" "}
            {type.allowHalfDay
              ? "Half-day requests are allowed for this type."
              : "Half-day requests are disabled for this type."}
          </p>
        </section>

        <section className="space-y-3" aria-labelledby="leave-policy-carry-forward">
          <h3
            id="leave-policy-carry-forward"
            className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted"
          >
            Carry-over
          </h3>
          <p className="text-xs leading-5 text-muted">
            Unused days can roll into the next period. They only expire if you set a limit below.
          </p>
          <CheckField
            label="Carry unused days into the next period"
            description="At reset, unused days up to the cap move into the new period instead of being lost."
            checked={form.carryForwardEnabled}
            onChange={(value) => update("carryForwardEnabled", value)}
          />
          {form.carryForwardEnabled ? (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field
                  label="Max days carried over"
                  htmlFor="leave-policy-carry"
                  hint="The most that can move into the next period."
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
                  label="Carried days expire after"
                  htmlFor="leave-policy-carry-expiry"
                  hint="How long carried-over days stay usable. Choose no expiry to keep them."
                >
                  <Select
                    id="leave-policy-carry-expiry"
                    value={form.carryForwardExpiryMonths}
                    onChange={(event) =>
                      update("carryForwardExpiryMonths", event.target.value)
                    }
                  >
                    {EXPIRY_MONTH_OPTIONS.map((option) => (
                      <option key={option.value || "none"} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              <Field
                label="Days used first"
                htmlFor="leave-policy-carry-order"
                hint="Which days get used when someone takes leave."
              >
                <Select
                  id="leave-policy-carry-order"
                  value={form.carryForwardOrder}
                  onChange={(event) =>
                    update("carryForwardOrder", event.target.value as LeaveCarryForwardOrder)
                  }
                >
                  {LEAVE_CARRY_FORWARD_ORDERS.map((order) => (
                    <option key={order} value={order}>
                      {carryForwardOrderLabel(order)}
                    </option>
                  ))}
                </Select>
              </Field>
              <p className="text-[11px] text-muted">
                {summaryExpiry
                  ? `Carried days expire ${summaryExpiry} month${summaryExpiry === 1 ? "" : "s"} after they move over. Expired days stay in the history.`
                  : "Carried days do not expire."}
              </p>
            </>
          ) : (
            <p className="text-[11px] text-muted">
              Unused days are cleared at reset and nothing expires.
            </p>
          )}
        </section>

        <section className="space-y-3" aria-labelledby="leave-policy-period">
          <h3
            id="leave-policy-period"
            className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted"
          >
            Reset &amp; expiry
          </h3>
          <p className="text-xs leading-5 text-muted">
            Choose when balances reset. Once balances exist, a schedule that would move people
            into a different period is blocked, so history never overlaps.
          </p>
          <Field
            label="When balances reset"
            htmlFor="leave-policy-reset"
            hint="Calendar year always starts on 1 January. Financial year and custom use the month and day below."
          >
            <Select
              id="leave-policy-reset"
              value={form.resetPeriod}
              onChange={(event) =>
                update("resetPeriod", event.target.value as LeaveResetPeriod)
              }
            >
              {LEAVE_RESET_PERIODS.map((period) => (
                <option key={period} value={period}>
                  {resetPeriodLabel(period)}
                </option>
              ))}
            </Select>
          </Field>
          {showPeriodFields ? (
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
          ) : (
            <p className="text-[11px] text-muted">
              {form.resetPeriod === "CALENDAR_YEAR"
                ? "Periods run 1 January to 31 December."
                : form.resetPeriod === "JOINING_ANNIVERSARY"
                  ? "Periods run from each employee's joining date."
                  : "A single open-ended period is used; credits never reset automatically."}
            </p>
          )}
        </section>

        <section className="space-y-3" aria-labelledby="leave-policy-limits">
          <h3
            id="leave-policy-limits"
            className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted"
          >
            Balance limits
          </h3>
          <Field
            label="Max balance (days)"
            htmlFor="leave-policy-max"
            hint="Leave blank for no cap. Automatic days stop at this amount, and larger manual credits are rejected."
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
            label="Earning rules active"
            description="When off, new requests and balance changes are blocked for this type. Existing balances and requests are kept."
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
