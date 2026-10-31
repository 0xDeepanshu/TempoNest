import type { Metadata } from "next";
import { PermissionGate } from "@/components/workspace";
import { LeaveHolidaysView } from "@/components/leave-holidays-view";

export const metadata: Metadata = { title: "Leave holidays" };

export default function LeaveHolidaysPage() {
  return (
    <PermissionGate permission="holiday:view">
      <LeaveHolidaysView />
    </PermissionGate>
  );
}
