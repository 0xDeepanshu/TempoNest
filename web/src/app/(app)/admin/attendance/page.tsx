import type { Metadata } from "next";
import { AttendanceEvidenceView } from "@/components/attendance-evidence-view";
import { PermissionGate } from "@/components/workspace";

export const metadata: Metadata = { title: "Attendance evidence" };

export default function AttendanceEvidencePage() {
  return (
    <PermissionGate permission="report:read">
      <AttendanceEvidenceView />
    </PermissionGate>
  );
}
