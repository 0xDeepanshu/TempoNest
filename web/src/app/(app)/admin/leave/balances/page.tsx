import type { Metadata } from "next";
import { PermissionGate } from "@/components/workspace";
import { LeaveBalancesView } from "@/components/leave-balances-view";

export const metadata: Metadata = { title: "Leave balances" };

export default function LeaveBalancesPage() {
  return (
    <PermissionGate permission="leave:manage">
      <LeaveBalancesView />
    </PermissionGate>
  );
}
