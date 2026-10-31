"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { apiRequest } from "@/lib/api-client";
import { ApiError, errorMessage, isApiError } from "@/lib/api-error";
import { Alert, Button, Card, CardBody, Field, Input } from "@/components/ui";

export function ForgotPasswordForm() {
  const searchParams = useSearchParams();
  const [email, setEmail] = useState(() => (searchParams.get("email") ?? "").trim());
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [apiError, setApiError] = useState<ApiError | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setApiError(null);

    if (!email.trim()) {
      setError("Enter the email address you use for TempoNest.");
      return;
    }

    setLoading(true);
    try {
      await apiRequest("/auth/forgot-password", {
        method: "POST",
        body: { email: email.trim() },
      });
      setSent(true);
    } catch (caught) {
      if (isApiError(caught)) setApiError(caught);
      setError(errorMessage(caught));
    } finally {
      setLoading(false);
    }
  }

  if (sent) {
    return (
      <Card>
        <CardBody className="space-y-4 p-5 sm:p-6">
          <Alert tone="success" title="Check your inbox">
            If an account exists for <strong>{email.trim()}</strong>, a password reset link is on
            its way. The link expires shortly and can only be used once.
          </Alert>
          <p className="text-xs leading-5 text-muted">
            Didn&apos;t receive it? Check your spam folder, then try again in a few minutes.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => setSent(false)}>
              Use a different email
            </Button>
            <Link href="/login">
              <Button variant="ghost">Back to sign in</Button>
            </Link>
          </div>
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
            label="Email"
            htmlFor="forgot-email"
            required
            error={apiError?.fieldError("email")}
            hint="We will email a single-use reset link to this address."
          >
            <Input
              id="forgot-email"
              name="email"
              type="email"
              autoComplete="email"
              placeholder="you@company.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </Field>

          <Button type="submit" loading={loading} className="w-full" size="lg">
            Send reset link
          </Button>

          <p className="text-center text-xs text-muted">
            Remembered your password?{" "}
            <Link
              href="/login"
              className="font-semibold text-ink underline decoration-line-strong underline-offset-4 hover:decoration-ink"
            >
              Sign in
            </Link>
          </p>
        </form>
      </CardBody>
    </Card>
  );
}
