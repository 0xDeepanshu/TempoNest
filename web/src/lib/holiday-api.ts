import { apiRequest } from "./api-client";
import type {
  GovernmentImportResponse,
  GovernmentJurisdictionsResponse,
  GovernmentPreviewResponse,
  HolidayCalendarResponse,
  HolidayCategory,
  HolidayDuration,
  HolidayEmployeesResponse,
  HolidayPublicationResponse,
  HolidayResponse,
  HolidaySettingsResponse,
} from "./types";

function holidayPath(organizationId: string, suffix = ""): string {
  return `/organizations/${organizationId}/holidays${suffix}`;
}

export type HolidayListParams = {
  year?: number;
  from?: string;
  to?: string;
  category?: HolidayCategory;
  duration?: HolidayDuration;
  includeOptional?: boolean;
  mine?: boolean;
};

export function listHolidays(
  organizationId: string,
  params: HolidayListParams = {},
  options: { signal?: AbortSignal } = {},
) {
  return apiRequest<HolidayCalendarResponse>(holidayPath(organizationId), {
    query: params,
    signal: options.signal,
  });
}

export function getHoliday(
  organizationId: string,
  holidayId: string,
  options: { signal?: AbortSignal } = {},
) {
  return apiRequest<HolidayResponse>(holidayPath(organizationId, `/${holidayId}`), {
    signal: options.signal,
  });
}

export type CreateHolidayInput = {
  name: string;
  holidayDate: string;
  category?: HolidayCategory;
  duration?: HolidayDuration;
  description?: string | null;
  appliesToAll?: boolean;
  applicableEmployeeIds?: string[];
  departmentIds?: string[];
  locationIds?: string[];
  confirmHistorical?: boolean;
};

export type UpdateHolidayInput = Partial<CreateHolidayInput>;

export function createHoliday(organizationId: string, input: CreateHolidayInput) {
  return apiRequest<HolidayResponse>(holidayPath(organizationId), {
    method: "POST",
    body: input,
  });
}

export function updateHoliday(
  organizationId: string,
  holidayId: string,
  input: UpdateHolidayInput,
) {
  return apiRequest<HolidayResponse>(holidayPath(organizationId, `/${holidayId}`), {
    method: "PATCH",
    body: input,
  });
}

export function deleteHoliday(
  organizationId: string,
  holidayId: string,
  confirmHistorical = false,
) {
  return apiRequest<void>(holidayPath(organizationId, `/${holidayId}`), {
    method: "DELETE",
    query: confirmHistorical ? { confirmHistorical: true } : undefined,
  });
}

export function duplicateHoliday(
  organizationId: string,
  holidayId: string,
  input: { holidayDate: string; name?: string; confirmHistorical?: boolean },
) {
  return apiRequest<HolidayResponse>(
    holidayPath(organizationId, `/${holidayId}/duplicate`),
    { method: "POST", body: input },
  );
}

export function getHolidaySettings(
  organizationId: string,
  options: { signal?: AbortSignal } = {},
) {
  return apiRequest<HolidaySettingsResponse>(holidayPath(organizationId, "/settings"), {
    signal: options.signal,
  });
}

export function listHolidayEmployees(
  organizationId: string,
  options: { signal?: AbortSignal } = {},
) {
  return apiRequest<HolidayEmployeesResponse>(holidayPath(organizationId, "/employees"), {
    signal: options.signal,
  });
}

export type UpdateHolidaySettingsInput = {
  enabled?: boolean;
  optionalHolidaysEnabled?: boolean;
  allowHalfDayHolidays?: boolean;
  defaultCalendarYear?: number | null;
  defaultApplicability?: "ORGANIZATION" | "EMPLOYEES";
  workingDays?: number[];
  governmentCountry?: string;
  governmentRegion?: string | null;
  governmentYear?: number | null;
};

export function updateHolidaySettings(
  organizationId: string,
  input: UpdateHolidaySettingsInput,
) {
  return apiRequest<HolidaySettingsResponse>(holidayPath(organizationId, "/settings"), {
    method: "PUT",
    body: input,
  });
}

export function getGovernmentJurisdictions(
  organizationId: string,
  options: { signal?: AbortSignal } = {},
) {
  return apiRequest<GovernmentJurisdictionsResponse>(
    holidayPath(organizationId, "/government/jurisdictions"),
    { signal: options.signal },
  );
}

export type GovernmentPreviewParams = {
  country?: string;
  region?: string;
  year?: number;
};

export function previewGovernmentHolidays(
  organizationId: string,
  params: GovernmentPreviewParams = {},
  options: { signal?: AbortSignal } = {},
) {
  return apiRequest<GovernmentPreviewResponse>(
    holidayPath(organizationId, "/government/preview"),
    { query: params, signal: options.signal },
  );
}

export type ImportGovernmentHolidaysInput = {
  country: string;
  region: string;
  year: number;
  sourceIds: string[];
};

export function importGovernmentHolidays(
  organizationId: string,
  input: ImportGovernmentHolidaysInput,
) {
  return apiRequest<GovernmentImportResponse>(
    holidayPath(organizationId, "/government/import"),
    { method: "POST", body: input },
  );
}

export type PublicationInput = {
  holidayIds: string[];
  published: boolean;
  confirmHistorical?: boolean;
};

export function updateHolidayPublication(
  organizationId: string,
  input: PublicationInput,
) {
  return apiRequest<HolidayPublicationResponse>(
    holidayPath(organizationId, "/publication"),
    { method: "POST", body: input },
  );
}
