import type { Metadata } from "next";
import { PermissionGate } from "@/components/workspace";
import { OrganizationPageView } from "@/components/organization-view";

export const metadata: Metadata = { title: "Organization" };

export default function OrganizationPage() {
  return (
    <PermissionGate permission="organization:read">
      <OrganizationPageView />
    </PermissionGate>
  );
}
