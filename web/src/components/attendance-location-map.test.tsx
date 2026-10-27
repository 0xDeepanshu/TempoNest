import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AttendanceLocationMap } from "@/components/attendance-location-map";
import type { AttendanceLocation } from "@/lib/types";

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
    circle: vi.fn(() => ({ addTo })),
    circleMarker: vi.fn(() => ({ addTo: () => ({ bindTooltip }) })),
    latLng: vi.fn(() => ({ toBounds: (radius: number) => ({ radius }) })),
  };
});

vi.mock("leaflet", () => ({
  default: {
    map: leaflet.map,
    tileLayer: leaflet.tileLayer,
    circle: leaflet.circle,
    circleMarker: leaflet.circleMarker,
    latLng: leaflet.latLng,
  },
}));

const location: AttendanceLocation = {
  latitude: 12.9716,
  longitude: 77.5946,
  accuracyMeters: 32.5,
  recordedAt: "2026-10-24T08:00:00.000Z",
};

describe("AttendanceLocationMap", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("plots the recorded coordinates and accuracy on OpenStreetMap tiles", () => {
    const { unmount } = render(
      <AttendanceLocationMap location={location} label="Check-in map" />,
    );

    expect(screen.getByRole("img", { name: /Check-in map/ })).toBeInTheDocument();
    expect(leaflet.map).toHaveBeenCalledTimes(1);
    expect(leaflet.tileLayer).toHaveBeenCalledWith(
      "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
      expect.objectContaining({ maxZoom: 19 }),
    );
    expect(leaflet.latLng).toHaveBeenCalledWith(12.9716, 77.5946);
    expect(leaflet.circle).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ radius: 32.5 }),
    );
    expect(leaflet.circleMarker).toHaveBeenCalledTimes(1);
    expect(leaflet.bindTooltip).toHaveBeenCalledWith("12.971600, 77.594600", expect.anything());
    expect(leaflet.fitBounds).toHaveBeenCalledWith({ radius: 80 }, {
      padding: [24, 24],
      maxZoom: 17,
    });

    unmount();
    expect(leaflet.remove).toHaveBeenCalledTimes(1);
  });

  it("shows an explicit warning instead of a map for invalid coordinates", () => {
    render(
      <AttendanceLocationMap
        location={{ ...location, latitude: Number.NaN }}
        label="Check-in map"
      />,
    );

    expect(
      screen.getByText(/no map can be shown/i),
    ).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(leaflet.map).not.toHaveBeenCalled();
  });
});
