import type { ActivityCategory } from "@/lib/types";
import { Badge } from "./ui";

const CATEGORY_LABELS: Record<ActivityCategory, string> = {
  PRODUCTIVE: "Productive",
  NEUTRAL: "Neutral",
  UNPRODUCTIVE: "Unproductive",
  UNCLASSIFIED: "Unclassified",
};

const CATEGORY_TONES = {
  PRODUCTIVE: "success",
  NEUTRAL: "info",
  UNPRODUCTIVE: "warning",
  UNCLASSIFIED: "neutral",
} as const;

export function activityCategoryLabel(category: ActivityCategory): string {
  return CATEGORY_LABELS[category];
}

export function ActivityCategoryBadge({ category }: { category: ActivityCategory }) {
  return <Badge tone={CATEGORY_TONES[category]}>{CATEGORY_LABELS[category]}</Badge>;
}

export function ActivityAvailability({
  hasActivityData,
  hasIdleData,
  idleDetectionEnabled,
}: {
  hasActivityData: boolean;
  hasIdleData: boolean;
  idleDetectionEnabled: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Badge tone={hasActivityData ? "success" : "neutral"}>
        {hasActivityData ? "Activity data available" : "No activity data"}
      </Badge>
      <Badge tone={!idleDetectionEnabled ? "warning" : hasIdleData ? "success" : "neutral"}>
        {!idleDetectionEnabled
          ? "Idle detection disabled"
          : hasIdleData
            ? "Idle data available"
            : "No idle intervals recorded"}
      </Badge>
    </div>
  );
}
