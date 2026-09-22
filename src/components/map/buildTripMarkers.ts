import { formatDateRange } from "@/lib/format";
import type { MapMarker } from "./types";

type DestinationLike = {
  id: string;
  name: string;
  displayName: string | null;
  country: string | null;
  latitude: number | null;
  longitude: number | null;
  order: number;
  startDate: Date | null;
  endDate: Date | null;
};

// Converts a trip's own persisted Destination rows into map markers —
// the lowest `order` is the trip's origin, everything after is a
// destination. Rows without a stored coordinate (legacy trips predating
// Stage 3, or free-text fallbacks) are simply omitted here rather than
// geocoded again or given a fabricated position; callers should surface
// those separately as plain text so nothing is silently dropped.
export function buildDestinationMarkers(destinations: DestinationLike[]): MapMarker[] {
  const sorted = [...destinations].sort((a, b) => a.order - b.order);
  const originOrder = sorted[0]?.order;

  return sorted
    .filter((d): d is DestinationLike & { latitude: number; longitude: number } => d.latitude != null && d.longitude != null)
    .map((d) => ({
      id: d.id,
      kind: d.order === originOrder ? "origin" : "destination",
      position: { lat: d.latitude, lng: d.longitude },
      label: d.displayName ?? (d.country ? `${d.name}, ${d.country}` : d.name),
      sublabel: d.startDate && d.endDate ? formatDateRange(d.startDate, d.endDate, "short") : undefined,
    }));
}

// Destinations that were excluded from the map because they have no
// stored coordinate yet — surfaced as plain text, never plotted.
export function destinationsWithoutCoordinates(destinations: DestinationLike[]): DestinationLike[] {
  return destinations.filter((d) => d.latitude == null || d.longitude == null);
}
