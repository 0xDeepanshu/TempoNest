"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { apiRequest } from "@/lib/api-client";
import { errorMessage } from "@/lib/api-error";
import { formatDateTime } from "@/lib/format";
import type { MembershipSummary, Organization, Role } from "@/lib/types";
import { useApi } from "@/lib/use-api";
import { BuildingIcon, CheckSquareIcon } from "./icons";
import {
  Alert,
  Button,
  Card,
  CardBody,
  CardHeader,
  ErrorState,
  PageHeader,
  RoleBadge,
  Spinner,
} from "./ui";
import { useWorkspace } from "./workspace";

interface InvitationPreview {
  organization: Organization;
  email: string;
  role: Role;
  expiresAt: string;
}

interface PreviewResponse {
  data: { invitation: InvitationPreview };
}

interface AcceptResponse {
  data: { membership: MembershipSummary; organization: Organization };
}

export function InvitationAcceptView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useWorkspace();
  const token = (searchParams.get("token") ?? "").trim();
  const [accepting, setAccepting] = useState(false);
  const [acceptError, setAcceptError] = useState<string | null>(null);

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

  async function accept() {
    setAcceptError(null);
    setAccepting(true);
    try {
      const response = await apiRequest<AcceptResponse>("/invitations/accept", {
        method: "POST",
        body: { token },
      });
      window.localStorage.setItem(
        "temponest.organization",
        response.data.organization.id,
      );
      router.replace("/dashboard");
      router.refresh();
    } catch (caught) {
      setAcceptError(errorMessage(caught));
      setAccepting(false);
    }
  }

  if (token.length < 20) {
    return (
      <div className="mx-auto max-w-2xl space-y-4 py-10">
        <PageHeader
          eyebrow="Invitation"
          title="Invitation link is incomplete"
          description="Ask the person who invited you to share the full token."
        />
        <Link href="/dashboard">
          <Button variant="secondary">Back to dashboard</Button>
        </Link>
      </div>
    );
  }

  const invitation = preview.data?.data.invitation;
  const emailMismatch =
    invitation && invitation.email.toLowerCase() !== user.email.toLowerCase();

  return (
    <div className="mx-auto max-w-2xl space-y-5 py-6">
      <PageHeader
        eyebrow="Organization invitation"
        title="Join your team on TempoNest"
        description="Review the invitation, then accept it with the signed-in account."
      />

      <Card>
        <CardHeader
          title="Invitation details"
          actions={
            <span className="flex items-center gap-1.5 text-[11px] text-muted">
              <BuildingIcon className="h-3.5 w-3.5" />
              Signed in as {user.email}
            </span>
          }
        />
        <CardBody className="space-y-4">
          {preview.error ? (
            <ErrorState message={preview.error} onRetry={preview.reload} />
          ) : preview.loading || !invitation ? (
            <div className="flex items-center gap-2 py-6 text-sm text-muted">
              <Spinner className="h-5 w-5" />
              Checking invitation…
            </div>
          ) : (
            <>
              <div className="rounded-lg border border-line bg-surface-muted p-4">
                <p className="text-lg font-semibold tracking-tight text-ink">
                  {invitation.organization.name}
                </p>
                <p className="mt-0.5 text-xs text-muted">
                  {invitation.organization.slug} · expires{" "}
                  {formatDateTime(invitation.expiresAt, invitation.organization.timezone)}
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-ink-secondary">
                  <span>Invited email:</span>
                  <span className="font-medium text-ink">{invitation.email}</span>
                  <RoleBadge role={invitation.role} />
                </div>
              </div>

              {emailMismatch ? (
                <Alert tone="warning" title="Wrong account">
                  This invitation was sent to {invitation.email}. Sign in with that account
                  before accepting it.
                </Alert>
              ) : null}
              {acceptError ? <Alert tone="danger">{acceptError}</Alert> : null}

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  onClick={accept}
                  loading={accepting}
                  disabled={emailMismatch}
                >
                  <CheckSquareIcon className="h-4 w-4" />
                  Accept invitation
                </Button>
                <Link href="/dashboard">
                  <Button variant="ghost" disabled={accepting}>
                    Not now
                  </Button>
                </Link>
              </div>
              <p className="text-[11px] leading-5 text-muted">
                The backend verifies that the invitation email matches your signed-in
                account. If you were previously removed from this organization, accepting
                reactivates the existing membership.
              </p>
            </>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
