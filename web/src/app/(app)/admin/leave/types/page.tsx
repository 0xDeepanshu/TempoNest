import type { Metadata } from "next";
import { PermissionGate } from "@/components/workspace";
import { LeaveTypesView } from "@/components/leave-types-view";

export const metadata: Metadata = { title: "Leave types and policies" };

export default function LeaveTypesPage() {
  return (
    <PermissionGate permission="leave:manage">
      <LeaveTypesView />
    </PermissionGate>
  );
}
