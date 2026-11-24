"use client";

import { hasPermission } from "@/lib/permissions";
import { HolidaySettingsView } from "./holiday-settings-view";
import { LeaveTypesView } from "./leave-types-view";
import { PageHeader } from "./ui";
import { NoOrganization, useWorkspace } from "./workspace";

export type LeaveSettingsSection = "types" | "holidays";

/**
 * Settings → Leave & holidays. Day-to-day leave work (requests, balances,
 * calendar) stays in the Team area; configuration lives here.
 */
export function LeaveSettingsView({ section }: { section: LeaveSettingsSection }) {
  const { organization, membership } = useWorkspace();

  if (!organization) return <NoOrganization />;

  const canManageTypes = hasPermission(membership, "leave:manage");
  const canReadHolidays =
    hasPermission(membership, "holiday:view") ||
    hasPermission(membership, "holiday:settings:manage");

  // Never strand a role on a section it cannot read: fall back to the one it can.
  const activeSection: LeaveSettingsSection =
    section === "types" && !canManageTypes && canReadHolidays
      ? "holidays"
      : section === "holidays" && !canReadHolidays && canManageTypes
        ? "types"
        : section;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Leave & holidays"
        description="Set up leave types, how many days employees earn, and which days count as company holidays."
      />

      {activeSection === "types" ? <LeaveTypesView embedded /> : <HolidaySettingsView embedded />}
    </div>
  );
}
