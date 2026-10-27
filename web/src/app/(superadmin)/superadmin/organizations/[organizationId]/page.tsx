import type { Metadata } from "next";
import { SuperadminOrganizationDetailView } from "@/components/superadmin-organization-detail-view";

export const metadata: Metadata = { title: "Organization" };

export default async function SuperadminOrganizationPage({
  params,
}: {
  params: Promise<{ organizationId: string }>;
}) {
  const { organizationId } = await params;
  return <SuperadminOrganizationDetailView organizationId={organizationId} />;
}
