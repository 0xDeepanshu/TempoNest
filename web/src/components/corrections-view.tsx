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
  const [tab, setTab] = useState<CorrectionsTab>("request");

  if (!organization) return <NoOrganization />;
  const timezone = organization.timezone;
  const canReview = hasPermission(membership?.role, "correction:review");

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={organization.name}
        title="Corrections"
        description="Request a fix for a stopped or missing session. Reviewers see the original snapshot and your reason before approving or rejecting."
      />

      {canReview ? (
        <Tabs
          value={tab}
          onChange={setTab}
          tabs={[
            { value: "request", label: "My requests" },
            { value: "review", label: "Review queue" },
          ]}
        />
      ) : null}

      {tab === "review" && canReview ? (
        <CorrectionReviewView embedded />
      ) : (
        <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
          <CorrectionForm
            organizationId={organization.id}
            timezone={timezone}
            onCreated={() => setRefreshToken((value) => value + 1)}
          />
          <CorrectionHistory
            organizationId={organization.id}
            timezone={timezone}
            refreshToken={refreshToken}
            showEmployee={membership?.role !== "EMPLOYEE"}
          />
        </div>
      )}
    </div>
  );
}
