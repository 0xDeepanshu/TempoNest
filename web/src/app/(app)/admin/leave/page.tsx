import type { Metadata } from "next";
import { PermissionGate } from "@/components/workspace";
import { LeaveOverviewView } from "@/components/leave-overview-view";

export const metadata: Metadata = { title: "Leave" };

export default function LeaveOverviewPage() {
  return (
    <PermissionGate anyOf={["leave:approve", "leave:manage"]}>
      <LeaveOverviewView />
    </PermissionGate>
  );
}
