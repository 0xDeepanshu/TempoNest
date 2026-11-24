import type { Metadata } from "next";
import { RolesView } from "@/components/roles-view";
import { PermissionGate } from "@/components/workspace";

export const metadata: Metadata = { title: "Roles & permissions" };

export default function RolesSettingsPage() {
  return (
    <PermissionGate permission="role:read">
      <RolesView />
    </PermissionGate>
  );
}
