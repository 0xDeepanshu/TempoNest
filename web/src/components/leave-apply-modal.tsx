"use client";

import { useRef, useState } from "react";
import { formatDay, isDateOnly, todayInTimeZone } from "@/lib/format";
import { estimateLeaveUnits, findLeaveBalanceForDate, formatLeaveUnits, workingDaysLabel } from "@/lib/leave";
import { createLeaveRequest } from "@/lib/leave-api";
import { listHolidays } from "@/lib/holiday-api";
import { isNonWorkingHoliday } from "@/lib/holidays";
import { leaveErrorMessage } from "@/lib/leave-errors";
import type { LeaveBalance, LeaveRequest, LeaveType } from "@/lib/types";
import { useApi } from "@/lib/use-api";
import { Modal } from "./modal";
import { Alert, Badge, Button, Field, Input, Select, Textarea } from "./ui";

type DurationValue = "FULL" | "HALF_START" | "HALF_END" | "HALF_BOTH";

function createIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `leave-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function LeaveApplyModal({
  organizationId,
  timezone,
  types,
  balances,
  onClose,
  onApplied,
}: {
  organizationId: string;
  timezone: string;
  types: LeaveType[];
  balances: LeaveBalance[];
  onClose: () => void;
  onApplied: (request: LeaveRequest) => void;
}) {
  const today = todayInTimeZone(timezone);
  const firstType = types.find((type) => !type.policy || type.policy.isActive) ?? types[0];
  const [typeId, setTypeId] = useState(firstType?.id ?? "");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [duration, setDuration] = useState<DurationValue>("FULL");
  const [reason, setReason] = useState("");
  const [documentationReference, setDocumentationReference] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const idempotencyKeyRef = useRef<string | null>(null);

  const selectedType = types.find((type) => type.id === typeId);
  const policy = selectedType?.policy;
  const datesValid = Boolean(
    isDateOnly(startDate) && isDateOnly(endDate) && endDate >= startDate,
  );

  const holidays = useApi(
    (signal) =>
      datesValid
        ? listHolidays(
            organizationId,
            { from: startDate, to: endDate, mine: true },
            { signal },
          )
        : Promise.resolve(null),
    [organizationId, startDate, endDate],
    { enabled: Boolean(organizationId) && datesValid },
  );

  const holidaysReady = !holidays.loading && !holidays.error && Boolean(holidays.data);
  const holidayUnits = new Map<string, number>();
  for (const holiday of holidays.data?.data.holidays ?? []) {
    // Optional and restricted holidays are informational only and must not reduce the charge.
    if (isNonWorkingHoliday(holiday)) continue;
    const increment = holiday.duration === "FULL_DAY" ? 1 : 0.5;
    const current = holidayUnits.get(holiday.holidayDate) ?? 0;
    holidayUnits.set(
      holiday.holidayDate,
      Math.min(1, Math.round((current + increment) * 100) / 100),
    );
  }
  const estimate =
    policy && datesValid && holidaysReady
      ? estimateLeaveUnits({
          startDate,
          endDate,
          startHalfDay: duration === "HALF_START" || duration === "HALF_BOTH",
          endHalfDay: duration === "HALF_END" || duration === "HALF_BOTH",
          workingDays: policy.workingDays,
          holidayUnits,
        })
      : null;

  const sameDay = Boolean(startDate && endDate && startDate === endDate);
  const balance = selectedType?.requiresBalance
    ? findLeaveBalanceForDate(balances, selectedType.id, startDate || today)
    : undefined;

  const durationOptions: Array<{ value: DurationValue; label: string }> = sameDay
    ? [
        { value: "FULL", label: "Full day" },
        { value: "HALF_START", label: "Half day" },
      ]
    : [
        { value: "FULL", label: "Full days" },
        { value: "HALF_START", label: "First day is a half day" },
        { value: "HALF_END", label: "Last day is a half day" },
        { value: "HALF_BOTH", label: "First and last days are half days" },
      ];
  const effectiveDuration = durationOptions.some((option) => option.value === duration)
    ? duration
    : "FULL";

  function resetIdempotencyKey() {
    idempotencyKeyRef.current = null;
  }

  function changeField(setter: (value: string) => void, value: string) {
    resetIdempotencyKey();
    setFormError(null);
    setter(value);
  }

  function changeStartDate(value: string) {
    resetIdempotencyKey();
    setFormError(null);
    setDuration("FULL");
    setStartDate(value);
    if (endDate && value > endDate) setEndDate(value);
  }

  function changeEndDate(value: string) {
    resetIdempotencyKey();
    setFormError(null);
    setDuration("FULL");
    setEndDate(value);
  }

  function changeDuration(value: string) {
    resetIdempotencyKey();
    setFormError(null);
    setDuration(value as DurationValue);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (submittingRef.current) return;
    setFormError(null);

    if (!selectedType) {
      setFormError("Choose a leave type.");
      return;
    }
    if (!policy) {
      setFormError("This leave type has no policy configured, so it cannot accept requests.");
      return;
    }
    if (!policy.isActive) {
      setFormError("This leave type is not accepting requests because its policy is inactive.");
      return;
    }
    if (!isDateOnly(startDate) || !isDateOnly(endDate)) {
      setFormError("Choose a valid start date and end date.");
      return;
    }
    if (endDate < startDate) {
      setFormError("The end date must be on or after the start date.");
      return;
    }
    if (startDate < today) {
      setFormError("Leave cannot start in the past. Choose today or a future date.");
      return;
    }
    const trimmedReason = reason.trim();
    if (trimmedReason.length < 3) {
      setFormError("Enter remarks with at least 3 characters.");
      return;
    }
    if (trimmedReason.length > 2000) {
      setFormError("Remarks must be 2000 characters or fewer.");
      return;
    }
    const documentation = documentationReference.trim();
    if (selectedType.requiresDocumentation && !documentation) {
      setFormError("This leave type requires a documentation reference.");
      return;
    }
    if (documentation.length > 500) {
      setFormError("The documentation reference must be 500 characters or fewer.");
      return;
    }

    if (policy && holidaysReady) {
      if (estimate === null) {
        setFormError(
          "The half-day selection must fall on a chargeable working day. Choose different dates or a full-day request.",
        );
        return;
      }
      if (estimate === 0) {
        setFormError("The selected range has no chargeable working days.");
        return;
      }
    }

    if (selectedType.requiresBalance && !selectedType.allowNegativeBalance) {
      if (balance && balance.availableBalance <= 0) {
        setFormError(
          `No ${selectedType.name} balance is available for this period. Choose another leave type or period.`,
        );
        return;
      }
      if (balance && balance.availableBalance > 0 && holidays.loading) {
        setFormError("The holiday calendar is still loading. Try again in a moment.");
        return;
      }
      if (holidaysReady && balance && estimate !== null && estimate > balance.availableBalance + 0.001) {
        setFormError(
          `This request is estimated at ${formatLeaveUnits(estimate)}, but only ${formatLeaveUnits(
            balance.availableBalance,
          )} is available for this period.`,
        );
        return;
      }
    }

    submittingRef.current = true;
    setSubmitting(true);
    try {
      const idempotencyKey =
        idempotencyKeyRef.current ?? createIdempotencyKey();
      idempotencyKeyRef.current = idempotencyKey;
      const result = await createLeaveRequest(
        organizationId,
        {
          leaveTypeId: selectedType.id,
          startDate,
          endDate,
          startHalfDay:
            effectiveDuration === "HALF_START" || effectiveDuration === "HALF_BOTH",
          endHalfDay:
            effectiveDuration === "HALF_END" || effectiveDuration === "HALF_BOTH",
          reason: trimmedReason,
          ...(documentation ? { documentationReference: documentation } : {}),
        },
        { idempotencyKey },
      );
      onApplied(result.data.request);
    } catch (error) {
      setFormError(leaveErrorMessage(error));
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  const zeroBalance =
    selectedType?.requiresBalance &&
    !selectedType.allowNegativeBalance &&
    balance &&
    balance.availableBalance <= 0;
  const insufficientBalance =
    selectedType?.requiresBalance &&
    !selectedType.allowNegativeBalance &&
    balance &&
    estimate !== null &&
    estimate > balance.availableBalance + 0.001;
  const negativeBalanceUse =
    selectedType?.requiresBalance &&
    selectedType.allowNegativeBalance &&
    balance &&
    estimate !== null &&
    estimate > balance.availableBalance + 0.001;

  return (
    <Modal
      open
      onClose={onClose}
      title="Apply for leave"
      description="Your request starts as pending. Units and balance checks are calculated by the server."
      size="lg"
      dismissible={!submitting}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button type="submit" form="leave-apply-form" loading={submitting}>
            Submit request
          </Button>
        </>
      }
    >
      <form id="leave-apply-form" onSubmit={submit} className="space-y-4">
        {formError ? <Alert tone="danger">{formError}</Alert> : null}

        <Field label="Leave type" htmlFor="leave-apply-type" required>
          <Select
            id="leave-apply-type"
            value={typeId}
            onChange={(event) => changeField(setTypeId, event.target.value)}
            data-autofocus
            required
          >
            {types.map((type) => (
              <option
                key={type.id}
                value={type.id}
                disabled={Boolean(type.policy && !type.policy.isActive)}
              >
                {type.name}
                {type.requiresBalance ? "" : " · no balance"}
                {type.policy && !type.policy.isActive ? " · policy inactive" : ""}
              </option>
            ))}
          </Select>
        </Field>

        {selectedType ? (
          <div className="rounded-lg border border-line bg-surface-muted px-3 py-2.5">
            <div className="flex flex-wrap gap-1.5">
              <Badge tone={selectedType.isPaid ? "success" : "neutral"}>
                {selectedType.isPaid ? "Paid" : "Unpaid"}
              </Badge>
              <Badge tone="outline">
                {selectedType.requiresBalance ? "Balance required" : "No balance"}
              </Badge>
              {selectedType.allowNegativeBalance ? (
                <Badge tone="warning">Negative balance allowed</Badge>
              ) : null}
              {selectedType.policy ? (
                <Badge tone="neutral">
                  {workingDaysLabel(selectedType.policy.workingDays)}
                </Badge>
              ) : null}
            </div>
            <p className="mt-2 text-xs leading-5 text-muted">
              {selectedType.minNoticeDays > 0
                ? `At least ${selectedType.minNoticeDays} day(s) of notice. `
                : ""}
              {selectedType.maxConsecutiveDays !== null
                ? `Up to ${selectedType.maxConsecutiveDays} consecutive calendar day(s). `
                : ""}
              {selectedType.requiresDocumentation
                ? "A documentation reference is required."
                : ""}
            </p>
          </div>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Start date" htmlFor="leave-apply-start" required>
            <Input
              id="leave-apply-start"
              type="date"
              min={today}
              max={endDate || undefined}
              value={startDate}
              onChange={(event) => changeStartDate(event.target.value)}
              required
            />
          </Field>
          <Field label="End date" htmlFor="leave-apply-end" required>
            <Input
              id="leave-apply-end"
              type="date"
              min={startDate || today}
              value={endDate}
              onChange={(event) => changeEndDate(event.target.value)}
              required
            />
          </Field>
        </div>

        <Field
          label="Duration"
          htmlFor="leave-apply-duration"
          hint="Half days apply to the first and/or last day of the request."
          required
        >
          <Select
            id="leave-apply-duration"
            value={effectiveDuration}
            onChange={(event) => changeDuration(event.target.value)}
          >
            {durationOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </Field>

        {selectedType ? (
          <div className="rounded-lg border border-line px-3 py-2.5">
            <dl className="grid gap-x-4 gap-y-2 text-xs sm:grid-cols-2">
              <div className="flex items-center justify-between gap-2">
                <dt className="text-muted">Estimated charge</dt>
                <dd className="tnum font-medium text-ink">
                  {estimate === null
                    ? datesValid && holidays.loading
                      ? "Checking holidays…"
                      : datesValid
                        ? "Unavailable"
                        : "Choose dates"
                    : formatLeaveUnits(estimate)}
                </dd>
              </div>
              {selectedType.requiresBalance ? (
                <div className="flex items-center justify-between gap-2">
                  <dt className="text-muted">Available balance</dt>
                  <dd className="tnum font-medium text-ink">
                    {balance ? formatLeaveUnits(balance.availableBalance) : "Not calculated"}
                  </dd>
                </div>
              ) : null}
            </dl>
            <p className="mt-1 text-[11px] leading-4 text-muted">
              Estimates use the policy working days and organization holidays. The server
              recalculates the final units and balance when you submit.
            </p>

            {!policy ? (
              <Alert tone="danger" className="mt-2">
                This leave type has no policy configured, so it cannot accept requests.
              </Alert>
            ) : !policy.isActive ? (
              <Alert tone="danger" className="mt-2">
                This leave type is not accepting requests because its policy is inactive.
              </Alert>
            ) : holidays.error ? (
              <Alert tone="warning" className="mt-2">
                The holiday calendar could not be loaded. The server will validate the final
                units and balance when you submit.
              </Alert>
            ) : zeroBalance ? (
              <Alert tone="warning" className="mt-2">
                No {selectedType.name} balance is available for this period. Choose another
                leave type or period.
              </Alert>
            ) : insufficientBalance ? (
              <Alert tone="warning" className="mt-2">
                This request is estimated at {formatLeaveUnits(estimate ?? 0)}, but only{" "}
                {formatLeaveUnits(balance?.availableBalance ?? 0)} is available for this
                period.
              </Alert>
            ) : negativeBalanceUse ? (
              <Alert tone="info" className="mt-2">
                This request is estimated above the available balance. This leave type allows
                a negative balance, and the server will confirm the final amount.
              </Alert>
            ) : selectedType.requiresBalance && startDate && !balance ? (
              <Alert tone="info" className="mt-2">
                No balance record exists for this period yet. The server will calculate it
                when you submit.
              </Alert>
            ) : null}
          </div>
        ) : null}

        <Field
          label="Remarks"
          htmlFor="leave-apply-reason"
          hint="Shared with the reviewer who decides your request."
          required
        >
          <Textarea
            id="leave-apply-reason"
            value={reason}
            maxLength={2000}
            onChange={(event) => changeField(setReason, event.target.value)}
            placeholder="For example: family trip, medical appointment."
            required
          />
        </Field>

        {selectedType?.requiresDocumentation ? (
          <Field
            label="Documentation reference"
            htmlFor="leave-apply-documentation"
            hint="Reference or link to supporting documentation. File upload is not available."
            required
          >
            <Input
              id="leave-apply-documentation"
              value={documentationReference}
              maxLength={500}
              onChange={(event) =>
                changeField(setDocumentationReference, event.target.value)
              }
              placeholder="For example: HR document reference"
              required
            />
          </Field>
        ) : null}

        <p className="text-[11px] leading-4 text-muted">
          Requests spanning two balance periods, overlapping leave, or exceeding the balance
          are rejected by the server. Review your{" "}
          {endDate ? `${formatDay(startDate)} – ${formatDay(endDate)}` : "selected dates"} before
          submitting.
        </p>
      </form>
    </Modal>
  );
}
