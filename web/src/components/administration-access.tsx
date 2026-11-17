"use client";

import { useState } from "react";
import { errorMessage } from "@/lib/api-error";
import { canManageMember } from "@/lib/permissions";
import { assignMemberRole } from "@/lib/roles-api";
import type { MemberListItem, MembershipSummary } from "@/lib/types";
import { ConfirmDialog } from "./confirm-dialog";
import { Alert, Badge, Button, Card, CardBody, CardHeader } from "./ui";

/**
 * Per-user administration toggle. It intentionally uses the existing built-in
 * role machinery (EMPLOYEE ↔ ADMIN) instead of a parallel permission store, so
 * the backend permission matrix, owner rules, and audit trail stay single-
 * sourced. The backend remains the enforcer; this component only hides actions
 * the current actor cannot perform.
 */
export function AdministrationAccessCard({
  organizationId,
  member,
  actor,
  actorUserId,
  onChanged,
}: {
  organizationId: string;
  member: MemberListItem;
  actor: MembershipSummary;
  actorUserId: string;
  onChanged: () => void;
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const grantsAdministration = member.role === "ADMIN";
  const eligibleRole = member.role === "ADMIN" || member.role === "EMPLOYEE";
  const canManage = canManageMember(actor, actorUserId, {
    userId: member.userId,
    role: member.role,
  });
  // The backend only lets an owner assign or remove ADMIN. Managers and admins
  // keep their existing behaviour and see the read-only state here.
  const canToggle =
    canManage &&
    actor.role === "OWNER" &&
    eligibleRole &&
    !member.customRoleId &&
    member.status !== "REMOVED";

  let restriction: string | null = null;
  if (member.role === "OWNER") {
    restriction = "Owners always have full administration access.";
  } else if (!eligibleRole) {
    restriction =
      "Administration access applies to employee and administrator accounts only.";
  } else if (member.customRoleId) {
    restriction =
      "This member has a custom role. Remove the custom role in People before granting administration access.";
  } else if (member.userId === actorUserId) {
    restriction = "You cannot change your own administration access.";
  } else if (member.status === "REMOVED") {
    restriction = "This membership has been removed.";
  } else if (actor.role !== "OWNER") {
    restriction = "Only an organization owner can grant or revoke administration access.";
  }

  async function applyChange() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await assignMemberRole(organizationId, member.id, {
        role: grantsAdministration ? "EMPLOYEE" : "ADMIN",
      });
      setConfirmOpen(false);
      setNotice(
        grantsAdministration
          ? "Administration access revoked."
          : "Administration access granted.",
      );
      onChanged();
    } catch (caught) {
      const message = errorMessage(caught);
      setError(message);
      setConfirmOpen(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader
        title="Administration access"
        description="Lets this person manage people, policies, reports, and monitoring for the organization."
        actions={
          <Badge tone={grantsAdministration ? "success" : "neutral"}>
            {grantsAdministration ? "On" : "Off"}
          </Badge>
        }
      />
      <CardBody>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[13px] font-medium text-ink">
              {grantsAdministration
                ? "This member is an administrator."
                : "This member has standard employee access."}
            </p>
            <p className="mt-0.5 text-xs leading-5 text-muted">
              {restriction ??
                (grantsAdministration
                  ? "Turning this off returns the member to the employee role."
                  : "Turning this on grants the administrator role.")}
            </p>
          </div>
          {canToggle ? (
            <Button
              variant={grantsAdministration ? "secondary" : "primary"}
              onClick={() => {
                setError(null);
                setConfirmOpen(true);
              }}
              disabled={busy}
            >
              {grantsAdministration ? "Turn off" : "Turn on"}
            </Button>
          ) : null}
        </div>
        {notice ? (
          <p className="mt-3 text-xs font-medium text-success" role="status">
            {notice}
          </p>
        ) : null}
        {error ? (
          <div className="mt-3">
            <Alert tone="danger">{error}</Alert>
          </div>
        ) : null}
      </CardBody>

      <ConfirmDialog
        open={confirmOpen}
        title={grantsAdministration ? "Revoke administration access?" : "Grant administration access?"}
        description={`${member.user.name} · ${member.user.email}`}
        confirmLabel={
          grantsAdministration ? "Revoke administration" : "Grant administration"
        }
        tone={grantsAdministration ? "danger" : "primary"}
        busy={busy}
        error={error}
        onConfirm={() => void applyChange()}
        onClose={() => {
          if (!busy) setConfirmOpen(false);
        }}
      >
        <p className="text-[13px] leading-6 text-ink-secondary">
          {grantsAdministration
            ? "They will immediately lose organization-wide administration permissions and return to the employee role."
            : "They will immediately gain organization-wide administration permissions, including managing people and viewing reports."}
        </p>
        <p className="text-xs leading-5 text-muted">
          This change is recorded in the organization audit trail.
        </p>
      </ConfirmDialog>
    </Card>
  );
}
