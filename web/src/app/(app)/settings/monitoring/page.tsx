import type { Metadata } from "next";
import { MonitoringSettingsHub } from "@/components/monitoring-settings-hub";
import { PermissionGate } from "@/components/workspace";

export const metadata: Metadata = { title: "Monitoring settings" };

export default function MonitoringSettingsPage() {
  return (
    <PermissionGate anyOf={["screenshot:policy", "time:read"]}>
      <MonitoringSettingsHub section="screenshots" />
    </PermissionGate>
  );
}
