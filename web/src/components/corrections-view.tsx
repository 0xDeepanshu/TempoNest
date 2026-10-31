"use client";

import { useState } from "react";
import { hasPermission } from "@/lib/permissions";
import { CorrectionForm } from "./correction-form";
import { CorrectionHistory } from "./correction-history";
import { CorrectionReviewView } from "./correction-review-view";
import { PageHeader, Tabs } from "./ui";
import { NoOrganization, useWorkspace } from "./workspace";

type CorrectionsTab = "request" | "review";

export function CorrectionsView() {
  const { organization, membership } = useWorkspace();
  const [refreshToken, setRefreshToken] = useState(0);
  const canReview = hasPermission(membership, "correction:review");
  const canSubmit = hasPermission(membership, "time:write");
  const canViewOwn = hasPermission(membership, "time:read");
  const hasSelfService = canSubmit || canViewOwn;
  const [tab, setTab] = useState<CorrectionsTab>(hasSelfService ? "request" : "review");

  if (!organization) return <NoOrganization />;
  const timezone = organization.timezone;
  const activeTab = tab === "review" && canReview ? "review" : hasSelfService ? "request" : null;
  const tabs: Array<{ value: CorrectionsTab; label: string }> = [
    ...(hasSelfService ? [{ value: "request" as const, label: "My requests" }] : []),
    ...(canReview ? [{ value: "review" as const, label: "Review queue" }] : []),
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={organization.name}
        title="Corrections"
        description="Request a fix for a stopped or missing session. Reviewers see the original snapshot and your reason before approving or rejecting."
      />

      {tabs.length > 1 ? (
        <Tabs value={activeTab ?? "request"} onChange={setTab} tabs={tabs} />
      ) : null}

      {activeTab === "review" ? (
        <CorrectionReviewView embedded />
      ) : activeTab === "request" ? (
        <div
          className={
            canSubmit && canViewOwn
              ? "grid gap-4 xl:grid-cols-[1.1fr_0.9fr]"
              : "grid gap-4"
          }
        >
          {canSubmit ? (
            <CorrectionForm
              organizationId={organization.id}
              timezone={timezone}
              canListSessions={canViewOwn}
              onCreated={() => setRefreshToken((value) => value + 1)}
            />
          ) : null}
          {canViewOwn ? (
            <CorrectionHistory
              organizationId={organization.id}
              timezone={timezone}
              refreshToken={refreshToken}
              showEmployee={canReview}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
