"use client";

import { useState } from "react";
import { apiRequest } from "@/lib/api-client";
import { screenshotErrorMessage } from "@/lib/screenshot-errors";
import type { ScreenshotRequestCreateResponse } from "@/lib/types";
import { CameraIcon } from "./icons";
import { Alert, Button } from "./ui";
import { useWorkspace } from "./workspace";

type RequestState = "idle" | "sending" | "sent" | "error";

function newIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `shot-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

export function ScreenshotRequestButton({
  employeeId,
  employeeName,
  disabled = false,
  disabledReason,
  onRequested,
}: {
  employeeId: string;
  employeeName?: string;
  disabled?: boolean;
  disabledReason?: string;
  onRequested?: () => void;
}) {
  const { organization } = useWorkspace();
  const [result, setResult] = useState<{
    employeeId: string;
    state: RequestState;
    message: string | null;
  }>({ employeeId, state: "idle", message: null });
  const current = result.employeeId === employeeId ? result : null;
  const state = current?.state ?? "idle";
  const message = current?.message ?? null;

  async function requestScreenshot() {
    if (!organization || !employeeId || state === "sending" || state === "sent") return;
    setResult({ employeeId, state: "sending", message: null });
    try {
      const response = await apiRequest<ScreenshotRequestCreateResponse>(
        `/admin/employees/${employeeId}/screenshot-requests`,
        {
          method: "POST",
          headers: {
            "X-Organization-Id": organization.id,
            "Idempotency-Key": newIdempotencyKey(),
          },
          body: {},
        },
      );
      setResult({
        employeeId,
        state: "sent",
        message: response.data.replayed
          ? "This employee already had a matching pending request, so it was reused."
          : response.data.delivered
            ? "The request was delivered to the employee's desktop agent. Capture starts only after the agent validates it."
            : "The request is pending. It will be delivered when the employee's desktop agent reconnects.",
      });
      onRequested?.();
    } catch (error) {
      setResult({
        employeeId,
        state: "error",
        message: screenshotErrorMessage(error),
      });
    }
  }

  return (
    <div className="space-y-2">
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={requestScreenshot}
        disabled={disabled || state === "sending" || state === "sent"}
        title={disabled ? disabledReason : undefined}
      >
        <CameraIcon className="h-3.5 w-3.5" />
        {state === "sending"
          ? "Requesting…"
          : state === "sent"
            ? "Request pending"
            : "Request screenshot"}
        {employeeName ? <span className="sr-only"> for {employeeName}</span> : null}
      </Button>
      {disabled && disabledReason ? (
        <p className="max-w-xs text-[11px] leading-5 text-slate-500">{disabledReason}</p>
      ) : null}
      {message ? (
        <div className="max-w-md">
          <Alert tone={state === "error" ? "danger" : "success"}>{message}</Alert>
        </div>
      ) : null}
    </div>
  );
}
