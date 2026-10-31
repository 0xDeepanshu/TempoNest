import type { Metadata } from "next";
import { PermissionGate } from "@/components/workspace";
import { LeaveRequestsView } from "@/components/leave-requests-view";

export const metadata: Metadata = { title: "Leave requests" };

export default function LeaveRequestsPage() {
  return (
    <PermissionGate anyOf={["leave:approve", "leave:manage"]}>
      <LeaveRequestsView />
    </PermissionGate>
  );
}
