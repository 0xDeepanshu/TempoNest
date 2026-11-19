"use client";

import { useId, useState } from "react";
import { isDateOnly } from "@/lib/format";
import { balancePeriodLabel, formatLeaveUnits, formatSignedLeaveUnits } from "@/lib/leave";
import { assignLeaveCredits, previewLeaveCredits } from "@/lib/leave-api";
import { leaveErrorMessage } from "@/lib/leave-errors";
import type {
  LeaveCreditAssignmentItem,
  LeaveCreditAssignmentPreview,
  LeaveCreditAssignmentResult,
  LeaveCreditMode,
  LeaveType,
  MemberListItem,
} from "@/lib/types";
import { EmployeePicker } from "./employee-picker";
import { Modal } from "./modal";
import {
  Alert,
  Badge,
  Button,
  Field,
  Input,
  Select,
  TableShell,
  Td,
  Textarea,
  Th,
  cn,
} from "./ui";

type Scope = "SELECTED" | "ALL_ACTIVE";

type Draft = {
  mode: LeaveCreditMode;
  scope: Scope;
  leaveTypeId: string;
  credits: string;
  effectiveDate: string;
  reason: string;
};

function initialDraft(types: LeaveType[]): Draft {
  return {
    mode: "ADD",
    scope: "SELECTED",
    leaveTypeId: types[0]?.id ?? "",
    credits: "",
    effectiveDate: "",
    reason: "",
  };
}

