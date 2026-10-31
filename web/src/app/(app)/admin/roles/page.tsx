import type { Metadata } from "next";
import { PermissionGate } from "@/components/workspace";
import { RolesView } from "@/components/roles-view";

export const metadata: Metadata = { title: "Roles & permissions" };

export default function RolesPage() {
  return (
    <PermissionGate permission="role:read">
      <RolesView />
    </PermissionGate>
  );
}
