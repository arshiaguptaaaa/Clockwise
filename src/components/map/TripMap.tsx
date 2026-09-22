"use client";

import "leaflet/dist/leaflet.css";
import { MapContainer, TileLayer, Marker, Popup, Polyline } from "react-leaflet";
import L, { type LatLngBoundsExpression } from "leaflet";
import { MapPin, PlaneTakeoff, Hotel, Utensils, Navigation } from "lucide-react";
import { renderToStaticMarkup } from "react-dom/server";
import type { MapMarker, MapMarkerKind, TripMapProps } from "./types";

const MARKER_COLOR: Record<MapMarkerKind, string> = {
  origin: "#163a2c",
  destination: "#1e4b3a",
  hotel: "#2563eb",
  poi: "#b45309",
  transport: "#7c3aed",
};

const MARKER_ICON: Record<MapMarkerKind, typeof MapPin> = {
  origin: PlaneTakeoff,
  destination: MapPin,
  hotel: Hotel,
  poi: Utensils,
  transport: Navigation,
};

const ROUTE_COLOR = "#1e4b3a";

function buildDivIcon(kind: MapMarkerKind, temporary: boolean): L.DivIcon {
  const Icon = MARKER_ICON[kind];
  const color = MARKER_COLOR[kind];
  const svg = renderToStaticMarkup(
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: 28,
        height: 28,
        borderRadius: "50%",
        background: color,
        opacity: temporary ? 0.75 : 1,
        border: "2px solid white",
        boxShadow: "0 1px 4px rgba(0,0,0,0.35)",
      }}
    >
      <Icon color="white" size={14} strokeWidth={2.5} />
    </div>
  );
  return L.divIcon({
    html: svg,
    className: "",
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    popupAnchor: [0, -14],
  });
}

function MarkerPopupContent({ marker }: { marker: MapMarker }) {
  return (
    <div className="min-w-[140px] max-w-[220px] px-0.5 py-0.5 text-sm">
      <p className="font-medium leading-snug text-foreground">{marker.label}</p>
      {marker.sublabel && <p className="mt-0.5 text-xs leading-snug text-muted-foreground">{marker.sublabel}</p>}
      {marker.temporary && <p className="mt-1 text-[10px] text-muted-foreground">Search result — not saved to trip</p>}
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 rounded-xl bg-surface-muted px-6 text-center">
      <MapPin className="size-5 text-muted-foreground" strokeWidth={1.75} />
      <p className="text-xs text-muted-foreground">{message}</p>
    </div>
  );
}

export default function TripMap({
  markers,
  routes = [],
  heightClassName = "h-64",
  emptyStateMessage = "No mapped locations for this trip yet.",
}: TripMapProps) {
  if (markers.length === 0) {
    return (
      <div className={`relative isolate w-full overflow-hidden rounded-xl ${heightClassName}`}>
        <EmptyState message={emptyStateMessage} />
      </div>
    );
  }

  const single = markers.length === 1;
  const bounds: LatLngBoundsExpression | undefined = single
    ? undefined
    : L.latLngBounds(markers.map((m) => [m.position.lat, m.position.lng]));

  return (
    <div className={`relative isolate w-full overflow-hidden rounded-xl border border-border ${heightClassName}`}>
      <MapContainer
        key={markers.map((m) => m.id).join(",")}
        center={single ? [markers[0].position.lat, markers[0].position.lng] : undefined}
        zoom={single ? 11 : undefined}
        bounds={bounds}
        boundsOptions={{ padding: [32, 32] }}
        scrollWheelZoom={false}
        style={{ height: "100%", width: "100%" }}
        attributionControl={true}
      >
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        />
        {routes.map((route) => (
          <Polyline
            key={route.id}
            positions={route.points.map((p) => [p.lat, p.lng])}
            pathOptions={{ color: ROUTE_COLOR, weight: 4, opacity: 0.85 }}
          />
        ))}
        {markers.map((marker) => (
          <Marker
            key={marker.id}
            position={[marker.position.lat, marker.position.lng]}
            icon={buildDivIcon(marker.kind, Boolean(marker.temporary))}
          >
            <Popup maxWidth={220}>
              <MarkerPopupContent marker={marker} />
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
}
