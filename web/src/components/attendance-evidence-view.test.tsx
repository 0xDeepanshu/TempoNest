import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AttendanceEvidenceView } from "@/components/attendance-evidence-view";
import { WorkspaceProvider } from "@/components/workspace";
import { apiRequest } from "@/lib/api-client";
import type {
  AttendanceCheckIn,
  AttendanceEvidence,
  AttendanceEvidenceKind,
  AttendanceLocation,
  AttendanceLocationHistory,
  AttendanceLocationSample,
  MemberListItem,
  Organization,
  SessionData,
} from "@/lib/types";

vi.mock("@/lib/api-client", () => ({
  apiRequest: vi.fn(),
}));

vi.mock("next/dynamic", () => ({
  default: () =>
    (props: {
      location?: AttendanceLocation;
      samples?: AttendanceLocationSample[];
      label: string;
    }) => (
      <div role="img" aria-label={props.label}>
        {props.location
          ? `${props.location.latitude},${props.location.longitude}`
          : `${props.samples?.length ?? 0} points`}
      </div>
    ),
}));

const mockedApiRequest = vi.mocked(apiRequest);

const organization: Organization = {
  id: "org-1",
  name: "TempoNest",
  slug: "temponest",
  status: "ACTIVE",
  timezone: "UTC",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const session: SessionData = {
  platformRole: null,
  user: {
    id: "admin-1",
    name: "Admin",
    email: "admin@example.com",
    status: "ACTIVE",
    lastLoginAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  memberships: [
    {
      id: "membership-1",
      organizationId: "org-1",
      userId: "admin-1",
      role: "ADMIN",
      status: "ACTIVE",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      organization,
    },
  ],
  session: {
    id: "session-1",
    transport: "cookie",
    accessExpiresAt: "2026-10-23T12:00:00.000Z",
    refreshExpiresAt: "2026-11-23T12:00:00.000Z",
  },
};

const member: MemberListItem = {
  id: "membership-2",
  organizationId: "org-1",
  userId: "employee-1",
  role: "EMPLOYEE",
  status: "ACTIVE",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  user: {
    id: "employee-1",
    name: "Ada Lovelace",
    email: "ada@example.com",
    status: "ACTIVE",
  },
};

const location: AttendanceLocation = {
  latitude: 12.9716,
  longitude: 77.5946,
  accuracyMeters: 32.5,
  recordedAt: "2026-10-24T08:00:00.000Z",
};

function evidence(kind: AttendanceEvidenceKind, id: string): AttendanceEvidence {
  return {
    id,
    organizationId: "org-1",
    employeeId: "employee-1",
    desktopAgentId: "agent-1",
    kind,
    status: "ATTACHED",
    contentType: "image/png",
    fileSizeBytes: 2048,
    capturedAt: "2026-10-24T08:00:00.000Z",
    uploadedAt: "2026-10-24T08:00:05.000Z",
    expiresAt: "2099-01-01T00:00:00.000Z",
    attachedSessionId: "session-time-1",
    createdAt: "2026-10-24T08:00:00.000Z",
    updatedAt: "2026-10-24T08:00:05.000Z",
  };
}

function checkIn(
  id: string,
  overrides: Partial<AttendanceCheckIn> = {},
): AttendanceCheckIn {
  return {
    id,
    organizationId: "org-1",
    employeeId: "employee-1",
    desktopAgentId: "agent-1",
    sessionId: "session-time-1",
    workMode: "ON_SITE",
    checkInRequestId: `request-${id}`,
    location: null,
    selfie: null,
    sitePhoto: null,
    employee: { id: "employee-1", name: "Ada Lovelace", email: "ada@example.com" },
    session: {
      id: "session-time-1",
      organizationId: "org-1",
      employeeId: "employee-1",
      desktopAgentId: "agent-1",
      startedAt: "2026-10-24T08:00:00.000Z",
      endedAt: null,
      status: "ACTIVE",
      source: "OFFLINE",
      lastHeartbeatAt: "2026-10-24T11:59:00.000Z",
      durationSeconds: 14_340,
      heartbeatFresh: true,
      activeBreak: null,
      breaks: [],
      createdAt: "2026-10-24T08:00:00.000Z",
      updatedAt: "2026-10-24T11:59:00.000Z",
    },
    createdAt: "2026-10-24T08:00:00.000Z",
    updatedAt: "2026-10-24T08:00:05.000Z",
    ...overrides,
  };
}

function locationSample(
  id: string,
  capturedAt: string,
  overrides: Partial<AttendanceLocationSample> = {},
): AttendanceLocationSample {
  return {
    id,
    latitude: 12.9716,
    longitude: 77.5946,
    accuracyMeters: 18,
    capturedAt,
    receivedAt: capturedAt,
    source: "DEVICE",
    ...overrides,
  };
}

function locationHistory(
  checkInId: string,
  overrides: Partial<AttendanceLocationHistory> = {},
): AttendanceLocationHistory {
  return {
    checkIn: {
      id: checkInId,
      employeeId: "employee-1",
      sessionId: "session-time-1",
      workMode: "ON_SITE",
      createdAt: "2026-10-24T08:00:00.000Z",
      location,
    },
    employee: { id: "employee-1", name: "Ada Lovelace", email: "ada@example.com" },
    session: checkIn("history-template").session!,
    tracking: {
      status: "ACTIVE",
      reason: null,
      permission: "ALWAYS",
      backgroundAllowed: true,
      lastSampleAt: "2026-10-24T08:01:30.000Z",
      lastReportedAt: "2026-10-24T08:01:30.000Z",
      updatedAt: "2026-10-24T08:01:30.000Z",
    },
    locationState: {
      state: "ACTIVE",
      reason: null,
      permission: "ALWAYS",
      backgroundAllowed: true,
      lastSampleAt: "2026-10-24T08:01:30.000Z",
      lastReportedAt: "2026-10-24T08:01:30.000Z",
      staleAfterSeconds: 180,
    },
    samples: [
      locationSample("sample-1", "2026-10-24T08:00:00.000Z"),
      locationSample("sample-2", "2026-10-24T08:00:45.000Z"),
      locationSample("sample-3", "2026-10-24T08:01:30.000Z"),
    ],
    totalSamples: 3,
    truncated: false,
    retention: { days: 30, cutoff: "2026-09-26T00:00:00.000Z" },
    ...overrides,
  };
}

function page<T>(rows: T[], limit = 20) {
  return {
    data: rows,
    meta: { page: 1, limit, total: rows.length, totalPages: 1 },
    serverTime: "2026-10-24T12:00:00.000Z",
  };
}

interface ApiOptions {
  rows?: AttendanceCheckIn[];
  failCheckIns?: boolean;
  failSelfieAccessTimes?: number;
  evidenceUrlBase?: string;
  evidenceExpiresAt?: string;
  history?: AttendanceLocationHistory;
  failHistory?: boolean;
}

function mockApi(options: ApiOptions = {}) {
  let selfieFailures = options.failSelfieAccessTimes ?? 0;
  mockedApiRequest.mockImplementation(async (path) => {
    if (path.endsWith("/members")) {
      return page([member], 100);
    }
    if (path.endsWith("/attendance/check-ins")) {
      if (options.failCheckIns) throw new Error("Check-ins are unavailable.");
      return { ...page(options.rows ?? []), timezone: "UTC" };
    }
    const history = /\/attendance\/check-ins\/([^/]+)\/location-history$/.exec(path);
    if (history) {
      if (options.failHistory) throw new Error("Location history is unavailable.");
      return {
        data: options.history ?? locationHistory(history[1]),
        serverTime: "2026-10-24T12:00:00.000Z",
      };
    }
    const access = /\/attendance\/evidence\/([^/]+)\/access$/.exec(path);
    if (access) {
      if (access[1] === "ev-selfie" && selfieFailures > 0) {
        selfieFailures -= 1;
        throw new Error("Evidence access was denied.");
      }
      return {
        data: {
          evidence: evidence("SELFIE", access[1]),
          url: `${options.evidenceUrlBase ?? ""}/api/v1/attendance-files/${access[1]}`,
          expiresAt: options.evidenceExpiresAt ?? "2099-01-01T00:00:00.000Z",
        },
        serverTime: "2026-10-24T12:00:00.000Z",
      };
    }
    throw new Error(`Unexpected request: ${path}`);
  });
}

function renderView(activeSession: SessionData = session) {
  return render(
    <WorkspaceProvider session={activeSession}>
      <AttendanceEvidenceView />
    </WorkspaceProvider>,
  );
}

async function openDetails(buttonIndex = 0) {
  const user = userEvent.setup();
  const buttons = await screen.findAllByRole("button", {
    name: /View attendance details for/,
  });
  await user.click(buttons[buttonIndex]);
  return screen.findByRole("dialog");
}

describe("AttendanceEvidenceView", () => {
  beforeEach(() => {
    mockedApiRequest.mockReset();
  });

  it("shows evidence and location policy states for each work mode", async () => {
    mockApi({
      rows: [
        checkIn("on-site", {
          location,
          selfie: evidence("SELFIE", "ev-selfie"),
          sitePhoto: evidence("SITE_PHOTO", "ev-site"),
        }),
        checkIn("wfo", {
          workMode: "WFO",
          selfie: evidence("SELFIE", "ev-wfo-selfie"),
        }),
        checkIn("wfh", { workMode: "WFH" }),
      ],
    });
    renderView();

    const rows = await screen.findAllByRole("listitem");
    expect(rows).toHaveLength(3);

    const onSite = within(rows[0]);
    expect(onSite.getByText("On site")).toBeInTheDocument();
    expect(onSite.getByText("Working")).toBeInTheDocument();
    expect(onSite.getByText("Selfie available")).toBeInTheDocument();
    expect(onSite.getByText("Site photo available")).toBeInTheDocument();
    expect(onSite.getByText("Recorded ±32.5 m")).toBeInTheDocument();

    const wfo = within(rows[1]);
    expect(wfo.getByText("WFO")).toBeInTheDocument();
    expect(wfo.getByText("Selfie available")).toBeInTheDocument();
    expect(wfo.getByText("Site photo not required")).toBeInTheDocument();
    expect(wfo.getByText("Not collected")).toBeInTheDocument();

    const wfh = within(rows[2]);
    expect(wfh.getByText("WFH")).toBeInTheDocument();
    expect(wfh.getByText("Selfie not required")).toBeInTheDocument();
    expect(wfh.getByText("Site photo not required")).toBeInTheDocument();
    expect(wfh.getByText("Not collected")).toBeInTheDocument();
  });

  it("keeps the compact grid and drawer usable in dark mode", async () => {
    document.documentElement.classList.add("dark");
    try {
      mockApi({ rows: [checkIn("wfh", { workMode: "WFH" })] });
      renderView();

      const row = (await screen.findAllByRole("listitem"))[0];
      expect(screen.getByText("Evidence")).toBeInTheDocument();
      expect(row.className).toContain("xl:grid-cols-[minmax(0,1.5fr)");
      expect(row.className).toContain("xl:min-h-14");

      const action = within(row).getByText("View details").closest("div");
      expect(action?.className).toContain("col-start-2 row-start-1");

      await openDetails();
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    } finally {
      document.documentElement.classList.remove("dark");
    }
  });

  it("loads selfie and site photos separately and shows the captured location", async () => {
    mockApi({
      rows: [
        checkIn("on-site", {
          location,
          selfie: evidence("SELFIE", "ev-selfie"),
          sitePhoto: evidence("SITE_PHOTO", "ev-site"),
        }),
      ],
    });
    renderView();

    await openDetails();

    const selfie = await screen.findByAltText("Selfie recorded for Ada Lovelace");
    expect(selfie).toHaveAttribute("src", "/api/v1/attendance-files/ev-selfie");
    const sitePhoto = await screen.findByAltText("Site photo recorded for Ada Lovelace");
    expect(sitePhoto).toHaveAttribute("src", "/api/v1/attendance-files/ev-site");

    expect(mockedApiRequest).toHaveBeenCalledWith(
      "/organizations/org-1/attendance/evidence/ev-selfie/access",
      expect.objectContaining({ method: "POST" }),
    );
    expect(mockedApiRequest).toHaveBeenCalledWith(
      "/organizations/org-1/attendance/evidence/ev-site/access",
      expect.objectContaining({ method: "POST" }),
    );

    expect(screen.getByText("12.971600")).toBeInTheDocument();
    expect(screen.getByText("77.594600")).toBeInTheDocument();
    expect(screen.getByText("± 32.5 meters")).toBeInTheDocument();
    expect(
      screen.getByRole("img", {
        name: "Map of the coordinates recorded for Ada Lovelace's ON_SITE check-in",
      }),
    ).toBeInTheDocument();

    const mapsLink = screen.getByRole("link", { name: /Open in Google Maps/ });
    expect(mapsLink).toHaveAttribute(
      "href",
      "https://www.google.com/maps/search/?api=1&query=12.9716,77.5946",
    );
    expect(mapsLink).toHaveAttribute("target", "_blank");
    expect(
      screen.getByText(/does not by itself prove that the employee was physically present/i),
    ).toBeInTheDocument();
  });

  it("shows a warning instead of a map when an ON_SITE check-in has no location", async () => {
    mockApi({
      rows: [
        checkIn("missing-location", {
          selfie: evidence("SELFIE", "ev-selfie"),
          sitePhoto: evidence("SITE_PHOTO", "ev-site"),
        }),
      ],
    });
    renderView();

    await openDetails();

    expect(screen.getByText("No location recorded")).toBeInTheDocument();
    expect(screen.getByText(/no location is inferred/i)).toBeInTheDocument();
    expect(
      screen.queryByRole("img", { name: /Map of the coordinates/ }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Open in Google Maps/ })).not.toBeInTheDocument();
  });

  it("fetches only the selfie and explains that WFO collects no location", async () => {
    mockApi({
      rows: [
        checkIn("wfo", {
          workMode: "WFO",
          selfie: evidence("SELFIE", "ev-selfie"),
        }),
      ],
    });
    renderView();

    await openDetails();
    await screen.findByAltText("Selfie recorded for Ada Lovelace");

    expect(
      screen.getByText("This check-in does not include a site photo."),
    ).toBeInTheDocument();
    expect(screen.queryByAltText("Site photo recorded for Ada Lovelace")).not.toBeInTheDocument();
    expect(mockedApiRequest).not.toHaveBeenCalledWith(
      "/organizations/org-1/attendance/evidence/ev-site/access",
      expect.anything(),
    );
    expect(screen.getByText("Location not collected")).toBeInTheDocument();
    expect(screen.getByText(/WFO check-ins record selfie evidence only/i)).toBeInTheDocument();
    expect(
      screen.queryByRole("img", { name: /Map of the coordinates/ }),
    ).not.toBeInTheDocument();
    expect(mockedApiRequest).not.toHaveBeenCalledWith(
      expect.stringMatching(/location-history$/),
      expect.anything(),
    );
  });

  it("shows an ON_SITE selfie and location without requesting a site photo", async () => {
    mockApi({
      rows: [
        checkIn("on-site-no-site", {
          location,
          selfie: evidence("SELFIE", "ev-selfie"),
        }),
      ],
    });
    renderView();

    const row = within((await screen.findAllByRole("listitem"))[0]);
    expect(row.getByText("Selfie available")).toBeInTheDocument();
    expect(row.getByText("Site photo not required")).toBeInTheDocument();
    expect(row.getByText("Recorded ±32.5 m")).toBeInTheDocument();

    await openDetails();
    await screen.findByAltText("Selfie recorded for Ada Lovelace");

    expect(
      screen.getByText("This check-in does not include a site photo."),
    ).toBeInTheDocument();
    expect(
      screen.queryByAltText("Site photo recorded for Ada Lovelace"),
    ).not.toBeInTheDocument();
    expect(mockedApiRequest).not.toHaveBeenCalledWith(
      "/organizations/org-1/attendance/evidence/ev-site/access",
      expect.anything(),
    );
    expect(
      screen.getByRole("img", { name: /Map of the coordinates/ }),
    ).toBeInTheDocument();
  });

  it("loads LAN evidence through the same-origin API proxy", async () => {
    mockApi({
      evidenceUrlBase: "http://192.168.29.165:4000",
      rows: [
        checkIn("lan", {
          location,
          selfie: evidence("SELFIE", "ev-selfie"),
        }),
      ],
    });
    renderView();

    await openDetails();
    const selfie = await screen.findByAltText("Selfie recorded for Ada Lovelace");
    expect(selfie).toHaveAttribute("src", "/api/v1/attendance-files/ev-selfie");
  });

  it("asks for a fresh link when the private URL expires", async () => {
    mockApi({
      evidenceExpiresAt: "2020-01-01T00:00:00.000Z",
      rows: [
        checkIn("expired", {
          location,
          selfie: evidence("SELFIE", "ev-selfie"),
        }),
      ],
    });
    renderView();

    await openDetails();
    expect(
      await screen.findByText(/The private photo link expired/i),
    ).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Load photo again" }));

    await waitFor(() => {
      const calls = mockedApiRequest.mock.calls.filter(
        ([path]) =>
          path === "/organizations/org-1/attendance/evidence/ev-selfie/access",
      );
      expect(calls).toHaveLength(2);
    });
  });

  it("surfaces an evidence access error and retries with a fresh link", async () => {
    mockApi({
      failSelfieAccessTimes: 1,
      rows: [
        checkIn("on-site", {
          location,
          selfie: evidence("SELFIE", "ev-selfie"),
          sitePhoto: evidence("SITE_PHOTO", "ev-site"),
        }),
      ],
    });
    renderView();

    await openDetails();
    expect(await screen.findByText("Evidence access was denied.")).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Load photo again" }));

    const selfie = await screen.findByAltText("Selfie recorded for Ada Lovelace");
    expect(selfie).toHaveAttribute("src", "/api/v1/attendance-files/ev-selfie");

    const selfieCalls = mockedApiRequest.mock.calls.filter(
      ([path]) => path === "/organizations/org-1/attendance/evidence/ev-selfie/access",
    );
    expect(selfieCalls).toHaveLength(2);
  });

  it("shows an empty state when no check-ins match", async () => {
    mockApi({ rows: [] });
    renderView();

    expect(await screen.findByText("No attendance check-ins found")).toBeInTheDocument();
  });

  it("shows an error state when the check-in list fails", async () => {
    mockApi({ failCheckIns: true });
    renderView();

    expect(await screen.findByText("Check-ins are unavailable.")).toBeInTheDocument();
  });

  it("rejects an invalid date range without querying the API", async () => {
    mockApi({ rows: [] });
    renderView();
    await screen.findByText("No attendance check-ins found");

    const callsBefore = mockedApiRequest.mock.calls.filter(([path]) =>
      path.endsWith("/attendance/check-ins"),
    ).length;

    fireEvent.change(screen.getByLabelText("From"), {
      target: { value: "2099-01-01" },
    });

    expect(await screen.findByText("Invalid date range")).toBeInTheDocument();
    const callsAfter = mockedApiRequest.mock.calls.filter(([path]) =>
      path.endsWith("/attendance/check-ins"),
    ).length;
    expect(callsAfter).toBe(callsBefore);
  });

  it("sends the selected employee filter with the check-in request", async () => {
    mockApi({ rows: [] });
    renderView();

    const user = userEvent.setup();
    await screen.findByText("No attendance check-ins found");
    await user.click(screen.getByLabelText("Employee"));
    await user.click(await screen.findByRole("option", { name: /Ada Lovelace/ }));

    await waitFor(() => {
      expect(mockedApiRequest).toHaveBeenCalledWith(
        "/organizations/org-1/attendance/check-ins",
        expect.objectContaining({
          query: expect.objectContaining({ employeeId: "employee-1", page: 1 }),
        }),
      );
    });
  });

  it("keeps a single refresh control and applies filters immediately", async () => {
    mockApi({ rows: [] });
    renderView();

    await screen.findByText("No attendance check-ins found");
    expect(screen.getAllByRole("button", { name: "Refresh" })).toHaveLength(1);

    fireEvent.change(screen.getByLabelText("Work mode"), {
      target: { value: "WFH" },
    });

    await waitFor(() => {
      expect(mockedApiRequest).toHaveBeenCalledWith(
        "/organizations/org-1/attendance/check-ins",
        expect.objectContaining({
          query: expect.objectContaining({ workMode: "WFH", page: 1 }),
        }),
      );
    });
  });

  it("does not request private evidence until the details drawer is opened", async () => {
    mockApi({
      rows: [
        checkIn("on-site", {
          location,
          selfie: evidence("SELFIE", "ev-selfie"),
          sitePhoto: evidence("SITE_PHOTO", "ev-site"),
        }),
      ],
    });
    renderView();

    await screen.findByText("Selfie available");
    expect(
      mockedApiRequest.mock.calls.filter(([path]) => String(path).includes("/evidence/")),
    ).toHaveLength(0);

    await openDetails();

    expect(
      await screen.findByAltText("Selfie recorded for Ada Lovelace"),
    ).toBeInTheDocument();
    const accessCalls = mockedApiRequest.mock.calls.filter(([path]) =>
      String(path).includes("/evidence/"),
    );
    expect(accessCalls).toHaveLength(2);
  });

  it("uses a summary-first drawer with focus management and Escape close", async () => {
    mockApi({
      rows: [
        checkIn("with-breaks", {
          location,
          selfie: evidence("SELFIE", "ev-selfie"),
          session: {
            ...checkIn("template").session!,
            durationSeconds: 10_800,
            breaks: [
              {
                id: "break-1",
                organizationId: "org-1",
                sessionId: "session-time-1",
                startedAt: "2026-10-24T09:00:00.000Z",
                endedAt: "2026-10-24T09:15:00.000Z",
                status: "ENDED",
                durationSeconds: 900,
                createdAt: "2026-10-24T09:00:00.000Z",
                updatedAt: "2026-10-24T09:15:00.000Z",
              },
            ],
          },
        }),
      ],
    });
    renderView();

    const user = userEvent.setup();
    const trigger = await screen.findByRole("button", {
      name: /View attendance details for Ada Lovelace/,
    });
    await user.click(trigger);

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(
      within(dialog).getByRole("heading", { name: "Attendance summary" }),
    ).toBeInTheDocument();
    expect(within(dialog).getByText("Break detail")).toBeInTheDocument();
    expect(within(dialog).getByText(/Break 1 ·/)).toBeInTheDocument();

    const closeButton = screen.getByRole("button", {
      name: "Close attendance details",
    });
    expect(closeButton).toHaveFocus();

    const historyRefresh = within(dialog).getByRole("button", { name: "Refresh" });
    historyRefresh.focus();
    await user.keyboard("{Tab}");
    expect(closeButton).toHaveFocus();
    await user.keyboard("{Shift>}{Tab}{/Shift}");
    expect(historyRefresh).toHaveFocus();

    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(trigger).toHaveFocus();
  });

  it("renders the location history, gaps, and session markers for authorized admins", async () => {
    const stoppedSession = {
      ...checkIn("history-template").session!,
      endedAt: "2026-10-24T12:00:00.000Z",
      status: "STOPPED" as const,
      durationSeconds: 14_400,
      breaks: [
        {
          id: "break-1",
          organizationId: "org-1",
          sessionId: "session-time-1",
          startedAt: "2026-10-24T09:00:00.000Z",
          endedAt: "2026-10-24T09:15:00.000Z",
          status: "ENDED" as const,
          durationSeconds: 900,
          createdAt: "2026-10-24T09:00:00.000Z",
          updatedAt: "2026-10-24T09:15:00.000Z",
        },
      ],
    };

    mockApi({
      rows: [checkIn("on-site", { location })],
      history: locationHistory("on-site", {
        session: stoppedSession,
        tracking: {
          status: "STOPPED",
          reason: "SESSION_ENDED",
          permission: "ALWAYS",
          backgroundAllowed: true,
          lastSampleAt: "2026-10-24T09:21:00.000Z",
          lastReportedAt: "2026-10-24T12:00:00.000Z",
          updatedAt: "2026-10-24T12:00:00.000Z",
        },
        locationState: {
          state: "STOPPED",
          reason: "SESSION_ENDED",
          permission: "ALWAYS",
          backgroundAllowed: true,
          lastSampleAt: "2026-10-24T09:21:00.000Z",
          lastReportedAt: "2026-10-24T12:00:00.000Z",
          staleAfterSeconds: 180,
        },
        samples: [
          locationSample("sample-1", "2026-10-24T08:00:00.000Z"),
          locationSample("sample-2", "2026-10-24T08:00:45.000Z"),
          locationSample("sample-3", "2026-10-24T09:20:00.000Z"),
          locationSample("sample-4", "2026-10-24T09:21:00.000Z", {
            accuracyMeters: 9.5,
          }),
        ],
        totalSamples: 4,
      }),
    });
    renderView();

    const dialog = await openDetails();
    expect(
      await within(dialog).findByText("Stopped at checkout"),
    ).toBeInTheDocument();
    expect(within(dialog).getByText("Background allowed")).toBeInTheDocument();
    expect(within(dialog).getByText("4 samples")).toBeInTheDocument();
    expect(within(dialog).getAllByText("± 9.5 m").length).toBeGreaterThan(0);
    expect(within(dialog).getByText("On-site check-in")).toBeInTheDocument();
    expect(within(dialog).getByText("Break 1 started")).toBeInTheDocument();
    expect(within(dialog).getByText("Break 1 ended")).toBeInTheDocument();
    expect(within(dialog).getByText("Break gap")).toBeInTheDocument();
    expect(within(dialog).getByText("Checked out")).toBeInTheDocument();
    expect(within(dialog).getByText(/Location tracking stopped/)).toBeInTheDocument();
    expect(
      within(dialog).getByRole("img", {
        name: /Map of recorded location points/,
      }),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText(/deleted automatically after 30 days/i),
    ).toBeInTheDocument();
    expect(mockedApiRequest).toHaveBeenCalledWith(
      "/organizations/org-1/attendance/check-ins/on-site/location-history",
      expect.objectContaining({ signal: expect.anything() }),
    );
  });

  it("explains missing location history without inventing a position", async () => {
    mockApi({
      rows: [checkIn("on-site", { location })],
      history: locationHistory("on-site", {
        samples: [],
        totalSamples: 0,
        tracking: null,
        locationState: {
          state: "PERMISSION_UNAVAILABLE",
          reason: "PERMISSION_DENIED",
          permission: "DENIED",
          backgroundAllowed: false,
          lastSampleAt: null,
          lastReportedAt: "2026-10-24T08:00:30.000Z",
          staleAfterSeconds: 180,
        },
      }),
    });
    renderView();

    const dialog = await openDetails();
    expect(
      await within(dialog).findByText("No location samples recorded"),
    ).toBeInTheDocument();
    expect(within(dialog).getByText("Permission unavailable")).toBeInTheDocument();
    expect(within(dialog).getByText("Permission denied")).toBeInTheDocument();
    expect(
      within(dialog).getByText(/could not record samples for this session/i),
    ).toBeInTheDocument();
    // Only the check-in coordinate remains; no sample positions are invented.
    const map = within(dialog).getByRole("img", {
      name: /Map of recorded location points/,
    });
    expect(map).toHaveTextContent("0 points");
  });

  it("surfaces a location history error and retries", async () => {
    mockApi({ rows: [checkIn("on-site", { location })], failHistory: true });
    renderView();

    const dialog = await openDetails();
    expect(
      await within(dialog).findByText("Location history is unavailable."),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: "Retry" }),
    ).toBeInTheDocument();
  });

  it("does not request or render location history for managers", async () => {
    mockApi({ rows: [checkIn("on-site", { location })] });
    renderView({
      ...session,
      memberships: [{ ...session.memberships[0], role: "MANAGER" }],
    });

    const dialog = await openDetails();
    expect(await within(dialog).findByText("Captured location")).toBeInTheDocument();
    expect(within(dialog).queryByText("Location history")).not.toBeInTheDocument();
    expect(mockedApiRequest).not.toHaveBeenCalledWith(
      expect.stringMatching(/location-history$/),
      expect.anything(),
    );
  });
});