export function LeaveCreditsModal({
  organizationId,
  types,
  onClose,
  onCompleted,
}: {
  organizationId: string;
  types: LeaveType[];
  onClose: () => void;
  onCompleted: () => void;
}) {
  const [selected, setSelected] = useState<MemberListItem[]>([]);
  const [pickerValue, setPickerValue] = useState("");
  const [draft, setDraft] = useState<Draft>(() => initialDraft(types));
  const [preview, setPreview] = useState<LeaveCreditAssignmentPreview | null>(null);
  const [result, setResult] = useState<LeaveCreditAssignmentResult | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const resultTitleId = useId();

  function update(patch: Partial<Draft>) {
    setDraft((current) => ({ ...current, ...patch }));
    setPreview(null);
    setResult(null);
  }

  function addEmployee(member: MemberListItem) {
    setSelected((current) =>
      current.some((row) => row.userId === member.userId) ? current : [...current, member],
    );
    setPickerValue("");
    setPreview(null);
    setResult(null);
  }

  function removeEmployee(userId: string) {
    setSelected((current) => current.filter((row) => row.userId !== userId));
    setPreview(null);
    setResult(null);
  }

  function validate(): string | null {
    if (!draft.leaveTypeId) return "Select a leave type.";
    if (draft.scope === "SELECTED" && selected.length === 0) {
      return "Select at least one employee.";
    }
    const credits = Number(draft.credits);
    if (!draft.credits.trim() || !Number.isFinite(credits)) {
      return "Enter the number of credits.";
    }
    if (credits < 0) return "Credits cannot be negative.";
    if (credits > 3650) return "Credits must be 3650 or fewer.";
    if (draft.mode === "ADD" && credits === 0) {
      return "Add credits needs an amount greater than zero.";
    }
    if (draft.effectiveDate && !isDateOnly(draft.effectiveDate)) {
      return "The effective date must be a valid date.";
    }
    if (draft.reason.trim().length < 3) {
      return "Enter a reason with at least 3 characters.";
    }
    if (draft.reason.trim().length > 500) {
      return "The reason must be 500 characters or fewer.";
    }
    return null;
  }

  function payload() {
    return {
      leaveTypeId: draft.leaveTypeId,
      mode: draft.mode,
      credits: Number(draft.credits),
      ...(draft.scope === "ALL_ACTIVE"
        ? { allActive: true }
        : { employeeIds: selected.map((member) => member.userId) }),
      ...(draft.effectiveDate ? { effectiveDate: draft.effectiveDate } : {}),
      reason: draft.reason.trim(),
    };
  }

  async function runPreview() {
    if (previewing || submitting) return;
    const error = validate();
    if (error) {
      setFormError(error);
      return;
    }
    setFormError(null);
    setPreviewing(true);
    try {
      const response = await previewLeaveCredits(organizationId, payload());
      setPreview(response.data);
      setResult(null);
    } catch (error) {
      setFormError(leaveErrorMessage(error));
    } finally {
      setPreviewing(false);
    }
  }

  async function confirm() {
    if (submitting || previewing || !preview) return;
    setFormError(null);
    setSubmitting(true);
    try {
      const response = await assignLeaveCredits(organizationId, payload());
      setResult(response.data);
      setPreview(null);
      onCompleted();
    } catch (error) {
      setFormError(leaveErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  }

  function reset() {
    setSelected([]);
    setPickerValue("");
    setDraft(initialDraft(types));
    setPreview(null);
    setResult(null);
    setFormError(null);
  }

  const leaveTypeName =
    result?.leaveType.name ??
    preview?.leaveType.name ??
    types.find((type) => type.id === draft.leaveTypeId)?.name ??
    "Leave";

  return (
    <Modal
      open
      onClose={onClose}
      title="Assign leave credits"
      description="Give employees leave days directly. 1 credit equals 1 day. Preview every employee before anything is written."
      size="lg"
      dismissible={!submitting && !previewing}
      footer={
        result ? (
          <>
            <Button variant="secondary" onClick={onClose}>
              Close
            </Button>
            <Button onClick={reset}>Assign more credits</Button>
          </>
        ) : (
          <>
            <Button
              variant="secondary"
              onClick={onClose}
              disabled={submitting || previewing}
            >
              Cancel
            </Button>
            <Button
              variant="secondary"
              onClick={runPreview}
              loading={previewing}
              disabled={submitting}
            >
              Preview changes
            </Button>
            <Button
              onClick={confirm}
              loading={submitting}
              disabled={!preview || preview.summary.previewed === 0 || previewing}
            >
              Confirm and assign
            </Button>
          </>
        )
      }
    >
      <div className="space-y-4">
        {formError ? <Alert tone="danger">{formError}</Alert> : null}

        {result ? (
          <section aria-labelledby={resultTitleId} className="space-y-2">
            <Alert tone={result.summary.failed > 0 ? "warning" : "success"}>
              {result.summary.applied} of {result.summary.requested} employees received credits
              {result.summary.unchanged > 0
                ? ` · ${result.summary.unchanged} already at the requested balance`
                : ""}
              {result.summary.failed > 0
                ? ` · ${result.summary.failed} could not be updated`
                : " · every change is recorded in history"}.
            </Alert>
            <h3
              id={resultTitleId}
              className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted"
            >
              Result · batch {result.batchId.slice(0, 8)}
            </h3>
            <ResultList result={result} />
          </section>
        ) : (
          <>
            <Field label="Leave type" htmlFor="leave-credits-type" required>
              <Select
                id="leave-credits-type"
                value={draft.leaveTypeId}
                onChange={(event) => update({ leaveTypeId: event.target.value })}
                disabled={submitting}
                data-autofocus
              >
                <option value="">Select a leave type</option>
                {types.map((type) => (
                  <option key={type.id} value={type.id}>
                    {type.name}
                  </option>
                ))}
              </Select>
            </Field>

            <fieldset className="space-y-2">
              <legend className="text-xs font-medium text-ink">Who receives credits?</legend>
              <div className="grid gap-2 sm:grid-cols-2">
                <ScopeOption
                  label="Specific employees"
                  description="Choose one or more people."
                  checked={draft.scope === "SELECTED"}
                  onChange={() => {
                    update({ scope: "SELECTED" });
                  }}
                  disabled={submitting}
                />
                <ScopeOption
                  label="All active employees"
                  description="Every active member of this organization."
                  checked={draft.scope === "ALL_ACTIVE"}
                  onChange={() => {
                    update({ scope: "ALL_ACTIVE" });
                  }}
                  disabled={submitting}
                />
              </div>
            </fieldset>

            {draft.scope === "SELECTED" ? (
              <div className="space-y-2">
                <Field
                  label="Employees"
                  htmlFor="leave-credits-picker"
                  hint="Search the active member directory and add each employee."
                >
                  <EmployeePicker
                    id="leave-credits-picker"
                    organizationId={organizationId}
                    value={pickerValue}
                    onChange={setPickerValue}
                    onSelect={addEmployee}
                    placeholder="Add an employee"
                    disabled={submitting}
                  />
                </Field>
                {selected.length === 0 ? (
                  <p className="text-xs text-muted">No employees selected yet.</p>
                ) : (
                  <ul className="flex flex-wrap gap-2" aria-label="Selected employees">
                    {selected.map((member) => (
                      <li
                        key={member.userId}
                        className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface-muted py-1 pl-2 pr-1 text-xs text-ink"
                      >
                        <span className="max-w-48 truncate">{member.user.name}</span>
                        <button
                          type="button"
                          onClick={() => removeEmployee(member.userId)}
                          disabled={submitting}
                          aria-label={`Remove ${member.user.name}`}
                          className="flex h-5 w-5 items-center justify-center rounded-full text-muted transition hover:bg-surface-hover hover:text-ink disabled:opacity-50"
                        >
                          ×
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : (
              <p className="text-xs leading-5 text-muted">
                Credits will be applied to every active employee. Employees without a balance
                for the current period are skipped and reported in the preview.
              </p>
            )}

            <fieldset className="space-y-2">
              <legend className="text-xs font-medium text-ink">How should credits change?</legend>
              <div className="grid gap-2 sm:grid-cols-2">
                <ScopeOption
                  label="Add credits"
                  description="Increase the assigned total by this amount."
                  checked={draft.mode === "ADD"}
                  onChange={() => {
                    update({ mode: "ADD" });
                  }}
                  disabled={submitting}
                />
                <ScopeOption
                  label="Set balance"
                  description="Make the assigned total exactly this amount."
                  checked={draft.mode === "SET"}
                  onChange={() => {
                    update({ mode: "SET" });
                  }}
                  disabled={submitting}
                />
              </div>
            </fieldset>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field
                label={draft.mode === "ADD" ? "Credits to add" : "New assigned total"}
                htmlFor="leave-credits-amount"
                hint={
                  draft.mode === "ADD"
                    ? "1 credit equals 1 day of leave."
                    : "The total credits assigned for this period, including unused days."
                }
                required
              >
                <Input
                  id="leave-credits-amount"
                  type="number"
                  inputMode="decimal"
                  step="any"
                  min={0}
                  max={3650}
                  value={draft.credits}
                  onChange={(event) => update({ credits: event.target.value })}
                  disabled={submitting}
                />
              </Field>
              <Field
                label="Effective date"
                htmlFor="leave-credits-effective"
                hint="Optional. Uses the balance period that contains this date; blank uses today."
              >
                <Input
                  id="leave-credits-effective"
                  type="date"
                  value={draft.effectiveDate}
                  onChange={(event) => update({ effectiveDate: event.target.value })}
                  disabled={submitting}
                />
              </Field>
            </div>

            <Field
              label="Reason"
              htmlFor="leave-credits-reason"
              hint="Required. Stored in the balance history and audit trail."
              required
            >
              <Textarea
                id="leave-credits-reason"
                value={draft.reason}
                maxLength={500}
                onChange={(event) => update({ reason: event.target.value })}
                disabled={submitting}
                placeholder="For example: annual allocation for 2026."
              />
            </Field>

            {preview ? (
              <PreviewSection preview={preview} />
            ) : (
              <p className="text-[11px] leading-4 text-muted">
                Preview shows each employee&apos;s assigned and available balance before and
                after. Nothing is written until you confirm.
              </p>
            )}
          </>
        )}

        {result ? null : preview ? (
          <p className="text-[11px] leading-4 text-muted">
            {preview.summary.unchanged > 0
              ? `${preview.summary.unchanged} employee${preview.summary.unchanged === 1 ? " is" : "s are"} already at this balance and will be skipped. `
              : ""}
            Credits for {leaveTypeName} are applied per employee; a failure on one employee
            does not roll back the others.
          </p>
        ) : null}
      </div>
    </Modal>
  );
}

function ScopeOption({
  label,
  description,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
}) {
  return (
    <label
      className={cn(
        "flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition",
        checked ? "border-ink/40 bg-surface-muted" : "border-line bg-surface",
        disabled && "cursor-not-allowed opacity-60",
      )}
    >
      <input
        type="radio"
        className="mt-0.5 h-4 w-4 accent-ink"
        checked={checked}
        onChange={onChange}
        disabled={disabled}
      />
      <span className="min-w-0">
        <span className="block text-xs font-semibold text-ink">{label}</span>
        <span className="mt-0.5 block text-[11px] leading-4 text-muted">{description}</span>
      </span>
    </label>
  );
}

function PreviewSection({ preview }: { preview: LeaveCreditAssignmentPreview }) {
  const items = preview.items;
  return (
    <section aria-labelledby="leave-credits-preview" className="space-y-2">
      <h3
        id="leave-credits-preview"
        className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted"
      >
        Preview · {balancePeriodLabel(preview.periodStart, preview.periodEnd)}
      </h3>
      <p className="text-xs text-muted">
        {preview.mode === "ADD" ? "Add" : "Set to"} credits for{" "}
        {preview.scope === "ALL_ACTIVE" ? "all active employees" : `${items.length} employee${items.length === 1 ? "" : "s"}`} ·{" "}
        {preview.summary.previewed} ready · {preview.summary.unchanged} unchanged ·{" "}
        {preview.summary.failed} cannot be applied. Nothing has been written yet.
      </p>
      <div className="max-h-72 overflow-y-auto rounded-lg border border-line">
        <TableShell className="min-w-[640px]">
          <thead>
            <tr>
              <Th>Employee</Th>
              <Th className="text-right">Assigned</Th>
              <Th className="text-right">Used</Th>
              <Th className="text-right">Pending</Th>
              <Th className="text-right">Available</Th>
              <Th className="text-right">Status</Th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <PreviewRow key={item.employeeId} item={item} />
            ))}
          </tbody>
        </TableShell>
      </div>
    </section>
  );
}

function PreviewRow({ item }: { item: LeaveCreditAssignmentItem }) {
  if (!item.ok) {
    return (
      <tr>
        <Td>
          <span className="font-medium text-ink">{item.employeeName}</span>
          <p className="text-[11px] text-danger">{item.message}</p>
        </Td>
        <Td className="text-right text-muted">—</Td>
        <Td className="text-right text-muted">—</Td>
        <Td className="text-right text-muted">—</Td>
        <Td className="text-right text-muted">—</Td>
        <Td className="text-right">
          <Badge tone="danger">{item.code}</Badge>
        </Td>
      </tr>
    );
  }
  return (
    <tr>
      <Td>
        <span className="font-medium text-ink">{item.employeeName}</span>
        {item.unchanged ? (
          <p className="text-[11px] text-muted">Already at this balance</p>
        ) : (
          <p
            className={cn(
              "text-[11px]",
              item.amount >= 0 ? "text-success" : "text-danger",
            )}
          >
            {formatSignedLeaveUnits(item.amount)} days
          </p>
        )}
      </Td>
      <Td className="whitespace-nowrap text-right tnum">
        {formatLeaveUnits(item.assignedBefore)} → {formatLeaveUnits(item.assignedAfter)}
      </Td>
      <Td className="whitespace-nowrap text-right tnum">{formatLeaveUnits(item.used)}</Td>
      <Td className="whitespace-nowrap text-right tnum">{formatLeaveUnits(item.pending)}</Td>
      <Td className="whitespace-nowrap text-right tnum font-semibold">
        {formatLeaveUnits(item.availableBefore)} → {formatLeaveUnits(item.availableAfter)}
      </Td>
      <Td className="text-right">
        {item.unchanged ? (
          <Badge tone="neutral">No change</Badge>
        ) : (
          <Badge tone="success">Ready</Badge>
        )}
      </Td>
    </tr>
  );
}

function ResultList({ result }: { result: LeaveCreditAssignmentResult }) {
  return (
    <div className="max-h-72 overflow-y-auto rounded-lg border border-line">
      <ul className="divide-y divide-line">
        {result.items.map((item) =>
          item.ok ? (
            <li
              key={item.employeeId}
              className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-xs"
            >
              <span className="min-w-0">
                <span className="block truncate font-medium text-ink">
                  {item.employeeName}
                </span>
                <span className="block text-muted">
                  {formatLeaveUnits(item.assignedAfter)} assigned ·{" "}
                  {formatLeaveUnits(item.availableAfter)} available
                </span>
              </span>
              {item.unchanged ? (
                <Badge tone="neutral">No change</Badge>
              ) : (
                <Badge tone="success">Updated</Badge>
              )}
            </li>
          ) : (
            <li
              key={item.employeeId}
              className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-xs"
            >
              <span className="min-w-0">
                <span className="block truncate font-medium text-ink">
                  {item.employeeName}
                </span>
                <span className="block text-danger">{item.message}</span>
              </span>
              <Badge tone="danger">{item.code}</Badge>
            </li>
          ),
        )}
      </ul>
    </div>
  );
}
