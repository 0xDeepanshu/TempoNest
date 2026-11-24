import type { Metadata } from "next";
import { LeaveSettingsView } from "@/components/leave-settings-view";
import { PermissionGate } from "@/components/workspace";

export const metadata: Metadata = { title: "Holiday rules" };

export default function HolidayRulesSettingsPage() {
  return (
    <PermissionGate anyOf={["holiday:view", "holiday:settings:manage"]}>
      <LeaveSettingsView section="holidays" />
    </PermissionGate>
  );
}
