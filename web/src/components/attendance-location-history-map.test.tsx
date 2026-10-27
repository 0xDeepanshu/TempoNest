import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AttendanceLocationHistoryMap } from "@/components/attendance-location-history-map";
import type {
  AttendanceLocation,
  AttendanceLocationSample,
} from "@/lib/types";

const leaflet = vi.hoisted(() => {
  const fitBounds = vi.fn();
  const remove = vi.fn();
  const addTo = vi.fn();
  const bindTooltip = vi.fn();
  return {
    fitBounds,
    remove,
    addTo,
    bindTooltip,
    map: vi.fn(() => ({ fitBounds, remove })),
    tileLayer: vi.fn(() => ({ addTo })),
    polyline: vi.fn(() => ({ addTo })),
    circle: vi.fn(() => ({ addTo })),
    circleMarker: vi.fn(() => ({ addTo: () => ({ bindTooltip }) })),
    latLng: vi.fn((latitude: number, longitude: number) => ({
      latitude,
      longitude,
    })),
  };
});

vi.mock("leaflet", () => ({
  default: {
    map: leaflet.map,
    tileLayer: leaflet.tileLayer,
    polyline: leaflet.polyline,
    circle: leaflet.circle,
    circleMarker: leaflet.circleMarker,
    latLng: leaflet.latLng,
  },
}));

const checkInLocation: AttendanceLocation = {
  latitude: 12.9716,
  longitude: 77.5946,
  accuracyMeters: 32.5,
  recordedAt: "2026-10-24T08:00:00.000Z",
};

function sample(
  id: string,
  capturedAt: string,
  latitude: number,
  longitude: number,
  accuracyMeters = 18,
): AttendanceLocationSample {
  return {
    id,
    latitude,
    longitude,
    accuracyMeters,
    capturedAt,
    receivedAt: capturedAt,
    source: "DEVICE",
  };
}

const samples = [
  sample("a", "2026-10-24T08:00:00.000Z", 12.9716, 77.5946),
  sample("b", "2026-10-24T08:00:45.000Z", 12.972, 77.595),
  sample("c", "2026-10-24T08:30:00.000Z", 12.98, 77.6, 12),
];

describe("AttendanceLocationHistoryMap", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("plots ordered points, splits gaps, and marks the check-in", () => {
    const { unmount } = render(
      <AttendanceLocationHistoryMap
        samples={samples}
        checkInLocation={checkInLocation}
        timezone="UTC"
        label="History map"
      />,
    );

    expect(screen.getByRole("img", { name: /History map/ })).toBeInTheDocument();
    expect(leaflet.map).toHaveBeenCalledTimes(1);
    expect(leaflet.tileLayer).toHaveBeenCalledWith(
      "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
      expect.objectContaining({ maxZoom: 19 }),
    );

    // Only the contiguous run is connected; the isolated point is not bridged.
    expect(leaflet.polyline).toHaveBeenCalledTimes(1);
    expect(leaflet.polyline).toHaveBeenCalledWith(
      [
        [12.9716, 77.5946],
        [12.972, 77.595],
      ],
      expect.objectContaining({ color: "#0a0a0a" }),
    );

    // Three samples plus the check-in coordinate.
    expect(leaflet.circleMarker).toHaveBeenCalledTimes(4);
    expect(leaflet.bindTooltip).toHaveBeenCalledWith(
      expect.stringContaining("#1 ·"),
      expect.anything(),
    );
    expect(leaflet.bindTooltip).toHaveBeenCalledWith(
      expect.stringContaining("gap of 29 min after this point"),
      expect.anything(),
    );
    expect(leaflet.bindTooltip).toHaveBeenCalledWith(
      expect.stringContaining("gap of 29 min before this point"),
      expect.anything(),
    );
    expect(leaflet.bindTooltip).toHaveBeenCalledWith(
      expect.stringContaining("Check-in ·"),
      expect.anything(),
    );

    expect(leaflet.circle).toHaveBeenCalledWith(
      { latitude: 12.98, longitude: 77.6 },
      expect.objectContaining({ radius: 12 }),
    );
    expect(leaflet.fitBounds).toHaveBeenCalledWith(
      [
        [12.9716, 77.5946],
        [12.972, 77.595],
        [12.98, 77.6],
        [12.9716, 77.5946],
      ],
      { padding: [24, 24], maxZoom: 17 },
    );

    unmount();
    expect(leaflet.remove).toHaveBeenCalledTimes(1);
  });

  it("shows the check-in coordinate when no samples were recorded", () => {
    render(
      <AttendanceLocationHistoryMap
        samples={[]}
        checkInLocation={checkInLocation}
        timezone="UTC"
        label="History map"
      />,
    );

    expect(leaflet.polyline).not.toHaveBeenCalled();
    expect(leaflet.circleMarker).toHaveBeenCalledTimes(1);
    expect(leaflet.fitBounds).toHaveBeenCalledWith(
      [[12.9716, 77.5946]],
      { padding: [24, 24], maxZoom: 17 },
    );
  });

  it("shows an explicit warning instead of a map for invalid coordinates", () => {
    render(
      <AttendanceLocationHistoryMap
        samples={[sample("bad", "2026-10-24T08:00:00.000Z", Number.NaN, 77.5946)]}
        checkInLocation={null}
        timezone="UTC"
        label="History map"
      />,
    );

    expect(screen.getByText(/no map can be shown/i)).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(leaflet.map).not.toHaveBeenCalled();
  });
});
