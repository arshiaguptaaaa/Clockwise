// The one marker/route shape every map consumer uses — persisted trip
// destinations, temporary agent search results, and (later) hotels/POIs/
// transport rendezvous all reduce to this before reaching TripMap. Never
// invent a second shape per feature (Stage 3/4 architecture decision).
export type MapMarkerKind = "origin" | "destination" | "hotel" | "poi" | "transport";

export type MapMarker = {
  id: string;
  kind: MapMarkerKind;
  position: { lat: number; lng: number };
  label: string; // human-readable name, e.g. "Vienna, Austria"
  sublabel?: string; // e.g. dates, "320 m away", a category
  // True for markers from a live agent search (hotels/nearby/route
  // endpoints) that aren't part of the trip's own persisted destinations —
  // rendered but never written back to the trip.
  temporary?: boolean;
};

export type MapRoute = {
  id: string;
  points: { lat: number; lng: number }[]; // real provider geometry, ordered start→end
  mode: string;
  distanceMeters: number;
  durationSeconds: number;
  provider: string;
};

export type TripMapProps = {
  markers: MapMarker[];
  routes?: MapRoute[];
  heightClassName?: string; // e.g. "h-64" — lets each consumer size the map
  emptyStateMessage?: string;
};
