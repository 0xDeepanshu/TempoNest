import type {
  PlatformAuditAction,
  PlatformAuditEvent,
  PlatformOrganizationStatus,
} from "./types";

export const PLATFORM_ACTION_LABELS: Record<PlatformAuditAction, string> = {
  ORGANIZATION_RENAMED: "Renamed organization",
  ORGANIZATION_SUSPENDED: "Suspended organization",
  ORGANIZATION_REACTIVATED: "Reactivated organization",
  ORGANIZATION_SOFT_DELETED: "Soft-deleted organization",
};

export const PLATFORM_STATUS_LABELS: Record<PlatformOrganizationStatus, string> = {
  ACTIVE: "Active",
  SUSPENDED: "Suspended",
  DELETED: "Deleted",
};

export function platformActionLabel(action: PlatformAuditAction): string {
  return PLATFORM_ACTION_LABELS[action] ?? action;
}

export function platformStatusLabel(status: PlatformOrganizationStatus): string {
  return PLATFORM_STATUS_LABELS[status] ?? status;
}

type AuditMetadata = {
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  retention?: string;
};

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Renders only the user-facing change fields. Platform audit metadata is
 * intentionally limited to names and statuses, never credentials or file URLs.
 */
export function platformAuditChange(event: PlatformAuditEvent): string {
  const metadata = event.metadata as AuditMetadata;

  if (event.action === "ORGANIZATION_RENAMED") {
    const before = stringValue(metadata.before?.name);
    const after = stringValue(metadata.after?.name);
    if (before && after) return `Name: ${before} → ${after}`;
    if (after) return `Name: ${after}`;
  }

  if (
    event.action === "ORGANIZATION_SUSPENDED" ||
    event.action === "ORGANIZATION_REACTIVATED"
  ) {
    const before = stringValue(metadata.before?.status);
    const after = stringValue(metadata.after?.status);
    if (before && after) return `Status: ${before} → ${after}`;
    if (after) return `Status: ${after}`;
  }

  if (event.action === "ORGANIZATION_SOFT_DELETED") {
    return metadata.retention === "tenant_data_preserved"
      ? "Access revoked; tenant data preserved"
      : "Access revoked";
  }

  return "—";
}

export function platformActorLabel(event: PlatformAuditEvent): string {
  if (!event.actor) return "Unknown actor";
  return event.actor.name ?? event.actor.email ?? event.actor.id;
}
