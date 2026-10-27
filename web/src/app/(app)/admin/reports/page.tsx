import type { Metadata } from "next";
import { PermissionGate } from "@/components/workspace";
import { ReportsView } from "@/components/reports-view";

export const metadata: Metadata = { title: "Reports" };

function first(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{
    employeeId?: string | string[];
    from?: string | string[];
    to?: string | string[];
    tab?: string | string[];
  }>;
}) {
  const params = await searchParams;

  return (
    <PermissionGate permission="report:read">
      <ReportsView
        initialEmployeeId={first(params.employeeId)}
        initialFrom={first(params.from)}
        initialTo={first(params.to)}
        initialTab={first(params.tab)}
      />
    </PermissionGate>
  );
}
