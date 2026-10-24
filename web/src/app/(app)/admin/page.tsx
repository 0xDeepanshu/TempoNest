import type { Metadata } from "next";
import { PermissionGate } from "@/components/workspace";
import { TeamDashboard } from "@/components/dashboard-view";

export const metadata: Metadata = { title: "Team overview" };

export default function AdminOverviewPage() {
  return (
    <PermissionGate permission="report:read">
      <TeamDashboard />
    </PermissionGate>
  );
}
