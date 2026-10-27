import type { Metadata } from "next";
import { PermissionGate } from "@/components/workspace";
import { EmployeeDetailView } from "@/components/employee-detail-view";

export const metadata: Metadata = { title: "Employee" };

function first(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

export default async function EmployeeDetailPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string | string[]; to?: string | string[] }>;
}) {
  const params = await searchParams;

  return (
    <PermissionGate permission="member:read">
      <EmployeeDetailView
        initialFrom={first(params.from)}
        initialTo={first(params.to)}
      />
    </PermissionGate>
  );
}
