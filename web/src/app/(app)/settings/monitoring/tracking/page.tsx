import type { Metadata } from "next";
import { MonitoringSettingsHub } from "@/components/monitoring-settings-hub";
import { PermissionGate } from "@/components/workspace";

export const metadata: Metadata = { title: "App tracking settings" };

export default function TrackingSettingsPage() {
  return (
    <PermissionGate anyOf={["time:read", "activity:policy"]}>
      <MonitoringSettingsHub section="tracking" />
    </PermissionGate>
  );
}
