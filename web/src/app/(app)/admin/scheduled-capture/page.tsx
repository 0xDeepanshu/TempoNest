import type { Metadata } from "next";
import { PermissionGate } from "@/components/workspace";
import { ScheduledCaptureOverviewView } from "@/components/scheduled-capture-overview";

export const metadata: Metadata = { title: "Scheduled screenshots" };

export default function ScheduledCapturePage() {
  return (
    <PermissionGate permission="screenshot:monitoring">
      <ScheduledCaptureOverviewView />
    </PermissionGate>
  );
}
