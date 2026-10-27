import type { Metadata } from "next";
import { SuperadminOrganizationsView } from "@/components/superadmin-organizations-view";

export const metadata: Metadata = { title: "Organizations" };

export default function SuperadminOrganizationsPage() {
  return <SuperadminOrganizationsView />;
}
