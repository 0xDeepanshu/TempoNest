import { describe, expect, it } from "vitest";
import {
  formatCoordinate,
  googleMapsUrl,
  hasValidCoordinates,
  isValidLatitude,
  isValidLongitude,
  latestLocationSample,
  locationHistoryGaps,
  locationHistoryMapPoints,
  locationHistoryTimeline,
  locationMapSegments,
  locationPermissionLabel,
  locationStatePresentation,
  orderLocationSamples,
} from "@/lib/attendance-location";
import type {
  AttendanceLocationHistory,
  AttendanceLocationSample,
  BreakSummary,
} from "@/lib/types";

function sample(
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

function brk(
  id: string,
  startedAt: string,
  endedAt: string | null,
): BreakSummary {
  return {
    id,
    organizationId: "org-1",
    sessionId: "session-time-1",
    startedAt,
    endedAt,
    status: endedAt ? "ENDED" : "ACTIVE",
    durationSeconds: 0,
    createdAt: startedAt,
    updatedAt: endedAt ?? startedAt,
  };
}

function history(
  overrides: Partial<AttendanceLocationHistory> = {},
): AttendanceLocationHistory {
  return {
    checkIn: {
      id: "check-in-1",
      employeeId: "employee-1",
      sessionId: "session-time-1",
      workMode: "ON_SITE",
      createdAt: "2026-10-24T08:00:00.000Z",
      location: {
        latitude: 12.9716,
        longitude: 77.5946,
        accuracyMeters: 32.5,
        recordedAt: "2026-10-24T08:00:00.000Z",
      },
    },
    employee: { id: "employee-1", name: "Ada Lovelace", email: "ada@example.com" },
    session: {
      id: "session-time-1",
      organizationId: "org-1",
      employeeId: "employee-1",
      desktopAgentId: "agent-1",
      startedAt: "2026-10-24T08:00:00.000Z",
      endedAt: "2026-10-24T12:00:00.000Z",
      status: "STOPPED",
      source: "OFFLINE",
      lastHeartbeatAt: "2026-10-24T11:59:00.000Z",
      durationSeconds: 14_400,
      heartbeatFresh: false,
      activeBreak: null,
      breaks: [],
      createdAt: "2026-10-24T08:00:00.000Z",
      updatedAt: "2026-10-24T12:00:00.000Z",
    },
    tracking: null,
    locationState: {
      state: "STOPPED",
      reason: "SESSION_ENDED",
      permission: "ALWAYS",
      backgroundAllowed: true,
      lastSampleAt: "2026-10-24T11:59:00.000Z",
      lastReportedAt: "2026-10-24T11:59:00.000Z",
      staleAfterSeconds: 180,
    },
    samples: [],
    totalSamples: 0,
    truncated: false,
    retention: { days: 30, cutoff: "2026-09-26T00:00:00.000Z" },
    ...overrides,
  };
}

describe("attendance location helpers", () => {
  it("accepts coordinate boundaries and rejects out-of-range or non-finite values", () => {
    expect(isValidLatitude(90)).toBe(true);
    expect(isValidLatitude(-90)).toBe(true);
    expect(isValidLatitude(90.0001)).toBe(false);
    expect(isValidLatitude(Number.NaN)).toBe(false);
    expect(isValidLatitude("12.9")).toBe(false);

    expect(isValidLongitude(180)).toBe(true);
    expect(isValidLongitude(-180)).toBe(true);
    expect(isValidLongitude(180.0001)).toBe(false);
    expect(isValidLongitude(Number.POSITIVE_INFINITY)).toBe(false);
  });

  it("requires both coordinates to be present and valid", () => {
    expect(
      hasValidCoordinates({
        latitude: 12.9716,
        longitude: 77.5946,
        accuracyMeters: 12,
        recordedAt: "2026-10-24T08:00:00.000Z",
      }),
    ).toBe(true);
    expect(hasValidCoordinates(null)).toBe(false);
    expect(hasValidCoordinates(undefined)).toBe(false);
    expect(
      hasValidCoordinates({
        latitude: Number.NaN,
        longitude: 77.5946,
        accuracyMeters: 12,
        recordedAt: "2026-10-24T08:00:00.000Z",
      }),
    ).toBe(false);
  });

  it("formats coordinates without rounding them to a different position", () => {
    expect(formatCoordinate(12.9715987)).toBe("12.971599");
    expect(formatCoordinate(-0.000001)).toBe("-0.000001");
  });

  it("builds a Google Maps link from the recorded coordinates only", () => {
    expect(googleMapsUrl(12.9716, 77.5946)).toBe(
      "https://www.google.com/maps/search/?api=1&query=12.9716,77.5946",
    );
  });
});

describe("location history helpers", () => {
  it("filters malformed samples and orders the rest chronologically", () => {
    const ordered = orderLocationSamples([
      sample("b", "2026-10-24T08:01:00.000Z"),
      sample("invalid", "2026-10-24T08:00:30.000Z", { latitude: 120 }),
      sample("invalid-time", "not-a-date"),
      sample("a", "2026-10-24T08:00:00.000Z"),
    ]);

    expect(ordered.map((item) => item.id)).toEqual(["a", "b"]);
    expect(latestLocationSample(ordered)?.id).toBe("b");
  });

  it("splits map lines at gaps instead of inventing a path", () => {
    const segments = locationMapSegments([
      sample("a", "2026-10-24T08:00:00.000Z"),
      sample("b", "2026-10-24T08:00:45.000Z"),
      sample("c", "2026-10-24T09:30:00.000Z"),
    ]);

    expect(segments).toHaveLength(2);
    expect(segments[0].points).toHaveLength(2);
    expect(segments[0].startedAt).toBe("2026-10-24T08:00:00.000Z");
    expect(segments[1].points).toEqual([[12.9716, 77.5946]]);
  });

  it("classifies gaps overlapping a break as break gaps", () => {
    const gaps = locationHistoryGaps(
      [
        sample("a", "2026-10-24T09:00:00.000Z"),
        sample("b", "2026-10-24T09:20:00.000Z"),
        sample("c", "2026-10-24T09:25:00.000Z"),
        sample("d", "2026-10-24T11:00:00.000Z"),
      ],
      [brk("break-1", "2026-10-24T09:00:10.000Z", "2026-10-24T09:15:00.000Z")],
    );

    expect(gaps).toHaveLength(2);
    expect(gaps[0]).toMatchObject({ kind: "break", seconds: 1200 });
    expect(gaps[1]).toMatchObject({ kind: "gap", seconds: 5700 });
  });

  it("builds an ordered timeline from check-in, breaks, checkout, and gaps", () => {
    const data = history({
      session: {
        ...history().session!,
        breaks: [brk("break-1", "2026-10-24T09:00:00.000Z", "2026-10-24T09:15:00.000Z")],
      },
      samples: [
        sample("a", "2026-10-24T08:00:00.000Z"),
        sample("b", "2026-10-24T09:20:00.000Z"),
        sample("c", "2026-10-24T09:21:00.000Z"),
      ],
    });

    const events = locationHistoryTimeline(data);

    expect(events.map((event) => event.kind)).toEqual([
      "CHECK_IN",
      "BREAK_START",
      "BREAK_END",
      "GAP",
      "CHECK_OUT",
    ]);
    expect(events[3].detail).toBe("No samples for 80 min while on break");
    expect(events[4].title).toBe("Checked out");
  });

  it("includes the check-in coordinate when framing the map", () => {
    const points = locationHistoryMapPoints(
      [sample("a", "2026-10-24T08:00:00.000Z")],
      {
        latitude: 12.98,
        longitude: 77.6,
        accuracyMeters: 10,
        recordedAt: "2026-10-24T08:00:00.000Z",
      },
    );

    expect(points).toEqual([
      [12.9716, 77.5946],
      [12.98, 77.6],
    ]);
  });

  it("describes tracking states without claiming the OS will obey", () => {
    expect(locationStatePresentation("ACTIVE", null).label).toBe("Tracking active");
    expect(locationStatePresentation("ACTIVE", null).detail).toMatch(/operating system/);
    expect(locationStatePresentation("PAUSED", "BREAK").label).toBe("Paused for break");
    expect(locationStatePresentation("STOPPED", "SESSION_ENDED").label).toBe(
      "Stopped at checkout",
    );
    expect(locationStatePresentation("STOPPED", "NOT_STARTED").label).toBe("Not started");
    expect(locationStatePresentation("PERMISSION_UNAVAILABLE", "PERMISSION_DENIED").tone).toBe(
      "warning",
    );
    expect(locationStatePresentation("STALE", null, 180).detail).toMatch(/180 seconds/);
  });

  it("labels background permission honestly", () => {
    expect(locationPermissionLabel("ALWAYS", true)).toBe("Background allowed");
    expect(locationPermissionLabel("ALWAYS", false)).toBe("While app is open");
    expect(locationPermissionLabel("FOREGROUND_ONLY", false)).toBe("Foreground only");
    expect(locationPermissionLabel("DENIED", false)).toBe("Permission denied");
    expect(locationPermissionLabel("UNKNOWN", false)).toBe("Permission unknown");
  });
});
