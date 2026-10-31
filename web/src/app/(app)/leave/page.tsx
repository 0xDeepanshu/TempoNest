import type { Metadata } from "next";
import { MyLeaveView } from "@/components/my-leave-view";
import { PermissionGate } from "@/components/workspace";

export const metadata: Metadata = { title: "My leaves" };

export default function MyLeavePage() {
  return (
    <PermissionGate permission="leave:read">
      <MyLeaveView />
    </PermissionGate>
  );
}
