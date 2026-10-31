import type { Metadata } from "next";
import { CorrectionsView } from "@/components/corrections-view";
import { PermissionGate } from "@/components/workspace";

export const metadata: Metadata = { title: "Corrections" };

export default function CorrectionsPage() {
  return (
    <PermissionGate anyOf={["time:read", "time:write", "correction:review"]}>
      <CorrectionsView />
    </PermissionGate>
  );
}
