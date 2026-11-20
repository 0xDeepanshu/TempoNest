import type { Metadata } from "next";
import { LeaveSettingsView } from "@/components/leave-settings-view";
import { PermissionGate } from "@/components/workspace";

export const metadata: Metadata = { title: "Leave settings" };

export default function LeaveSettingsPage() {
  return (
    <PermissionGate anyOf={["leave:manage", "holiday:settings:manage"]}>
      <LeaveSettingsView section="types" />
    </PermissionGate>
  );
}
