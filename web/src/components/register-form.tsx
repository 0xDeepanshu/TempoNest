"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { apiRequest } from "@/lib/api-client";
import { ApiError, errorMessage, isApiError } from "@/lib/api-error";
import { safeNext } from "@/lib/navigation";
import { Alert, Button, Field, Input } from "@/components/ui";

export function RegisterForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = safeNext(searchParams.get("next"));
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [apiError, setApiError] = useState<ApiError | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setApiError(null);

    if (name.trim().length < 2) {
      setError("Enter your name with at least 2 characters.");
      return;
    }
    if (!email.trim()) {
      setError("Enter your email address.");
      return;
    }
    if (password.length < 12) {
      setError("Choose a password with at least 12 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setError("The password confirmation does not match.");
      return;
    }

    setLoading(true);
    let registered = false;
    try {
      await apiRequest("/auth/register", {
        method: "POST",
        body: { name: name.trim(), email: email.trim(), password },
      });
      registered = true;
      await apiRequest("/auth/login", {
        method: "POST",
        body: { email: email.trim(), password, client: "browser" },
      });
      router.replace(next);
      router.refresh();
    } catch (caught) {
      if (isApiError(caught)) setApiError(caught);
      setError(
        registered
          ? `${errorMessage(caught)} Your account was created, but automatic sign-in failed. Sign in with your new credentials.`
          : errorMessage(caught),
      );
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      {error ? <Alert tone="danger">{error}</Alert> : null}

      <Field label="Name" htmlFor="register-name" required error={apiError?.fieldError("name")}>
        <Input
          id="register-name"
          name="name"
          autoComplete="name"
          placeholder="Ada Lovelace"
          value={name}
          onChange={(event) => setName(event.target.value)}
          required
        />
      </Field>

      <Field
        label="Email"
        htmlFor="register-email"
        required
        error={apiError?.fieldError("email")}
      >
        <Input
          id="register-email"
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
        htmlFor="register-password"
        required
        error={apiError?.fieldError("password")}
        hint="At least 12 characters."
      >
        <div className="relative">
          <Input
            id="register-password"
            name="password"
            type={showPassword ? "text" : "password"}
            autoComplete="new-password"
            placeholder="Choose a strong password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="pr-16"
            minLength={12}
            maxLength={128}
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

      <Field label="Confirm password" htmlFor="register-confirm" required>
        <Input
          id="register-confirm"
          name="confirmPassword"
          type={showPassword ? "text" : "password"}
          autoComplete="new-password"
          placeholder="Repeat the password"
          value={confirmPassword}
          onChange={(event) => setConfirmPassword(event.target.value)}
          minLength={12}
          maxLength={128}
          required
        />
      </Field>

      <Button type="submit" loading={loading} className="w-full" size="lg">
        Create account
      </Button>

      <p className="text-center text-xs leading-5 text-slate-500">
        Already have an account?{" "}
        <Link
          href={`/login${next !== "/dashboard" ? `?next=${encodeURIComponent(next)}` : ""}`}
          className="font-semibold text-indigo-600 hover:text-indigo-700"
        >
          Sign in
        </Link>
      </p>
    </form>
  );
}

export function RegisterPanel() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-12 sm:px-8">
      <div className="w-full max-w-md">
        <div className="mb-8 flex items-center gap-2.5">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-600 text-base font-black text-white">
            T
          </span>
          <div>
            <p className="text-lg font-bold tracking-tight text-slate-900">TempoNest</p>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">
              Work portal
            </p>
          </div>
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Create your account</h1>
        <p className="mb-6 mt-1 text-sm leading-5 text-slate-500">
          Register with the email address that received the invitation. You will join the
          organization after accepting the invitation token.
        </p>
        <RegisterForm />
      </div>
    </div>
  );
}
