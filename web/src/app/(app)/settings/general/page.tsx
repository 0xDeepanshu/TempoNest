import type { Metadata } from "next";
import { OrganizationPageView } from "@/components/organization-view";
import { PermissionGate } from "@/components/workspace";

export const metadata: Metadata = { title: "General settings" };

export default function GeneralSettingsPage() {
  return (
    <PermissionGate permission="organization:read">
      <OrganizationPageView />
    </PermissionGate>
  );
}
