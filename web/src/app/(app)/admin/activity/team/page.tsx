import type { Metadata } from "next";
import { ActivityOverviewView } from "@/components/activity-overview-view";
import { PermissionGate } from "@/components/workspace";

export const metadata: Metadata = { title: "Team activity overview" };

function first(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

export default async function TeamActivityPage({
  searchParams,
}: {
  searchParams: Promise<{
    employeeId?: string | string[];
    from?: string | string[];
    to?: string | string[];
  }>;
}) {
  const params = await searchParams;

  return (
    <PermissionGate permission="report:read">
      <ActivityOverviewView
        initialEmployeeId={first(params.employeeId)}
        initialFrom={first(params.from)}
        initialTo={first(params.to)}
      />
    </PermissionGate>
  );
}
