import type { Metadata } from "next";
import { ActivitySettingsView } from "@/components/activity-settings-view";
import { PermissionGate } from "@/components/workspace";

export const metadata: Metadata = { title: "App tracking" };

export default function AppTrackingSettingsPage() {
  return (
    <PermissionGate permission="time:read">
      <ActivitySettingsView />
    </PermissionGate>
  );
}
