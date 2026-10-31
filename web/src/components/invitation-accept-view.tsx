"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { apiRequest } from "@/lib/api-client";
import { errorMessage, isApiError } from "@/lib/api-error";
import { formatDateTime } from "@/lib/format";
import type { MembershipSummary, Organization, PublicUser, Role } from "@/lib/types";
import { useApi } from "@/lib/use-api";
import { PublicAuthShell } from "./public-auth-shell";
import {
  Alert,
  Button,
  Card,
  CardBody,
  Field,
  Input,
  RoleBadge,
  Spinner,
} from "./ui";

interface InvitationPreview {
  organization: Organization;
  name: string | null;
  email: string;
  role: Role;
  customRole?: { id: string; name: string } | null;
  expiresAt: string;
  existingAccount: boolean;
  signedInEmail: string | null;
  signedInMatches: boolean;
}

interface PreviewResponse {
  data: { invitation: InvitationPreview };
}

interface AcceptResponse {
  data: {
    membership: MembershipSummary;
    organization: Organization;
    user: PublicUser;
    accountCreated: boolean;
    session: { id: string } | null;
  };
}

function previewErrorCopy(code: string | null): string {
  switch (code) {
    case "INVITATION_EXPIRED":
      return "This invitation has expired. Ask an administrator to send a new one.";
    case "INVITATION_REVOKED":
      return "This invitation was revoked. Ask an administrator for a new invitation.";
    case "INVITATION_ALREADY_USED":
      return "This invitation has already been used. Sign in with your account instead.";
    case "ORGANIZATION_SUSPENDED":
      return "This organization is not accepting invitations right now.";
    default:
      return "This invitation link is invalid or no longer works.";
  }
}

