"use client";

import { hasPermission } from "@/lib/permissions";
import { HolidayCalendarView } from "./holiday-calendar";
import { LeaveTabs } from "./leave-tabs";
import { NoOrganization, useWorkspace } from "./workspace";

/**
 * Admin holiday calendar surface. The calendar itself is shared with the
 * employee portal so read-only and management views cannot drift apart.
 */
export function LeaveHolidaysView() {
  const { organization, membership } = useWorkspace();
  if (!organization) return <NoOrganization />;

  return (
    <div className="space-y-5">
      <LeaveTabs current="holidays" />
      <HolidayCalendarView
        organizationId={organization.id}
        timezone={organization.timezone}
        mode="admin"
        canCreate={hasPermission(membership, "holiday:create")}
        canUpdate={hasPermission(membership, "holiday:update")}
        canDelete={hasPermission(membership, "holiday:delete")}
        canManageSettings={hasPermission(membership, "holiday:settings:manage")}
      />
    </div>
  );
}
