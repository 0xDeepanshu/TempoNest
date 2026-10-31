import { apiRequest, type QueryValue } from "./api-client";
import type {
  ActivityCategory,
  ActivityOverviewResponse,
  ActivitySummaryResponse,
  ApplicationClassificationResponse,
  ApplicationClassificationsResponse,
  TrackingSettingsResponse,
} from "./types";

export type TrackingSettingsInput = {
  appTrackingEnabled?: boolean;
  idleDetectionEnabled?: boolean;
  idleThresholdMinutes?: number;
  productivityClassificationEnabled?: boolean;
  activityRetentionDays?: number;
};

export type ClassificationListQuery = {
  page?: number;
  limit?: number;
  category?: ActivityCategory;
  q?: string;
  includeObserved?: boolean;
};

export type CreateClassificationInput = {
  applicationIdentifier: string;
  applicationName?: string;
  category?: ActivityCategory;
  notes?: string | null;
};

export type UpdateClassificationInput = {
  applicationName?: string;
  category?: ActivityCategory;
  notes?: string | null;
};

export type ActivitySummaryQuery = {
  from: string;
  to: string;
  employeeId?: string;
};

export type ActivityOverviewQuery = ActivitySummaryQuery & {
  page?: number;
  limit?: number;
};

type RequestOptions = { signal?: AbortSignal };

function activityPath(organizationId: string, suffix: string): string {
  return `/organizations/${organizationId}${suffix}`;
}

function asQuery(query: object): Record<string, QueryValue> {
  return query as Record<string, QueryValue>;
}

export function getTrackingSettings(
  organizationId: string,
  options: RequestOptions = {},
) {
  return apiRequest<TrackingSettingsResponse>(
    activityPath(organizationId, "/activity/settings"),
    { signal: options.signal },
  );
}

export function updateTrackingSettings(
  organizationId: string,
  input: TrackingSettingsInput,
) {
  return apiRequest<TrackingSettingsResponse>(
    activityPath(organizationId, "/activity/settings"),
    { method: "PATCH", body: input },
  );
}

export function listApplicationClassifications(
  organizationId: string,
  query: ClassificationListQuery = {},
  options: RequestOptions = {},
) {
  return apiRequest<ApplicationClassificationsResponse>(
    activityPath(organizationId, "/application-classifications"),
    { signal: options.signal, query: asQuery(query) },
  );
}

export function createApplicationClassification(
  organizationId: string,
  input: CreateClassificationInput,
) {
  return apiRequest<ApplicationClassificationResponse>(
    activityPath(organizationId, "/application-classifications"),
    { method: "POST", body: input },
  );
}

export function updateApplicationClassification(
  organizationId: string,
  classificationId: string,
  input: UpdateClassificationInput,
) {
  return apiRequest<ApplicationClassificationResponse>(
    activityPath(organizationId, `/application-classifications/${classificationId}`),
    { method: "PATCH", body: input },
  );
}

export function getActivitySummary(
  organizationId: string,
  query: ActivitySummaryQuery,
  options: RequestOptions = {},
) {
  return apiRequest<ActivitySummaryResponse>(
    activityPath(organizationId, "/reports/activity-summary"),
    { signal: options.signal, query: asQuery(query) },
  );
}

export function getActivityOverview(
  organizationId: string,
  query: ActivityOverviewQuery,
  options: RequestOptions = {},
) {
  return apiRequest<ActivityOverviewResponse>(
    activityPath(organizationId, "/reports/activity-overview"),
    { signal: options.signal, query: asQuery(query) },
  );
}
