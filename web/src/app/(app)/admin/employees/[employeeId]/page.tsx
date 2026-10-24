import type { Metadata } from "next";
import { PermissionGate } from "@/components/workspace";
import { EmployeeDetailView } from "@/components/employee-detail-view";

export const metadata: Metadata = { title: "Employee" };

export default function EmployeeDetailPage() {
  return (
    <PermissionGate permission="member:read">
      <EmployeeDetailView />
    </PermissionGate>
  );
}
