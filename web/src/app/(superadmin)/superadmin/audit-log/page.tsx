import type { Metadata } from "next";
import { SuperadminAuditView } from "@/components/superadmin-audit-view";

export const metadata: Metadata = { title: "Audit log" };

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default async function SuperadminAuditPage({
  searchParams,
}: {
  searchParams: Promise<{ organizationId?: string | string[] }>;
}) {
  const params = await searchParams;
  const value = Array.isArray(params.organizationId)
    ? params.organizationId[0]
    : params.organizationId;

  return (
    <SuperadminAuditView
      initialOrganizationId={value && UUID_PATTERN.test(value) ? value : undefined}
    />
  );
}
