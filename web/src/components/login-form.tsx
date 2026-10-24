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
            className="absolute inset-y-0 right-2 my-auto h-6 rounded px-2 text-[11px] font-semibold text-slate-500 hover:bg-slate-100"
          >
            {showPassword ? "Hide" : "Show"}
          </button>
        </div>
      </Field>

      <Button type="submit" loading={loading} className="w-full" size="lg">
        Sign in
      </Button>

      <p className="text-center text-xs leading-5 text-slate-500">
        New to TempoNest?{" "}
        <Link
          href={`/register${
            searchParams.get("next")
              ? `?next=${encodeURIComponent(safeNext(searchParams.get("next")))}`
              : ""
          }`}
          className="font-semibold text-indigo-600 hover:text-indigo-700"
        >
          Create an account
        </Link>{" "}
        to accept an invitation.
      </p>
    </form>
  );
}

export function LoginPanel() {
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="relative hidden overflow-hidden bg-slate-950 p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="absolute -left-24 -top-24 h-80 w-80 rounded-full bg-indigo-600/30 blur-3xl" />
        <div className="absolute -bottom-24 right-0 h-96 w-96 rounded-full bg-emerald-500/20 blur-3xl" />
        <div className="relative">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-500 text-lg font-black">
              T
            </span>
            <div>
              <p className="text-lg font-bold tracking-tight">TempoNest</p>
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-400">
                Work portal
              </p>
            </div>
          </div>
        </div>

        <div className="relative max-w-md">
          <h1 className="text-4xl font-bold leading-tight tracking-tight">
            Attendance and team time, in one calm place.
          </h1>
          <p className="mt-4 text-sm leading-6 text-slate-300">
            Review your working time, request attendance corrections, and give managers a clear
            view of the team — without moving tracking data into the browser.
          </p>
          <ul className="mt-8 space-y-4">
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
              <li key={item.title} className="flex gap-3">
                <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/10 text-indigo-200">
                  {item.icon}
                </span>
                <div>
                  <p className="text-sm font-semibold">{item.title}</p>
                  <p className="text-xs leading-5 text-slate-400">{item.body}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-xs text-slate-500">
          Time tracking is server-authoritative and controlled by the TempoNest desktop agent.
        </p>
      </div>

      <div className="flex items-center justify-center bg-slate-50 px-4 py-12 sm:px-8">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-2.5 lg:hidden">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-600 text-sm font-black text-white">
              T
            </span>
            <div>
              <p className="text-base font-bold text-slate-900">TempoNest</p>
              <p className="text-[9px] font-semibold uppercase tracking-widest text-slate-400">
                Work portal
              </p>
            </div>
          </div>
          <h2 className="text-2xl font-bold tracking-tight text-slate-900">Welcome back</h2>
          <p className="mb-6 mt-1 text-sm text-slate-500">
            Sign in to view your attendance and team workspace.
          </p>
          <LoginForm />
          <p className="mt-8 text-center text-[11px] text-slate-400">
            <Link href="/" className="font-medium text-slate-500 hover:text-slate-700">
              TempoNest
            </Link>{" "}
            · Secure cookie session · CSRF protected
          </p>
        </div>
      </div>
    </div>
  );
}
