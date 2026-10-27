"use client";

import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  hasValidCoordinates,
  latestLocationSample,
  locationHistoryGaps,
  locationMapSegments,
  orderLocationSamples,
  type LocationHistoryGap,
} from "@/lib/attendance-location";
import { formatDateTime } from "@/lib/format";
import { MAP_TILE_ATTRIBUTION, MAP_TILE_URL } from "@/lib/map-tiles";
import type {
  AttendanceLocation,
  AttendanceLocationSample,
  BreakSummary,
} from "@/lib/types";

function gapNote(gap: LocationHistoryGap): string {
  const minutes = Math.max(1, Math.round(gap.seconds / 60));
  return `${gap.kind === "break" ? "break" : "gap"} of ${minutes} min`;
}

/**
 * Plots recorded samples in time order. Consecutive points are connected only
 * when the gap between them is short; breaks and missing time remain visible
 * as separate runs instead of an invented path.
 */
export function AttendanceLocationHistoryMap({
  samples,
  checkInLocation,
  breaks = [],
  timezone,
  label,
}: {
  samples: AttendanceLocationSample[];
  checkInLocation: AttendanceLocation | null;
  breaks?: BreakSummary[];
  timezone: string;
  label: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const hasPoints =
    orderLocationSamples(samples).length > 0 || hasValidCoordinates(checkInLocation);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !hasPoints) return;

    const ordered = orderLocationSamples(samples);
    const map = L.map(container, {
      scrollWheelZoom: false,
      attributionControl: true,
    });
    L.tileLayer(MAP_TILE_URL, {
      attribution: MAP_TILE_ATTRIBUTION,
      maxZoom: 19,
    }).addTo(map);

    const points: Array<[number, number]> = [];
    const gapByFrom = new Map<string, LocationHistoryGap>();
    const gapByTo = new Map<string, LocationHistoryGap>();
    for (const gap of locationHistoryGaps(ordered, breaks)) {
      gapByFrom.set(gap.fromSampleId, gap);
      gapByTo.set(gap.toSampleId, gap);
    }

    for (const segment of locationMapSegments(ordered)) {
      if (segment.points.length < 2) continue;
      L.polyline(segment.points, {
        color: "#0a0a0a",
        weight: 2,
        opacity: 0.75,
        interactive: false,
      }).addTo(map);
    }

    ordered.forEach((item, index) => {
      const point = L.latLng(item.latitude, item.longitude);
      points.push([item.latitude, item.longitude]);

      const notes: string[] = [];
      const gapAfter = gapByFrom.get(item.id);
      const gapBefore = gapByTo.get(item.id);
      if (gapAfter) notes.push(`${gapNote(gapAfter)} after this point`);
      if (gapBefore) notes.push(`${gapNote(gapBefore)} before this point`);

      L.circleMarker(point, {
        radius: 4.5,
        color: "#0a0a0a",
        weight: 1.5,
        fillColor: "#ffffff",
        fillOpacity: 1,
      })
        .addTo(map)
        .bindTooltip(
          [
            `#${index + 1} · ${formatDateTime(item.capturedAt, timezone)} · ± ${item.accuracyMeters.toFixed(1)} m`,
            ...notes,
          ].join(" · "),
          { direction: "top", offset: [0, -6] },
        );
    });

    const latest = latestLocationSample(ordered);
    if (latest && latest.accuracyMeters > 0) {
      L.circle(L.latLng(latest.latitude, latest.longitude), {
        radius: latest.accuracyMeters,
        color: "#404040",
        weight: 1.5,
        fillColor: "#71716e",
        fillOpacity: 0.15,
        interactive: false,
      }).addTo(map);
    }

    if (hasValidCoordinates(checkInLocation)) {
      const checkInPoint = L.latLng(
        checkInLocation.latitude,
        checkInLocation.longitude,
      );
      points.push([checkInLocation.latitude, checkInLocation.longitude]);
      L.circleMarker(checkInPoint, {
        radius: 7,
        color: "#0a0a0a",
        weight: 2,
        fillColor: "#0a0a0a",
        fillOpacity: 1,
      })
        .addTo(map)
        .bindTooltip(
          `Check-in · ${formatDateTime(checkInLocation.recordedAt, timezone)}`,
          { direction: "top", offset: [0, -8] },
        );
    }

    map.fitBounds(points, {
      padding: [24, 24],
      maxZoom: 17,
    });

    return () => {
      map.remove();
    };
  }, [samples, checkInLocation, breaks, hasPoints, timezone]);

  if (!hasPoints) {
    return (
      <div className="rounded-lg border border-line bg-surface-muted px-4 py-3 text-xs text-muted">
        No valid location samples are available, so no map can be shown. No position is
        inferred.
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="h-64 w-full overflow-hidden rounded-lg border border-line bg-surface-muted sm:h-72"
      role="img"
      aria-label={`${label}. Base map tiles are provided by OpenStreetMap.`}
    />
  );
}
