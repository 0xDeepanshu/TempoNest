import type { Metadata } from "next";
import { PermissionGate } from "@/components/workspace";
import { MonitoringSettingsView } from "@/components/monitoring-settings-view";

export const metadata: Metadata = { title: "Monitoring settings" };

export default function MonitoringSettingsPage() {
  return (
    <PermissionGate permission="screenshot:policy">
      <MonitoringSettingsView />
    </PermissionGate>
  );
}
