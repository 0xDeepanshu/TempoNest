import type { Metadata } from "next";
import { PermissionGate } from "@/components/workspace";
import { LiveTrackingView } from "@/components/live-tracking-view";

export const metadata: Metadata = { title: "Live tracking" };

export default function LiveTrackingPage() {
  return (
    <PermissionGate permission="report:read">
      <LiveTrackingView />
    </PermissionGate>
  );
}
