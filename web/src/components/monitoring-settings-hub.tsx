"use client";

import { hasPermission } from "@/lib/permissions";
import { ActivitySettingsView } from "./activity-settings-view";
import { MonitoringSettingsView } from "./monitoring-settings-view";
import { SettingsSubNav, SettingsTabs } from "./settings-tabs";
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
        eyebrow={organization.name}
        title="Monitoring"
        description="Choose what WorkZen may capture, how long it is kept, and who can review it."
      />

      <SettingsTabs current="monitoring" />

      <SettingsSubNav
        label="Monitoring settings"
        current={activeSection}
        items={[
          {
            value: "screenshots",
            label: "Screenshots",
            href: "/settings/monitoring",
            visible: canManageScreenshots,
          },
          {
            value: "tracking",
            label: "App tracking",
            href: "/settings/monitoring/tracking",
            visible: canReadTracking,
          },
        ]}
      />

      <Alert tone="info" title="Global defaults">
        These rules apply to everyone in the organization. Per-employee capture schedules are
        managed from Scheduled screenshots, and live activity is reviewed from Monitoring.
      </Alert>

      {activeSection === "screenshots" ? (
        <MonitoringSettingsView embedded />
      ) : (
        <ActivitySettingsView embedded />
      )}
    </div>
  );
}
