import type { Metadata } from "next";
import { PermissionGate } from "@/components/workspace";
import { EmployeesView } from "@/components/employees-view";

export const metadata: Metadata = { title: "People" };

export default function EmployeesPage() {
  return (
    <PermissionGate permission="member:read">
      <EmployeesView />
    </PermissionGate>
  );
}
