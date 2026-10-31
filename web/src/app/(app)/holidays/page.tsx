import type { Metadata } from "next";
import { PermissionGate } from "@/components/workspace";
import { HolidayPortalView } from "@/components/holiday-portal-view";

export const metadata: Metadata = { title: "Holiday calendar" };

export default function HolidaysPage() {
  return (
    <PermissionGate permission="holiday:view">
      <HolidayPortalView />
    </PermissionGate>
  );
}
