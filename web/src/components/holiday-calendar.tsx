"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { errorMessage } from "@/lib/api-error";
import { formatDay, formatDateTime, todayInTimeZone } from "@/lib/format";
import {
  createHoliday,
  deleteHoliday,
  duplicateHoliday,
  listHolidayEmployees,
  listHolidays,
  updateHoliday,
  updateHolidayPublication,
  type CreateHolidayInput,
} from "@/lib/holiday-api";
import {
  HOLIDAY_FILTERS,
  holidayCategoryLabel,
  holidayFilterLabel,
  holidayJurisdiction,
  holidaySourceLabel,
  isDraftHoliday,
  isGovernmentHoliday,
  matchesHolidayFilter,
  type HolidayFilter,
} from "@/lib/holidays";
import type {
  Holiday,
  HolidayCategory,
  HolidayDuration,
  HolidayEmployee,
  HolidaySettings,
} from "@/lib/types";
import { useApi } from "@/lib/use-api";
import {
  BuildingIcon,
  CalendarIcon,
  ChevronDownIcon,
  CopyIcon,
  EditIcon,
  PlusIcon,
  SearchIcon,
  TrashIcon,
} from "./icons";
import { ConfirmDialog } from "./confirm-dialog";
import { GovernmentHolidayImport } from "./government-holiday-import";
import { Modal } from "./modal";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  DetailRow,
  EmptyState,
  ErrorState,
  Field,
  Input,
  LoadingBlock,
  PageHeader,
  Select,
  TableShell,
  Tabs,
  Td,
  Textarea,
  Th,
  cn,
} from "./ui";

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const CATEGORY_META: Record<
  HolidayCategory,
  { tone: "indigo" | "success" | "warning" | "info" | "neutral"; dot: string }
> = {
  PUBLIC: { tone: "indigo", dot: "bg-ink" },
  COMPANY: { tone: "success", dot: "bg-success" },
  OPTIONAL: { tone: "warning", dot: "bg-warning" },
  NATIONAL: { tone: "indigo", dot: "bg-ink" },
  STATE: { tone: "info", dot: "bg-ink-secondary" },
  GAZETTED: { tone: "neutral", dot: "bg-ink-secondary" },
  RESTRICTED: { tone: "warning", dot: "bg-warning" },
};

const DURATION_LABELS: Record<HolidayDuration, string> = {
  FULL_DAY: "Full day",
  FIRST_HALF: "First half",
  SECOND_HALF: "Second half",
};

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function isoDate(year: number, month: number, day: number): string {
  return `${year}-${pad2(month + 1)}-${pad2(day)}`;
}

function shiftYear(dateOnly: string, years: number): string {
  const [year, month, day] = dateOnly.split("-").map(Number);
  const candidate = `${year + years}-${pad2(month)}-${pad2(day)}`;
  const parsed = new Date(`${candidate}T00:00:00.000Z`);
  // Clamp Feb 29 to Feb 28 in non-leap years.
  if (parsed.getUTCMonth() !== month - 1) {
    return `${year + years}-${pad2(month)}-28`;
  }
  return candidate;
}

function applicabilityLabel(holiday: Holiday): string {
  if (holiday.appliesToAll) return "Entire organization";
  const count = holiday.applicableEmployeeIds.length;
  return count === 1 ? "1 employee" : `${count} employees`;
}

type HolidayFormState = {
  name: string;
  holidayDate: string;
  category: HolidayCategory;
  duration: HolidayDuration;
  description: string;
  appliesToAll: boolean;
  applicableEmployeeIds: string[];
};

function formFromHoliday(holiday: Holiday): HolidayFormState {
  return {
    name: holiday.name,
    holidayDate: holiday.holidayDate,
    category: holiday.category,
    duration: holiday.duration,
    description: holiday.description ?? "",
    appliesToAll: holiday.appliesToAll,
    applicableEmployeeIds: [...holiday.applicableEmployeeIds],
  };
}

