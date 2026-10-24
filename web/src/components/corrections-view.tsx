"use client";

import { useState } from "react";
import { CorrectionForm } from "./correction-form";
import { CorrectionHistory } from "./correction-history";
import { PageHeader } from "./ui";
import { NoOrganization, useWorkspace } from "./workspace";

export function CorrectionsView() {
  const { organization, membership } = useWorkspace();
  const [refreshToken, setRefreshToken] = useState(0);

  if (!organization) return <NoOrganization />;
  const timezone = organization.timezone;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={`${organization.name} · ${membership?.role.toLowerCase()}`}
        title="Attendance corrections"
        description="Request a fix for a stopped or missing session. Reviewers see the original snapshot and your reason before approving or rejecting."
      />
      <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
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
    </div>
  );
}
