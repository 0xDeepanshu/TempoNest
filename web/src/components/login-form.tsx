"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { apiRequest } from "@/lib/api-client";
import { ApiError, errorMessage, isApiError } from "@/lib/api-error";
import { safeNext } from "@/lib/navigation";
import type { LoginData } from "@/lib/types";
import { CalendarIcon, ChartIcon, CheckSquareIcon } from "@/components/icons";
import { Alert, Button, Field, Input } from "@/components/ui";

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [apiError, setApiError] = useState<ApiError | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setApiError(null);

    if (!email.trim() || !password) {
      setError("Enter your email address and password.");
      return;
    }

    setLoading(true);
    try {
      await apiRequest<{ data: LoginData }>("/auth/login", {
        method: "POST",
        body: { email: email.trim(), password, client: "browser" },
      });
      router.replace(safeNext(searchParams.get("next")));
      router.refresh();
    } catch (caught) {
      if (isApiError(caught)) setApiError(caught);
      setError(errorMessage(caught));
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      {searchParams.get("reset") === "1" ? (
        <Alert tone="success">
          Your password was updated. Sign in with your new password.
        </Alert>
      ) : null}

      {error ? <Alert tone="danger">{error}</Alert> : null}

      <Field
        label="Email"
        htmlFor="email"
        required
        error={apiError?.fieldError("email")}
      >
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          placeholder="you@company.com"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
        />
      </Field>

      <Field
        label="Password"
        htmlFor="password"
        required
        error={apiError?.fieldError("password")}
      >
        <div className="relative">
          <Input
            id="password"
            name="password"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            placeholder="Your password"
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

      <div className="-mt-1 flex justify-end">
        <Link
          href="/forgot-password"
          className="text-[11px] font-semibold text-ink-secondary underline decoration-line-strong underline-offset-4 hover:text-ink hover:decoration-ink"
        >
          Forgot password?
        </Link>
      </div>

      <Button type="submit" loading={loading} className="w-full" size="lg">
        Sign in
      </Button>

      <p className="text-center text-xs leading-5 text-muted">
        Accounts are created from an organization invitation. Open the link in your invitation
        email, or ask your administrator to resend it.
      </p>
    </form>
  );
}

export function LoginPanel() {
  return (
    <div className="grid min-h-screen lg:grid-cols-[1.05fr_0.95fr]">
      <div className="relative hidden flex-col justify-between bg-brand p-12 text-brand-foreground lg:flex">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-foreground text-lg font-semibold text-brand-ink">
            T
          </span>
          <div>
            <p className="text-lg font-semibold tracking-tight">TempoNest</p>
            <p className="text-[10px] font-medium uppercase tracking-[0.2em] text-brand-muted">
              Work portal
            </p>
          </div>
        </div>

        <div className="max-w-md">
          <h1 className="text-4xl font-semibold leading-[1.15] tracking-[-0.03em]">
            Attendance and team time, in one calm place.
          </h1>
          <p className="mt-4 text-sm leading-6 text-brand-muted">
            Review your working time, request attendance corrections, and give managers a clear
            view of the team — without moving tracking data into the browser.
          </p>
          <ul className="mt-10 divide-y divide-brand-border border-y border-brand-border">
            {[
              {
                icon: <CalendarIcon className="h-4 w-4" />,
                title: "Daily, weekly, monthly summaries",
                body: "Organization-local attendance totals with break detail.",
              },
              {
                icon: <CheckSquareIcon className="h-4 w-4" />,
                title: "Correction workflow",
                body: "Request, review, approve, or reject with a full audit trail.",
              },
              {
                icon: <ChartIcon className="h-4 w-4" />,
                title: "Team reporting",
                body: "Session history, live tracking state, and application usage.",
              },
            ].map((item) => (
              <li key={item.title} className="flex gap-3 py-4">
                <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-brand-border text-brand-foreground/80">
                  {item.icon}
                </span>
                <div>
                  <p className="text-sm font-medium">{item.title}</p>
                  <p className="mt-0.5 text-xs leading-5 text-brand-muted">{item.body}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <p className="text-xs text-brand-muted">
          Time tracking is server-authoritative and controlled by the TempoNest desktop agent.
        </p>
      </div>

      <div className="flex items-center justify-center bg-canvas px-4 py-12 sm:px-8">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-2.5 lg:hidden">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-ink text-sm font-semibold text-on-strong">
              T
            </span>
            <div>
              <p className="text-base font-semibold tracking-tight text-ink">TempoNest</p>
              <p className="text-[9px] font-medium uppercase tracking-widest text-muted">
                Work portal
              </p>
            </div>
          </div>
          <h2 className="text-2xl font-semibold tracking-[-0.02em] text-ink">Welcome back</h2>
          <p className="mb-6 mt-1 text-sm text-muted">
            Sign in to view your attendance and team workspace.
          </p>
          <LoginForm />
          <p className="mt-8 text-center text-[11px] text-muted">
            <Link href="/" className="font-medium text-ink-secondary hover:text-ink">
              TempoNest
            </Link>{" "}
            · Secure cookie session · CSRF protected
          </p>
        </div>
      </div>
    </div>
  );
}