export function HolidayCalendarView({
  organizationId,
  timezone,
  mode,
  canCreate,
  canUpdate,
  canDelete,
  canManageSettings,
}: {
  organizationId: string;
  timezone: string;
  mode: "admin" | "employee";
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  canManageSettings: boolean;
}) {
  const router = useRouter();
  const today = todayInTimeZone(timezone);
  const [year, setYear] = useState(() => Number(today.slice(0, 4)));
  const [month, setMonth] = useState(() => Number(today.slice(5, 7)) - 1);
  const [selectedDate, setSelectedDate] = useState(today);
  const [view, setView] = useState<"calendar" | "list">("calendar");
  const [filter, setFilter] = useState<HolidayFilter>("ALL");

  const calendar = useApi(
    (signal) =>
      listHolidays(
        organizationId,
        { year, mine: mode === "employee" },
        { signal },
      ),
    [organizationId, year, mode],
  );

  const holidays = useMemo(
    () => calendar.data?.data.holidays ?? [],
    [calendar.data],
  );
  const visibleHolidays = useMemo(
    () => holidays.filter((holiday) => matchesHolidayFilter(holiday, filter)),
    [holidays, filter],
  );
  const filterCounts = useMemo(() => {
    const counts: Record<HolidayFilter, number> = {
      ALL: holidays.length,
      GOVERNMENT: 0,
      COMPANY: 0,
      OPTIONAL: 0,
    };
    for (const holiday of holidays) {
      for (const key of HOLIDAY_FILTERS) {
        if (key !== "ALL" && matchesHolidayFilter(holiday, key)) counts[key] += 1;
      }
    }
    return counts;
  }, [holidays]);
  const settings = calendar.data?.data.settings;
  const defaultCalendarYear = settings?.defaultCalendarYear ?? null;

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Holiday | null>(null);
  const [form, setForm] = useState<HolidayFormState>({
    name: "",
    holidayDate: today,
    category: "COMPANY",
    duration: "FULL_DAY",
    description: "",
    appliesToAll: true,
    applicableEmployeeIds: [],
  });
  const [confirmHistorical, setConfirmHistorical] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [employeeSearch, setEmployeeSearch] = useState("");

  const employees = useApi(
    (signal) => listHolidayEmployees(organizationId, { signal }),
    [organizationId],
    { enabled: formOpen && !form.appliesToAll },
  );

  const [deleteTarget, setDeleteTarget] = useState<Holiday | null>(null);
  const [deleteHistorical, setDeleteHistorical] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [duplicateTarget, setDuplicateTarget] = useState<Holiday | null>(null);
  const [duplicateDate, setDuplicateDate] = useState(today);
  const [duplicateName, setDuplicateName] = useState("");
  const [duplicateHistorical, setDuplicateHistorical] = useState(false);
  const [duplicateError, setDuplicateError] = useState<string | null>(null);
  const [duplicating, setDuplicating] = useState(false);

  const [publicationTarget, setPublicationTarget] = useState<Holiday | null>(null);
  const [publicationHistorical, setPublicationHistorical] = useState(false);
  const [publicationError, setPublicationError] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);

  const [importOpen, setImportOpen] = useState(false);

  const holidayMap = useMemo(() => {
    const map = new Map<string, Holiday[]>();
    for (const holiday of visibleHolidays) {
      const list = map.get(holiday.holidayDate) ?? [];
      list.push(holiday);
      map.set(holiday.holidayDate, list);
    }
    return map;
  }, [visibleHolidays]);

  const selectedHolidays = holidayMap.get(selectedDate) ?? [];
  const monthHolidays = visibleHolidays.filter((holiday) =>
    holiday.holidayDate.startsWith(`${year}-${pad2(month + 1)}`),
  );
  const upcoming = visibleHolidays
    .filter((holiday) => holiday.holidayDate >= today)
    .sort((a, b) => a.holidayDate.localeCompare(b.holidayDate))
    .slice(0, 5);

  const yearOptions = useMemo(() => {
    const values = new Set<number>();
    for (let offset = -4; offset <= 4; offset += 1) values.add(year + offset);
    if (defaultCalendarYear) values.add(defaultCalendarYear);
    for (const holiday of holidays) values.add(Number(holiday.holidayDate.slice(0, 4)));
    return [...values].sort((a, b) => a - b);
  }, [holidays, defaultCalendarYear, year]);

  const firstWeekday = new Date(Date.UTC(year, month, 1)).getUTCDay();
  const leadingBlanks = (firstWeekday + 6) % 7;
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const cells: Array<number | null> = [
    ...Array.from({ length: leadingBlanks }, () => null),
    ...Array.from({ length: daysInMonth }, (_, index) => index + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  const isPastFormDate = form.holidayDate < today;
  const isPastDeleteDate = deleteTarget ? deleteTarget.holidayDate < today : false;
  const isPastDuplicateDate = duplicateDate < today;
  const isPastPublicationDate = publicationTarget ? publicationTarget.holidayDate < today : false;

  const filteredEmployees = (employees.data?.data ?? []).filter((employee) => {
    const query = employeeSearch.trim().toLowerCase();
    if (!query) return true;
    return (
      employee.name.toLowerCase().includes(query) ||
      employee.email.toLowerCase().includes(query)
    );
  });

  function openCreate(dateOnly = selectedDate) {
    setEditing(null);
    setForm({
      name: "",
      holidayDate: dateOnly,
      category: "COMPANY",
      duration: "FULL_DAY",
      description: "",
      appliesToAll: settings?.defaultApplicability !== "EMPLOYEES",
      applicableEmployeeIds: [],
    });
    setConfirmHistorical(false);
    setFormError(null);
    setEmployeeSearch("");
    setFormOpen(true);
  }

  function openEdit(holiday: Holiday) {
    setEditing(holiday);
    setForm(formFromHoliday(holiday));
    setConfirmHistorical(false);
    setFormError(null);
    setEmployeeSearch("");
    setFormOpen(true);
  }

  function openDuplicate(holiday: Holiday) {
    setDuplicateTarget(holiday);
    setDuplicateDate(shiftYear(holiday.holidayDate, 1));
    setDuplicateName(holiday.name);
    setDuplicateHistorical(false);
    setDuplicateError(null);
  }

  function changeMonth(delta: number) {
    let nextMonth = month + delta;
    let nextYear = year;
    if (nextMonth < 0) {
      nextMonth = 11;
      nextYear -= 1;
    } else if (nextMonth > 11) {
      nextMonth = 0;
      nextYear += 1;
    }
    setMonth(nextMonth);
    setYear(nextYear);
    setSelectedDate(isoDate(nextYear, nextMonth, 1));
  }

  function jumpToToday() {
    const nextYear = Number(today.slice(0, 4));
    const nextMonth = Number(today.slice(5, 7)) - 1;
    setYear(nextYear);
    setMonth(nextMonth);
    setSelectedDate(today);
  }

  function changeYear(nextYear: number) {
    setYear(nextYear);
    setSelectedDate(isoDate(nextYear, month, 1));
  }

  function toggleEmployee(employee: HolidayEmployee) {
    setForm((current) => {
      const exists = current.applicableEmployeeIds.includes(employee.id);
      return {
        ...current,
        applicableEmployeeIds: exists
          ? current.applicableEmployeeIds.filter((id) => id !== employee.id)
          : [...current.applicableEmployeeIds, employee.id],
      };
    });
  }

  async function submitForm() {
    setFormError(null);
    if (!form.name.trim()) {
      setFormError("Holiday name is required.");
      return;
    }
    if (!form.holidayDate) {
      setFormError("Holiday date is required.");
      return;
    }
    if (!form.appliesToAll && form.applicableEmployeeIds.length === 0) {
      setFormError("Select at least one employee, or apply the holiday to the whole organization.");
      return;
    }
    if (isPastFormDate && !confirmHistorical) {
      setFormError("Confirm that this historical change is intentional.");
      return;
    }

    const payload: CreateHolidayInput = {
      name: form.name.trim(),
      holidayDate: form.holidayDate,
      category: form.category,
      duration: form.duration,
      description: form.description.trim() ? form.description.trim() : null,
      appliesToAll: form.appliesToAll,
      applicableEmployeeIds: form.appliesToAll ? [] : form.applicableEmployeeIds,
      departmentIds: [],
      locationIds: [],
      confirmHistorical: isPastFormDate ? confirmHistorical : false,
    };

    setSaving(true);
    try {
      if (editing) {
        await updateHoliday(organizationId, editing.id, payload);
      } else {
        await createHoliday(organizationId, payload);
      }
      setFormOpen(false);
      setSelectedDate(form.holidayDate);
      calendar.reload();
    } catch (error) {
      setFormError(errorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleteError(null);
    if (isPastDeleteDate && !deleteHistorical) {
      setDeleteError("Confirm that this historical change is intentional.");
      return;
    }
    setDeleting(true);
    try {
      await deleteHoliday(organizationId, deleteTarget.id, isPastDeleteDate && deleteHistorical);
      setDeleteTarget(null);
      calendar.reload();
    } catch (error) {
      setDeleteError(errorMessage(error));
    } finally {
      setDeleting(false);
    }
  }

  async function confirmDuplicate() {
    if (!duplicateTarget) return;
    setDuplicateError(null);
    if (!duplicateDate) {
      setDuplicateError("Choose a date for the duplicate.");
      return;
    }
    if (isPastDuplicateDate && !duplicateHistorical) {
      setDuplicateError("Confirm that this historical change is intentional.");
      return;
    }
    setDuplicating(true);
    try {
      await duplicateHoliday(organizationId, duplicateTarget.id, {
        holidayDate: duplicateDate,
        name: duplicateName.trim() || undefined,
        confirmHistorical: isPastDuplicateDate ? duplicateHistorical : false,
      });
      setDuplicateTarget(null);
      setSelectedDate(duplicateDate);
      calendar.reload();
    } catch (error) {
      setDuplicateError(errorMessage(error));
    } finally {
      setDuplicating(false);
    }
  }

  function openPublication(holiday: Holiday) {
    setPublicationTarget(holiday);
    setPublicationHistorical(false);
    setPublicationError(null);
  }

  async function confirmPublication() {
    if (!publicationTarget) return;
    setPublicationError(null);
    if (isPastPublicationDate && !publicationHistorical) {
      setPublicationError("Confirm that this historical change is intentional.");
      return;
    }
    const nextPublished = !publicationTarget.published;
    setPublishing(true);
    try {
      await updateHolidayPublication(organizationId, {
        holidayIds: [publicationTarget.id],
        published: nextPublished,
        confirmHistorical: isPastPublicationDate ? publicationHistorical : false,
      });
      setPublicationTarget(null);
      calendar.reload();
    } catch (error) {
      setPublicationError(errorMessage(error));
    } finally {
      setPublishing(false);
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={mode === "employee" ? "Your time" : "Holiday calendar"}
        title={mode === "employee" ? "Holiday calendar" : "Company holidays"}
        description={
          mode === "employee"
            ? "Read-only view of the holidays that apply to you. Contact your HR administrator if a holiday looks incorrect."
            : "Plan the organization calendar, publish public and company holidays, and keep half-days and employee-specific dates in one place."
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {canManageSettings ? (
              <Button variant="secondary" onClick={() => router.push("/admin/leave/holidays/settings")}>
                Holiday settings
              </Button>
            ) : null}
            {canCreate ? (
              <Button variant="secondary" onClick={() => setImportOpen(true)}>
                <BuildingIcon className="h-4 w-4" />
                Import government holidays
              </Button>
            ) : null}
            {canCreate ? (
              <Button onClick={() => openCreate()}>
                <PlusIcon className="h-4 w-4" />
                Add holiday
              </Button>
            ) : null}
          </div>
        }
      />

      {settings && !settings.enabled && mode === "admin" ? (
        <Alert tone="warning" title="Holiday management is disabled">
          Existing holidays remain visible, but new holidays cannot be created until holiday management is
          enabled in holiday settings.
        </Alert>
      ) : null}

      {calendar.error ? (
        <ErrorState message={calendar.error} onRetry={calendar.reload} />
      ) : calendar.loading ? (
        <Card>
          <LoadingBlock label="Loading holiday calendar" rows={5} />
        </Card>
      ) : (
        <>
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="secondary" size="sm" onClick={() => changeMonth(-1)} aria-label="Previous month">
                  Prev
                </Button>
                <Button variant="secondary" size="sm" onClick={jumpToToday}>
                  Today
                </Button>
                <Button variant="secondary" size="sm" onClick={() => changeMonth(1)} aria-label="Next month">
                  Next
                </Button>
                <span className="ml-1 text-[15px] font-semibold text-ink">
                  {MONTHS[month]} {year}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Select
                  aria-label="Month"
                  value={month}
                  onChange={(event) => {
                    const nextMonth = Number(event.target.value);
                    setMonth(nextMonth);
                    setSelectedDate(isoDate(year, nextMonth, 1));
                  }}
                  className="w-36"
                >
                  {MONTHS.map((label, index) => (
                    <option key={label} value={index}>
                      {label}
                    </option>
                  ))}
                </Select>
                <Select
                  aria-label="Year"
                  value={year}
                  onChange={(event) => changeYear(Number(event.target.value))}
                  className="w-28"
                >
                  {yearOptions.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </Select>
                <Tabs
                  value={view}
                  onChange={setView}
                  tabs={[
                    { value: "calendar", label: "Calendar" },
                    { value: "list", label: "List" },
                  ]}
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2.5">
              <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter holidays">
                {HOLIDAY_FILTERS.map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setFilter(value)}
                    aria-pressed={filter === value}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
                      filter === value
                        ? "border-ink bg-ink text-on-strong"
                        : "border-line bg-surface text-ink-secondary hover:bg-surface-hover",
                    )}
                  >
                    {holidayFilterLabel(value)}
                    <span className={cn("tnum text-[11px]", filter === value ? "text-on-strong opacity-80" : "text-muted")}>
                      {filterCounts[value]}
                    </span>
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted">
                <span className="inline-flex items-center gap-1">
                  <span className="h-1.5 w-1.5 rounded-full bg-success" />
                  Company
                </span>
                <span className="inline-flex items-center gap-1">
                  <BuildingIcon className="h-3 w-3 text-ink-secondary" />
                  Government
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="h-1.5 w-1.5 rounded-full bg-warning" />
                  Optional / restricted
                </span>
              </div>
            </div>

            {view === "calendar" ? (
              <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_340px]">
                <div className="min-w-0 border-b border-line lg:border-b-0 lg:border-r">
                  <div className="grid grid-cols-7 border-b border-line bg-surface-muted">
                    {WEEKDAY_LABELS.map((label) => (
                      <div
                        key={label}
                        className="px-2 py-2 text-center text-[10px] font-semibold uppercase tracking-[0.08em] text-muted"
                      >
                        {label}
                      </div>
                    ))}
                  </div>
                  <div className="grid grid-cols-7">
                    {cells.map((day, index) => {
                      if (day === null) {
                        return <div key={`blank-${index}`} className="min-h-24 border-b border-r border-line bg-surface-muted/40" />;
                      }
                      const dateOnly = isoDate(year, month, day);
                      const dayHolidays = holidayMap.get(dateOnly) ?? [];
                      const isToday = dateOnly === today;
                      const isSelected = dateOnly === selectedDate;
                      const fullDay = dayHolidays.some((holiday) => holiday.duration === "FULL_DAY");
                      return (
                        <button
                          key={dateOnly}
                          type="button"
                          onClick={() => setSelectedDate(dateOnly)}
                          className={cn(
                            "min-h-24 border-b border-r border-line p-2 text-left align-top transition-colors hover:bg-surface-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-ink",
                            fullDay && "bg-surface-muted",
                            isSelected && "ring-2 ring-inset ring-ink",
                          )}
                          aria-pressed={isSelected}
                        >
                          <div className="flex items-center justify-between gap-1">
                            <span
                              className={cn(
                                "inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-xs font-semibold",
                                isToday ? "bg-ink text-on-strong" : "text-ink-secondary",
                              )}
                            >
                              {day}
                            </span>
                            {dayHolidays.length > 0 ? (
                              <span className="text-[10px] font-medium text-muted">{dayHolidays.length}</span>
                            ) : null}
                          </div>
                          <div className="mt-1.5 space-y-1">
                            {dayHolidays.slice(0, 2).map((holiday) => (
                              <div
                                key={holiday.id}
                                className="flex items-center gap-1.5"
                                title={
                                  holidayJurisdiction(holiday)
                                    ? `${holiday.name} · ${holidayJurisdiction(holiday)}`
                                    : holiday.name
                                }
                              >
                                {isGovernmentHoliday(holiday) ? (
                                  <BuildingIcon className="h-3 w-3 shrink-0 text-ink-secondary" />
                                ) : (
                                  <span
                                    className={cn("h-1.5 w-1.5 shrink-0 rounded-full", CATEGORY_META[holiday.category].dot)}
                                  />
                                )}
                                <span className="truncate text-[11px] leading-4 text-ink-secondary">
                                  {holiday.name}
                                </span>
                              </div>
                            ))}
                            {dayHolidays.length > 2 ? (
                              <p className="text-[10px] text-muted">+{dayHolidays.length - 2} more</p>
                            ) : null}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="min-w-0 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
                        Selected date
                      </p>
                      <h3 className="mt-0.5 text-[15px] font-semibold text-ink">
                        {formatDay(selectedDate, {
                          weekday: "long",
                          month: "long",
                          day: "numeric",
                          year: "numeric",
                        })}
                      </h3>
                    </div>
                    {canCreate ? (
                      <Button variant="secondary" size="sm" onClick={() => openCreate(selectedDate)}>
                        <PlusIcon className="h-3.5 w-3.5" />
                        Add
                      </Button>
                    ) : null}
                  </div>

                  <div className="mt-3 space-y-2">
                    {selectedHolidays.length === 0 ? (
                      <EmptyState
                        title="No holidays on this date"
                        description={
                          mode === "employee"
                            ? "This is a normal working day unless your organization adds a holiday."
                            : "Add a public, company, or optional holiday for this date."
                        }
                        icon={<CalendarIcon className="h-4 w-4" />}
                      />
                    ) : (
                      selectedHolidays.map((holiday) => (
                        <div key={holiday.id} className="rounded-lg border border-line p-3">
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="text-[13px] font-semibold text-ink">{holiday.name}</p>
                              <div className="mt-1 flex flex-wrap gap-1.5">
                                <Badge tone={CATEGORY_META[holiday.category].tone}>
                                  {holidayCategoryLabel(holiday.category)}
                                </Badge>
                                <Badge tone="outline">{DURATION_LABELS[holiday.duration]}</Badge>
                                {isGovernmentHoliday(holiday) ? (
                                  <Badge tone="outline">
                                    <BuildingIcon className="h-3 w-3" />
                                    Government
                                  </Badge>
                                ) : null}
                                {isDraftHoliday(holiday) ? (
                                  <Badge tone="warning">Draft — not applied</Badge>
                                ) : null}
                              </div>
                            </div>
                            {mode === "admin" && (canUpdate || canDelete) ? (
                              <div className="flex items-center gap-1">
                                {canUpdate && (!holiday.published || isGovernmentHoliday(holiday)) ? (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => openPublication(holiday)}
                                    aria-label={holiday.published ? "Unpublish holiday" : "Publish holiday"}
                                    title={holiday.published ? "Unpublish holiday" : "Publish holiday"}
                                  >
                                    {holiday.published ? "Unpublish" : "Publish"}
                                  </Button>
                                ) : null}
                                {canUpdate ? (
                                  <Button variant="ghost" size="sm" onClick={() => openEdit(holiday)} aria-label="Edit holiday">
                                    <EditIcon className="h-3.5 w-3.5" />
                                  </Button>
                                ) : null}
                                {canCreate && !isGovernmentHoliday(holiday) ? (
                                  <Button variant="ghost" size="sm" onClick={() => openDuplicate(holiday)} aria-label="Duplicate holiday">
                                    <CopyIcon className="h-3.5 w-3.5" />
                                  </Button>
                                ) : null}
                                {canDelete ? (
                                  <Button variant="ghost" size="sm" onClick={() => { setDeleteTarget(holiday); setDeleteHistorical(false); setDeleteError(null); }} aria-label="Delete holiday">
                                    <TrashIcon className="h-3.5 w-3.5" />
                                  </Button>
                                ) : null}
                              </div>
                            ) : null}
                          </div>
                          {holiday.description ? (
                            <p className="mt-2 text-xs leading-5 text-muted">{holiday.description}</p>
                          ) : null}
                          <dl className="mt-2">
                            <DetailRow label="Applies to" value={applicabilityLabel(holiday)} />
                            {holidayJurisdiction(holiday) ? (
                              <DetailRow label="Jurisdiction" value={holidayJurisdiction(holiday)!} />
                            ) : null}
                            {isGovernmentHoliday(holiday) ? (
                              <DetailRow
                                label="Source"
                                value={
                                  holiday.sourceUrl ? (
                                    <a
                                      href={holiday.sourceUrl}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="underline underline-offset-2"
                                    >
                                      {holiday.sourceName ?? "Government notification"}
                                    </a>
                                  ) : (
                                    holiday.sourceName ?? "Government notification"
                                  )
                                }
                              />
                            ) : null}
                            {holiday.updatedBy ? (
                              <DetailRow
                                label="Last updated"
                                value={`${holiday.updatedBy.name} · ${formatDateTime(holiday.updatedAt, timezone)}`}
                              />
                            ) : null}
                          </dl>
                        </div>
                      ))
                    )}
                  </div>

                  <div className="mt-5">
                    <div className="flex items-center justify-between gap-2">
                      <h4 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
                        Upcoming holidays
                      </h4>
                      <span className="text-[11px] text-muted">{monthHolidays.length} this month</span>
                    </div>
                    <div className="mt-2 space-y-1.5">
                      {upcoming.length === 0 ? (
                        <p className="text-xs text-muted">No upcoming holidays in {year}.</p>
                      ) : (
                        upcoming.map((holiday) => (
                          <button
                            key={holiday.id}
                            type="button"
                            onClick={() => {
                              setSelectedDate(holiday.holidayDate);
                              setYear(Number(holiday.holidayDate.slice(0, 4)));
                              setMonth(Number(holiday.holidayDate.slice(5, 7)) - 1);
                            }}
                            className="flex w-full items-center justify-between gap-2 rounded-lg border border-line px-2.5 py-2 text-left transition-colors hover:bg-surface-hover"
                          >
                            <div className="min-w-0">
                              <p className="truncate text-xs font-medium text-ink">{holiday.name}</p>
                              <p className="text-[11px] text-muted">
                                {formatDay(holiday.holidayDate, { month: "short", day: "numeric" })}
                              </p>
                            </div>
                            <Badge tone={CATEGORY_META[holiday.category].tone}>
                              {holiday.duration === "FULL_DAY" ? "Full day" : "Half day"}
                            </Badge>
                          </button>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <CardBody className="p-0">
                {visibleHolidays.length === 0 ? (
                  <EmptyState
                    title={filter === "ALL" ? `No holidays in ${year}` : `No ${holidayFilterLabel(filter).toLowerCase()} holidays in ${year}`}
                    description={
                      filter !== "ALL"
                        ? "Try another filter or add a holiday for this year."
                        : mode === "employee"
                          ? "Your organization has not published any holidays for this year."
                          : "Add the first holiday for this year, or import a verified government calendar."
                    }
                    icon={<CalendarIcon className="h-4 w-4" />}
                    action={
                      canCreate ? (
                        <Button onClick={() => openCreate(`${year}-01-01`)}>
                          <PlusIcon className="h-4 w-4" />
                          Add holiday
                        </Button>
                      ) : undefined
                    }
                  />
                ) : (
                  <TableShell className="min-w-[840px]">
                    <thead>
                      <tr>
                        <Th>Date</Th>
                        <Th>Holiday</Th>
                        <Th>Category</Th>
                        <Th>Jurisdiction</Th>
                        <Th>Duration</Th>
                        <Th>Applicability</Th>
                        {mode === "admin" ? <Th className="text-right">Actions</Th> : null}
                      </tr>
                    </thead>
                    <tbody>
                      {visibleHolidays.map((holiday) => (
                        <tr key={holiday.id}>
                          <Td className="whitespace-nowrap">
                            <span className="font-medium text-ink">
                              {formatDay(holiday.holidayDate, { month: "short", day: "numeric" })}
                            </span>
                            <span className="ml-1 text-[11px] text-muted">
                              {formatDay(holiday.holidayDate, { weekday: "short" })}
                            </span>
                          </Td>
                          <Td>
                            <div className="flex flex-wrap items-center gap-1.5">
                              <p className="font-medium text-ink">{holiday.name}</p>
                              {isDraftHoliday(holiday) ? <Badge tone="warning">Draft</Badge> : null}
                            </div>
                            {holiday.description ? (
                              <p className="mt-0.5 line-clamp-1 text-[11px] text-muted">{holiday.description}</p>
                            ) : null}
                          </Td>
                          <Td>
                            <Badge tone={CATEGORY_META[holiday.category].tone}>
                              {holidayCategoryLabel(holiday.category)}
                            </Badge>
                          </Td>
                          <Td>
                            {holidayJurisdiction(holiday) ? (
                              <span className="inline-flex items-center gap-1 text-xs text-ink-secondary">
                                <BuildingIcon className="h-3 w-3" />
                                {holidayJurisdiction(holiday)}
                              </span>
                            ) : (
                              <span className="text-xs text-muted">{holidaySourceLabel(holiday.source)}</span>
                            )}
                          </Td>
                          <Td>{DURATION_LABELS[holiday.duration]}</Td>
                          <Td>{applicabilityLabel(holiday)}</Td>
                          {mode === "admin" ? (
                            <Td className="text-right">
                              <div className="flex justify-end gap-1">
                                {canUpdate && (!holiday.published || isGovernmentHoliday(holiday)) ? (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => openPublication(holiday)}
                                    title={holiday.published ? "Unpublish holiday" : "Publish holiday"}
                                  >
                                    {holiday.published ? "Unpublish" : "Publish"}
                                  </Button>
                                ) : null}
                                {canUpdate ? (
                                  <Button variant="ghost" size="sm" onClick={() => openEdit(holiday)}>
                                    <EditIcon className="h-3.5 w-3.5" />
                                  </Button>
                                ) : null}
                                {canCreate && !isGovernmentHoliday(holiday) ? (
                                  <Button variant="ghost" size="sm" onClick={() => openDuplicate(holiday)}>
                                    <CopyIcon className="h-3.5 w-3.5" />
                                  </Button>
                                ) : null}
                                {canDelete ? (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => {
                                      setDeleteTarget(holiday);
                                      setDeleteHistorical(false);
                                      setDeleteError(null);
                                    }}
                                  >
                                    <TrashIcon className="h-3.5 w-3.5" />
                                  </Button>
                                ) : null}
                              </div>
                            </Td>
                          ) : null}
                        </tr>
                      ))}
                    </tbody>
                  </TableShell>
                )}
              </CardBody>
            )}
          </Card>

          {mode === "admin" ? (
            <Card>
              <CardHeader
                title="Calendar configuration"
                description="Working days and holiday policy are managed once for the organization."
                actions={
                  canManageSettings ? (
                    <Link
                      href="/admin/leave/holidays/settings"
                      className="inline-flex items-center gap-1 text-xs font-medium text-ink underline-offset-2 hover:underline"
                    >
                      Open holiday settings
                      <ChevronDownIcon className="h-3.5 w-3.5 -rotate-90" />
                    </Link>
                  ) : null
                }
              />
              <CardBody className="grid gap-3 sm:grid-cols-3">
                <div>
                  <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted">Holidays in {year}</p>
                  <p className="mt-1 text-xl font-semibold tnum text-ink">{holidays.length}</p>
                </div>
                <div>
                  <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted">Optional holidays</p>
                  <p className="mt-1 text-sm font-medium text-ink">
                    {settings?.optionalHolidaysEnabled ? "Enabled" : "Disabled"}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted">Half-day holidays</p>
                  <p className="mt-1 text-sm font-medium text-ink">
                    {settings?.allowHalfDayHolidays ? "Enabled" : "Disabled"}
                  </p>
                </div>
              </CardBody>
            </Card>
          ) : null}
        </>
      )}

      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editing ? "Edit holiday" : "Add holiday"}
        description={
          editing
            ? "Changes apply to future leave and attendance calculations. Past dates require explicit confirmation."
            : "Create a public, company, or optional holiday and choose who it applies to."
        }
        size="lg"
        dismissible={!saving}
        footer={
          <>
            <Button variant="secondary" onClick={() => setFormOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={submitForm} loading={saving}>
              {editing ? "Save changes" : "Create holiday"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {formError ? <Alert tone="danger">{formError}</Alert> : null}

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Holiday name" htmlFor="holiday-name" required>
              <Input
                id="holiday-name"
                value={form.name}
                maxLength={120}
                onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                placeholder="e.g. Independence Day"
                data-autofocus
              />
            </Field>
            <Field label="Date" htmlFor="holiday-date" required>
              <Input
                id="holiday-date"
                type="date"
                value={form.holidayDate}
                onChange={(event) => setForm((current) => ({ ...current, holidayDate: event.target.value }))}
              />
            </Field>
            <Field
              label="Category"
              htmlFor="holiday-category"
              hint={
                editing && isGovernmentHoliday(editing)
                  ? "Managed by the imported government notification. Rename or reschedule only when required."
                  : undefined
              }
            >
              {editing && isGovernmentHoliday(editing) ? (
                <div className="flex h-9 items-center gap-2">
                  <Badge tone={CATEGORY_META[editing.category].tone}>
                    {holidayCategoryLabel(editing.category)}
                  </Badge>
                  <Badge tone="outline">
                    <BuildingIcon className="h-3 w-3" />
                    Government
                  </Badge>
                </div>
              ) : (
                <Select
                  id="holiday-category"
                  value={form.category}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, category: event.target.value as HolidayCategory }))
                  }
                >
                  <option value="PUBLIC">Public holiday</option>
                  <option value="COMPANY">Company holiday</option>
                  <option value="OPTIONAL" disabled={settings ? !settings.optionalHolidaysEnabled : false}>
                    Optional holiday
                  </option>
                </Select>
              )}
            </Field>
            <Field label="Duration" htmlFor="holiday-duration">
              <Select
                id="holiday-duration"
                value={form.duration}
                onChange={(event) =>
                  setForm((current) => ({ ...current, duration: event.target.value as HolidayDuration }))
                }
              >
                <option value="FULL_DAY">Full day</option>
                <option value="FIRST_HALF" disabled={settings ? !settings.allowHalfDayHolidays : false}>
                  First half
                </option>
                <option value="SECOND_HALF" disabled={settings ? !settings.allowHalfDayHolidays : false}>
                  Second half
                </option>
              </Select>
            </Field>
          </div>

          <Field label="Description" htmlFor="holiday-description" hint="Optional context for employees.">
            <Textarea
              id="holiday-description"
              value={form.description}
              maxLength={2000}
              onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
              placeholder="Why is this holiday observed?"
            />
          </Field>

          <div className="space-y-2">
            <p className="text-xs font-medium text-ink-secondary">Applicability</p>
            <div className="flex flex-wrap gap-2">
              <Button
                variant={form.appliesToAll ? "primary" : "secondary"}
                size="sm"
                onClick={() => setForm((current) => ({ ...current, appliesToAll: true, applicableEmployeeIds: [] }))}
              >
                Entire organization
              </Button>
              <Button
                variant={!form.appliesToAll ? "primary" : "secondary"}
                size="sm"
                onClick={() => setForm((current) => ({ ...current, appliesToAll: false }))}
              >
                Selected employees
              </Button>
            </div>
            {!form.appliesToAll ? (
              <div className="rounded-lg border border-line">
                <div className="border-b border-line p-2">
                  <div className="relative">
                    <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
                    <Input
                      value={employeeSearch}
                      onChange={(event) => setEmployeeSearch(event.target.value)}
                      placeholder="Search employees"
                      className="pl-8"
                    />
                  </div>
                </div>
                <div className="max-h-48 overflow-y-auto p-2">
                  {employees.loading ? (
                    <p className="p-2 text-xs text-muted">Loading employees…</p>
                  ) : employees.error ? (
                    <p className="p-2 text-xs text-danger">{employees.error}</p>
                  ) : filteredEmployees.length === 0 ? (
                    <p className="p-2 text-xs text-muted">No matching employees.</p>
                  ) : (
                    filteredEmployees.map((employee) => (
                      <label
                        key={employee.id}
                        className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-surface-hover"
                      >
                        <input
                          type="checkbox"
                          checked={form.applicableEmployeeIds.includes(employee.id)}
                          onChange={() => toggleEmployee(employee)}
                          className="h-3.5 w-3.5 rounded border-line-strong"
                        />
                        <span className="min-w-0">
                          <span className="block truncate font-medium text-ink">{employee.name}</span>
                          <span className="block truncate text-[11px] text-muted">{employee.email}</span>
                        </span>
                      </label>
                    ))
                  )}
                </div>
                <p className="border-t border-line px-2 py-1.5 text-[11px] text-muted">
                  {form.applicableEmployeeIds.length} selected
                </p>
              </div>
            ) : null}
          </div>

          {isPastFormDate ? (
            <Alert tone="warning" title="Historical date">
              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={confirmHistorical}
                  onChange={(event) => setConfirmHistorical(event.target.checked)}
                  className="mt-0.5 h-3.5 w-3.5 rounded border-line-strong"
                />
                <span>
                  I understand this changes how past attendance and leave are classified. The change will be
                  audited.
                </span>
              </label>
            </Alert>
          ) : null}
        </div>
      </Modal>

      <ConfirmDialog
        open={deleteTarget !== null}
        title="Delete holiday"
        description={
          deleteTarget
            ? `Remove "${deleteTarget.name}" from ${formatDay(deleteTarget.holidayDate, {
                month: "long",
                day: "numeric",
                year: "numeric",
              })}?`
            : undefined
        }
        confirmLabel="Delete holiday"
        busy={deleting}
        error={deleteError}
        onConfirm={confirmDelete}
        onClose={() => setDeleteTarget(null)}
      >
        {isPastDeleteDate ? (
          <label className="flex items-start gap-2 text-xs text-ink-secondary">
            <input
              type="checkbox"
              checked={deleteHistorical}
              onChange={(event) => setDeleteHistorical(event.target.checked)}
              className="mt-0.5 h-3.5 w-3.5 rounded border-line-strong"
            />
            <span>Confirm the historical change. Past attendance and approved leave may be reclassified.</span>
          </label>
        ) : null}
      </ConfirmDialog>

      <ConfirmDialog
        open={publicationTarget !== null}
        tone="primary"
        title={publicationTarget?.published ? "Unpublish holiday" : "Publish holiday"}
        description={
          publicationTarget
            ? publicationTarget.published
              ? `"${publicationTarget.name}" will stay on the calendar as a draft and will no longer affect attendance or leave.`
              : `Publish "${publicationTarget.name}" so it applies to attendance and leave for the selected employees.`
            : undefined
        }
        confirmLabel={publicationTarget?.published ? "Unpublish holiday" : "Publish holiday"}
        busy={publishing}
        error={publicationError}
        onConfirm={confirmPublication}
        onClose={() => setPublicationTarget(null)}
      >
        {isPastPublicationDate ? (
          <label className="flex items-start gap-2 text-xs text-ink-secondary">
            <input
              type="checkbox"
              checked={publicationHistorical}
              onChange={(event) => setPublicationHistorical(event.target.checked)}
              className="mt-0.5 h-3.5 w-3.5 rounded border-line-strong"
            />
            <span>
              This holiday is in the past. Confirm so attendance and leave are not reclassified silently.
            </span>
          </label>
        ) : null}
      </ConfirmDialog>

      <Modal
        open={duplicateTarget !== null}
        onClose={() => setDuplicateTarget(null)}
        title="Duplicate holiday"
        description={
          duplicateTarget
            ? `Copy "${duplicateTarget.name}" to another date. Category, duration, and applicability are preserved.`
            : undefined
        }
        size="sm"
        dismissible={!duplicating}
        footer={
          <>
            <Button variant="secondary" onClick={() => setDuplicateTarget(null)} disabled={duplicating}>
              Cancel
            </Button>
            <Button onClick={confirmDuplicate} loading={duplicating}>
              Duplicate
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {duplicateError ? <Alert tone="danger">{duplicateError}</Alert> : null}
          <Field label="Holiday name" htmlFor="duplicate-name">
            <Input
              id="duplicate-name"
              value={duplicateName}
              maxLength={120}
              onChange={(event) => setDuplicateName(event.target.value)}
            />
          </Field>
          <Field label="New date" htmlFor="duplicate-date" required>
            <Input
              id="duplicate-date"
              type="date"
              value={duplicateDate}
              onChange={(event) => setDuplicateDate(event.target.value)}
            />
          </Field>
          {isPastDuplicateDate ? (
            <Alert tone="warning" title="Historical date">
              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={duplicateHistorical}
                  onChange={(event) => setDuplicateHistorical(event.target.checked)}
                  className="mt-0.5 h-3.5 w-3.5 rounded border-line-strong"
                />
                <span>Confirm the historical change. The duplicate will be audited.</span>
              </label>
            </Alert>
          ) : null}
        </div>
      </Modal>

      {importOpen ? (
        <GovernmentHolidayImport
          organizationId={organizationId}
          initialCountry={settings?.governmentCountry ?? "IN"}
          initialRegion={settings?.governmentRegion ?? "NATIONAL"}
          initialYear={settings?.governmentYear ?? year}
          onClose={() => setImportOpen(false)}
          onImported={() => calendar.reload()}
        />
      ) : null}
    </div>
  );
}

export function HolidaySettingsSummary({ settings }: { settings?: HolidaySettings }) {
  if (!settings) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
      <Badge tone={settings.enabled ? "success" : "warning"}>
        {settings.enabled ? "Holiday management enabled" : "Holiday management disabled"}
      </Badge>
      <span>Working days: {settings.workingDays.join(", ")}</span>
    </div>
  );
}