export function InvitationAcceptView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = (searchParams.get("token") ?? "").trim();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  const preview = useApi<PreviewResponse>(
    (signal) =>
      apiRequest("/invitations/preview", {
        method: "POST",
        body: { token },
        signal,
      }),
    [token],
    { enabled: token.length >= 20 },
  );

  const acceptancePath = `/invitations/accept?token=${encodeURIComponent(token)}`;
  const signInHref = `/login?next=${encodeURIComponent(acceptancePath)}`;
  const invitation = preview.data?.data.invitation;

  function finish(response: AcceptResponse) {
    window.localStorage.setItem("temponest.organization", response.data.organization.id);
    router.replace("/dashboard");
    router.refresh();
  }

  async function acceptExisting() {
    setSubmitError(null);
    setSubmitting(true);
    try {
      const response = await apiRequest<AcceptResponse>("/invitations/accept", {
        method: "POST",
        body: { token },
      });
      finish(response);
    } catch (caught) {
      setSubmitError(errorMessage(caught));
      setSubmitting(false);
    }
  }

  async function createAccount(event: React.FormEvent) {
    event.preventDefault();
    setSubmitError(null);
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

    setSubmitting(true);
    try {
      const response = await apiRequest<AcceptResponse>("/invitations/accept", {
        method: "POST",
        body: { token, password },
      });
      finish(response);
    } catch (caught) {
      if (isApiError(caught) && caught.code === "ACCOUNT_EXISTS_SIGN_IN") {
        preview.reload();
      }
      setSubmitError(errorMessage(caught));
      setSubmitting(false);
    }
  }

  async function signOut() {
    setSigningOut(true);
    try {
      await apiRequest("/auth/logout", { method: "POST", body: {} });
    } catch {
      // A failed logout still reloads; the preview state is the source of truth.
    }
    window.location.reload();
  }

  if (token.length < 20) {
    return (
      <PublicAuthShell
        title="Invitation link is incomplete"
        description="Ask the person who invited you to resend the invitation e-mail."
      >
        <Card>
          <CardBody className="space-y-4">
            <Alert tone="danger">
              The link is missing its token. Open the link from your invitation e-mail again.
            </Alert>
            <Link href="/login">
              <Button variant="secondary">Go to sign in</Button>
            </Link>
          </CardBody>
        </Card>
      </PublicAuthShell>
    );
  }

  if (preview.error) {
    return (
      <PublicAuthShell
        title="This invitation cannot be used"
        description="Invitation links are single-use and expire after a few days."
      >
        <Card>
          <CardBody className="space-y-4">
            <Alert tone="danger">{previewErrorCopy(preview.errorCode)}</Alert>
            <div className="flex flex-wrap gap-2">
              <Link href={signInHref}>
                <Button variant="secondary">Sign in</Button>
              </Link>
              <Button variant="ghost" onClick={preview.reload}>
                Try again
              </Button>
            </div>
          </CardBody>
        </Card>
      </PublicAuthShell>
    );
  }

  if (!invitation) {
    return (
      <PublicAuthShell title="Checking your invitation" description="This only takes a moment.">
        <Card>
          <CardBody className="flex items-center gap-2 py-10 text-sm text-muted">
            <Spinner className="h-5 w-5" />
            Verifying invitation…
          </CardBody>
        </Card>
      </PublicAuthShell>
    );
  }

  const wrongSignedInAccount =
    Boolean(invitation.signedInEmail) &&
    invitation.signedInEmail!.toLowerCase() !== invitation.email.toLowerCase();
  const roleName =
    invitation.customRole?.name ??
    invitation.role.charAt(0) + invitation.role.slice(1).toLowerCase();

  return (
    <PublicAuthShell
      title="Accept your invitation"
      description="Review the details below, then activate your TempoNest account."
    >
      <Card>
        <CardBody className="space-y-5 p-5 sm:p-6">
          <div className="rounded-lg border border-line bg-surface-muted p-4">
            <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-muted">
              You are joining
            </p>
            <p className="mt-1 text-xl font-semibold tracking-tight text-ink">
              {invitation.organization.name}
            </p>
            <p className="mt-0.5 text-xs text-muted">
              {invitation.organization.slug} · invitation expires{" "}
              {formatDateTime(invitation.expiresAt, invitation.organization.timezone)}
            </p>

            <dl className="mt-4 grid gap-3 sm:grid-cols-2">
              <div>
                <dt className="text-[11px] font-medium uppercase tracking-wide text-muted">Name</dt>
                <dd className="mt-1 text-sm font-medium text-ink">{invitation.name ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-[11px] font-medium uppercase tracking-wide text-muted">Role</dt>
                <dd className="mt-1">
                  <RoleBadge role={invitation.role} customRoleName={invitation.customRole?.name} />
                </dd>
              </div>
            </dl>
          </div>

          <Field label="Invited email" htmlFor="invited-email">
            <Input
              id="invited-email"
              type="email"
              value={invitation.email}
              readOnly
              aria-readonly="true"
              className="bg-surface-muted"
            />
          </Field>

          {invitation.existingAccount && !invitation.signedInEmail ? (
            <div className="space-y-4">
              <Alert tone="info" title="You already have a TempoNest account">
                Sign in with <strong>{invitation.email}</strong> to accept this invitation. Your
                existing password stays the same.
              </Alert>
              <div className="flex flex-wrap gap-2">
                <Link href={signInHref}>
                  <Button>Sign in to accept</Button>
                </Link>
                <Link href={`/forgot-password?email=${encodeURIComponent(invitation.email)}`}>
                  <Button variant="ghost">Forgot password?</Button>
                </Link>
              </div>
            </div>
          ) : null}

          {invitation.existingAccount && invitation.signedInMatches ? (
            <div className="space-y-4">
              <Alert tone="success" title={`Signed in as ${invitation.signedInEmail}`}>
                Accepting adds {invitation.organization.name} to your account. Your password is not
                changed.
              </Alert>
              {submitError ? <Alert tone="danger">{submitError}</Alert> : null}
              <Button onClick={acceptExisting} loading={submitting}>
                Accept invitation
              </Button>
            </div>
          ) : null}

          {wrongSignedInAccount ? (
            <div className="space-y-4">
              <Alert tone="warning" title="Wrong account is signed in">
                This invitation was sent to <strong>{invitation.email}</strong>, but you are signed
                in as <strong>{invitation.signedInEmail}</strong>. Sign out to continue with the
                invited address.
              </Alert>
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" onClick={signOut} loading={signingOut}>
                  Sign out
                </Button>
                {invitation.existingAccount ? (
                  <Link href={signInHref}>
                    <Button variant="ghost">Sign in with the invited email</Button>
                  </Link>
                ) : null}
              </div>
            </div>
          ) : null}

          {!invitation.existingAccount && !wrongSignedInAccount ? (
            <form onSubmit={createAccount} className="space-y-4" noValidate>
              <Field
                label="Create password"
                htmlFor="new-password"
                hint="Use at least 12 characters."
                error={passwordError}
                required
              >
                <div className="relative">
                  <Input
                    id="new-password"
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
                label="Confirm password"
                htmlFor="confirm-password"
                error={confirmError}
                required
              >
                <Input
                  id="confirm-password"
                  name="confirm-password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password"
                  placeholder="Repeat your password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  required
                />
              </Field>

              {submitError ? <Alert tone="danger">{submitError}</Alert> : null}

              <Button type="submit" loading={submitting} className="w-full" size="lg">
                Create account
              </Button>
              <p className="text-[11px] leading-5 text-muted">
                You will join {invitation.organization.name} as {roleName}. Your role is assigned by
                the organization and cannot be changed during onboarding.
              </p>
            </form>
          ) : null}
        </CardBody>
      </Card>

      <p className="text-center text-xs text-muted">
        Already set up?{" "}
        <Link href={signInHref} className="font-semibold text-ink underline decoration-line-strong underline-offset-4 hover:decoration-ink">
          Sign in
        </Link>
      </p>
    </PublicAuthShell>
  );
}
