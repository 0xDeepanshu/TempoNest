"use client";

import { hasPermission } from "@/lib/permissions";
import { ActivitySettingsView } from "./activity-settings-view";
import { MonitoringSettingsView } from "./monitoring-settings-view";
import { Alert, PageHeader } from "./ui";
import { NoOrganization, useWorkspace } from "./workspace";

export type MonitoringSettingsSection = "screenshots" | "tracking";

/**
 * Settings → Monitoring. Both capture policies live here so the Monitoring
 * area stays focused on reviewing activity.
 */
export function MonitoringSettingsHub({
  section,
}: {
  section: MonitoringSettingsSection;
}) {
  const { organization, membership } = useWorkspace();

  if (!organization) return <NoOrganization />;

  const canManageScreenshots = hasPermission(membership, "screenshot:policy");
  const canReadTracking = hasPermission(membership, "time:read");

  const activeSection: MonitoringSettingsSection =
    section === "screenshots" && !canManageScreenshots && canReadTracking
      ? "tracking"
      : section === "tracking" && !canReadTracking && canManageScreenshots
        ? "screenshots"
        : section;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Monitoring"
        description="Choose what WorkZen may capture, how long it is kept, and who can review it."
      />

      <Alert tone="info" title="Organization-wide rules">
        These defaults apply to everyone in {organization.name}. Individual screenshot schedules
        are set on each employee&apos;s profile, and live activity is reviewed in Monitoring.
      </Alert>

      {activeSection === "screenshots" ? (
        <MonitoringSettingsView embedded />
      ) : (
        <ActivitySettingsView embedded />
      )}
    </div>
  );
}
