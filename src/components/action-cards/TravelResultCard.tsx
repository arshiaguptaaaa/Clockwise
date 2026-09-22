import type { CardType } from "@prisma/client";
import { ClockwiseActionCard } from "./ClockwiseActionCard";
import { TripMapLoader } from "@/components/map/TripMapLoader";
import type { MapMarker, MapRoute } from "@/components/map/types";
import type { ActionCardData } from "@/lib/action-cards";

// Live agent search results, not persisted trip state — always
// `temporary: true` so TripMap renders them visually distinct from a
// trip's own destinations, and nothing here is ever written back to the
// Destination table.
function placesToMarkers(places: ActionCardData["places"], title: string): MapMarker[] {
  // The card doesn't carry a structured category, but the title is always
  // our own tools.ts text (never user input) — safe to key off it for an
  // icon hint rather than always falling back to the generic POI pin.
  const kind = title.startsWith("Hotels near") ? "hotel" : "poi";
  return (places ?? [])
    .filter((p): p is typeof p & { latitude: number; longitude: number } => p.latitude != null && p.longitude != null)
    .map((p, i) => ({
      id: `place-${i}`,
      kind,
      position: { lat: p.latitude, lng: p.longitude },
      label: p.name,
      sublabel: p.formattedAddress ?? undefined,
      temporary: true,
    }));
}

function routeToMapData(route: ActionCardData["route"]): { markers: MapMarker[]; routes: MapRoute[] } {
  if (!route?.from || !route?.to) return { markers: [], routes: [] };
  const markers: MapMarker[] = [
    { id: "route-from", kind: "transport", position: route.from, label: route.fromLabel, temporary: true },
    { id: "route-to", kind: "transport", position: route.to, label: route.toLabel, temporary: true },
  ];
  const routes: MapRoute[] = route.geometry?.length
    ? [
        {
          id: "route-geometry",
          points: route.geometry,
          mode: route.mode,
          distanceMeters: route.distanceMeters,
          durationSeconds: route.durationSeconds,
          provider: "geoapify",
        },
      ]
    : [];
  return { markers, routes };
}

function formatDistance(meters: number | null): string | null {
  if (meters == null) return null;
  return meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${Math.round(meters)} m`;
}

function formatDuration(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} hr` : `${hours} hr ${rest} min`;
}

// Always informational — real live-search results only, no PENDING/
// CONFIRMED action lifecycle, never gets primary/secondary buttons.
export function TravelResultCard({ cardType, data }: { cardType: CardType; data: ActionCardData }) {
  const sourceNote =
    data.provider && data.retrievedAt
      ? `${data.provider} · ${new Date(data.retrievedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`
      : undefined;

  if (cardType === "PLACES" && data.places) {
    const placeMarkers = placesToMarkers(data.places, data.title);
    return (
      <ClockwiseActionCard type="PLACES" title={data.title} context={data.context} status="CONFIRMED">
        <div className="mt-2.5 space-y-1.5">
          {data.places.length === 0 && (
            <p className="text-xs text-muted-foreground">No results found.</p>
          )}
          {data.places.map((p, i) => (
            <div key={i} className="rounded-lg border border-border px-2.5 py-2 text-xs">
              <p className="font-medium text-foreground">{p.name}</p>
              <p className="mt-0.5 text-muted-foreground">
                {formatDistance(p.distanceMeters) && `${formatDistance(p.distanceMeters)} away`}
                {formatDistance(p.distanceMeters) && p.formattedAddress && " · "}
                {p.formattedAddress}
              </p>
            </div>
          ))}
        </div>
        {placeMarkers.length > 0 && (
          <div className="mt-2.5">
            <TripMapLoader markers={placeMarkers} heightClassName="h-48" />
          </div>
        )}
        {sourceNote && <p className="mt-2 text-[11px] text-muted-foreground">{sourceNote}</p>}
      </ClockwiseActionCard>
    );
  }

  if (cardType === "ROUTE" && data.route) {
    const { markers: routeMarkers, routes } = routeToMapData(data.route);
    return (
      <ClockwiseActionCard
        type="ROUTE"
        title={data.title}
        context={`${data.route.fromLabel} → ${data.route.toLabel}`}
        status="CONFIRMED"
        values={[
          { label: "Distance", value: formatDistance(data.route.distanceMeters) ?? "unknown" },
          { label: data.route.mode === "walk" ? "Walking" : data.route.mode === "drive" ? "Driving" : "Transit", value: formatDuration(data.route.durationSeconds) },
        ]}
      >
        {routeMarkers.length > 0 && (
          <div className="mt-2.5">
            <TripMapLoader markers={routeMarkers} routes={routes} heightClassName="h-48" />
          </div>
        )}
        {sourceNote && <p className="mt-2 text-[11px] text-muted-foreground">{sourceNote}</p>}
      </ClockwiseActionCard>
    );
  }

  if (cardType === "WEATHER" && data.weather) {
    return (
      <ClockwiseActionCard
        type="WEATHER"
        title={data.title}
        context={data.context}
        status="CONFIRMED"
        values={[{ label: "Now", value: `${Math.round(data.weather.temperatureC)}°C` }]}
      >
        <div className="mt-2 flex gap-2 overflow-x-auto">
          {data.weather.forecast.map((d) => (
            <div key={d.date} className="shrink-0 rounded-lg border border-border px-2.5 py-1.5 text-center text-xs">
              <p className="text-muted-foreground">
                {new Date(d.date).toLocaleDateString("en-GB", { weekday: "short" })}
              </p>
              <p className="mt-0.5 font-medium text-foreground">
                {Math.round(d.maxC)}° / {Math.round(d.minC)}°
              </p>
            </div>
          ))}
        </div>
        {sourceNote && <p className="mt-2 text-[11px] text-muted-foreground">{sourceNote}</p>}
      </ClockwiseActionCard>
    );
  }

  // Fallback if the payload shape doesn't match cardType — should never
  // happen since only postTravelResultCard() constructs these.
  return <ClockwiseActionCard type={cardType} title={data.title} context={data.context} status="CONFIRMED" />;
}
