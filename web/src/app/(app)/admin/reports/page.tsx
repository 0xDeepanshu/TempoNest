import type { Metadata } from "next";
import { PermissionGate } from "@/components/workspace";
import { ReportsView } from "@/components/reports-view";

export const metadata: Metadata = { title: "Reports" };

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ employeeId?: string | string[] }>;
}) {
  const params = await searchParams;
  const employeeId = Array.isArray(params.employeeId)
    ? (params.employeeId[0] ?? "")
    : (params.employeeId ?? "");

  return (
    <PermissionGate permission="report:read">
      <ReportsView initialEmployeeId={employeeId} />
    </PermissionGate>
  );
}
