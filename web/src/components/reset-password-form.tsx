"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { apiRequest } from "@/lib/api-client";
import { ApiError, errorMessage, isApiError } from "@/lib/api-error";
import { Alert, Button, Card, CardBody, Field, Input } from "@/components/ui";

export function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = (searchParams.get("token") ?? "").trim();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [apiError, setApiError] = useState<ApiError | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setApiError(null);
    setPasswordError(null);
    setConfirmError(null);

    if (password.length < 12) {
      setPasswordError("Password must be at least 12 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setConfirmError("Passwords do not match.");
      return;
    }

    setLoading(true);
    try {
      await apiRequest("/auth/reset-password", {
        method: "POST",
        body: { token, password },
      });
      router.replace("/login?reset=1");
      router.refresh();
    } catch (caught) {
      if (isApiError(caught)) setApiError(caught);
      setError(errorMessage(caught));
      setLoading(false);
    }
  }

  if (token.length < 20) {
    return (
      <Card>
        <CardBody className="space-y-4 p-5 sm:p-6">
          <Alert tone="danger">
            This password reset link is incomplete or invalid. Request a new link to continue.
          </Alert>
          <Link href="/forgot-password">
            <Button>Request a new link</Button>
          </Link>
        </CardBody>
      </Card>
    );
  }

  return (
    <Card>
      <CardBody className="p-5 sm:p-6">
        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          {error ? <Alert tone="danger">{error}</Alert> : null}

          <Field
            label="New password"
            htmlFor="reset-password"
            required
            hint="Use at least 12 characters."
            error={passwordError ?? apiError?.fieldError("password")}
          >
            <div className="relative">
              <Input
                id="reset-password"
                name="new-password"
                type={showPassword ? "text" : "password"}
                autoComplete="new-password"
                placeholder="Choose a strong password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="pr-16"
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword((value) => !value)}
                className="absolute inset-y-0 right-2 my-auto h-6 rounded px-2 text-[11px] font-semibold text-muted hover:bg-surface-hover hover:text-ink"
              >
                {showPassword ? "Hide" : "Show"}
              </button>
            </div>
          </Field>

          <Field
            label="Confirm new password"
            htmlFor="reset-password-confirm"
            required
            error={confirmError}
          >
            <Input
              id="reset-password-confirm"
              name="confirm-password"
              type={showPassword ? "text" : "password"}
              autoComplete="new-password"
              placeholder="Repeat your new password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              required
            />
          </Field>

          <Button type="submit" loading={loading} className="w-full" size="lg">
            Update password
          </Button>

          <p className="text-center text-xs leading-5 text-muted">
            Links expire and can only be used once.{" "}
            <Link
              href="/forgot-password"
              className="font-semibold text-ink underline decoration-line-strong underline-offset-4 hover:decoration-ink"
            >
              Request a new link
            </Link>
          </p>
        </form>
      </CardBody>
    </Card>
  );
}
