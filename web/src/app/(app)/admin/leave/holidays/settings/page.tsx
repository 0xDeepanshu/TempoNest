import type { Metadata } from "next";
import { HolidaySettingsView } from "@/components/holiday-settings-view";
import { PermissionGate } from "@/components/workspace";

export const metadata: Metadata = { title: "Holiday settings" };

export default function HolidaySettingsPage() {
  return (
    <PermissionGate permission="holiday:view">
      <HolidaySettingsView />
    </PermissionGate>
  );
}
