import type { Metadata } from "next";
import { ApplicationClassificationsView } from "@/components/application-classifications-view";
import { PermissionGate } from "@/components/workspace";

export const metadata: Metadata = { title: "Application classifications" };

export default function ApplicationClassificationsPage() {
  return (
    <PermissionGate permission="report:read">
      <ApplicationClassificationsView />
    </PermissionGate>
  );
}
