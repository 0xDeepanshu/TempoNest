"use client";

import type { ReactNode } from "react";
import { ADMIN_AREA_PERMISSIONS } from "@/lib/permissions";
import { PermissionGate } from "@/components/workspace";

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <PermissionGate anyOf={ADMIN_AREA_PERMISSIONS}>
      {children}
    </PermissionGate>
  );
}
