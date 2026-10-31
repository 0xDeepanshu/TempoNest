"use client";

import { HolidayCalendarView } from "./holiday-calendar";
import { NoOrganization, useWorkspace } from "./workspace";

/** Employee-facing read-only holiday calendar. */
export function HolidayPortalView() {
  const { organization } = useWorkspace();
  if (!organization) return <NoOrganization />;

  return (
    <HolidayCalendarView
      organizationId={organization.id}
      timezone={organization.timezone}
      mode="employee"
      canCreate={false}
      canUpdate={false}
      canDelete={false}
      canManageSettings={false}
    />
  );
}
