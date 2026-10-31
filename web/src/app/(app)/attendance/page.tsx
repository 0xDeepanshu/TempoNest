import type { Metadata } from "next";
import { AttendancePageView } from "@/components/attendance-view";
import { PermissionGate } from "@/components/workspace";

export const metadata: Metadata = { title: "Attendance" };

export default function AttendancePage() {
  return (
    <PermissionGate permission="time:read">
      <AttendancePageView />
    </PermissionGate>
  );
}
