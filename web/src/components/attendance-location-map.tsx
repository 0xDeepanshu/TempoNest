"use client";

import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  formatCoordinate,
  hasValidCoordinates,
  isValidLatitude,
  isValidLongitude,
} from "@/lib/attendance-location";
import { MAP_TILE_ATTRIBUTION, MAP_TILE_URL } from "@/lib/map-tiles";
import type { AttendanceLocation } from "@/lib/types";

export function AttendanceLocationMap({
  location,
  label,
}: {
  location: AttendanceLocation;
  label: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const valid = hasValidCoordinates(location);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !valid) return;

    const { latitude, longitude } = location;
    if (!isValidLatitude(latitude) || !isValidLongitude(longitude)) return;

    const map = L.map(container, {
      scrollWheelZoom: false,
      attributionControl: true,
    });
    L.tileLayer(MAP_TILE_URL, {
      attribution: MAP_TILE_ATTRIBUTION,
      maxZoom: 19,
    }).addTo(map);

    const point = L.latLng(latitude, longitude);
    const accuracyMeters =
      Number.isFinite(location.accuracyMeters) && location.accuracyMeters > 0
        ? location.accuracyMeters
        : 25;

    L.circle(point, {
      radius: accuracyMeters,
      color: "#404040",
      weight: 1.5,
      fillColor: "#71716e",
      fillOpacity: 0.15,
      interactive: false,
    }).addTo(map);

    L.circleMarker(point, {
      radius: 7,
      color: "#0a0a0a",
      weight: 2,
      fillColor: "#0a0a0a",
      fillOpacity: 1,
    })
      .addTo(map)
      .bindTooltip(
        `${formatCoordinate(latitude)}, ${formatCoordinate(longitude)}`,
        { direction: "top", offset: [0, -8] },
      );

    map.fitBounds(point.toBounds(Math.max(accuracyMeters * 2, 80)), {
      padding: [24, 24],
      maxZoom: 17,
    });

    return () => {
      map.remove();
    };
  }, [location, valid]);

  if (!valid) {
    return (
      <div className="rounded-lg border border-line bg-surface-muted px-4 py-3 text-xs text-muted">
        The recorded location does not contain valid latitude and longitude values, so no map can
        be shown.
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="h-72 w-full overflow-hidden rounded-lg border border-line bg-surface-muted"
      role="img"
      aria-label={`${label}. Base map tiles are provided by OpenStreetMap.`}
    />
  );
}
