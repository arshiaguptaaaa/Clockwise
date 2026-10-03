// READY? — a traveller-specific preparation layer, DERIVED from state on every
// read: confirmed journey, confirmed stay, provider-measured arrival route, the
// Open-Meteo forecast for the trip's dates, and general packing. Items carry a
// kind so nothing "likely" is presented as "confirmed":
//   CONFIRMED  = we hold the fact (a confirmed journey, a confirmed stay, a route)
//   LIKELY     = probably needed given real data (a forecast), says which data
//   OPTIONAL   = general suggestions
// No legal / immigration / document rule is asserted: ID and document items only
// tell the traveller to check what their carrier requires.
import { prisma } from "@/lib/prisma";
import { getWeather } from "@/lib/travel/open-meteo-weather";
import { tripAnchors } from "@/lib/travel/resolve";
import { MODE_ICON, MODE_LABEL, timeLabel } from "./journey";
import { getVibeStatus } from "./vibe";

export type ReadyItem = {
  key: string;
  label: string;
  kind: "CONFIRMED" | "LIKELY" | "OPTIONAL";
  done: boolean;
  // true = decided by the system from state (not tickable); false = the traveller ticks it
  auto: boolean;
  detail?: string;
  source?: string;
  nearby?: string; // Around You category that can help ("show around me")
  href?: string;
};

export type ReadyView = { items: ReadyItem[]; sorted: number; total: number; weatherNote: string | null; vibe: "NONE" | "DEFERRED" | "COMPLETED" };

export async function buildReady(tripId: string, userId: string): Promise<ReadyView> {
  const [trip, journey, stay, ticks, vibe, anchors] = await Promise.all([
    prisma.trip.findUnique({ where: { id: tripId }, select: { coreStartDate: true, coreEndDate: true } }),
    prisma.travellerJourney.findFirst({ where: { tripId, userId, status: "CONFIRMED" } }),
    prisma.booking.findFirst({ where: { tripId, type: "STAY", status: "CONFIRMED" }, orderBy: { createdAt: "desc" } }),
    prisma.checklistItem.findMany({ where: { tripId, userId } }),
    getVibeStatus(tripId, userId),
    tripAnchors(tripId),
  ]);
  const tick = new Map(ticks.map((t) => [t.key, t.done]));
  const items: ReadyItem[] = [];
  const base = `/trips/${tripId}/agent`;

  items.push(
    journey
      ? { key: "journey", label: "Your journey", kind: "CONFIRMED", done: true, auto: true, detail: `${MODE_ICON[journey.mode] ?? ""} ${MODE_LABEL[journey.mode] ?? "Journey"}${journey.originName ? ` ${journey.originName}` : ""} → ${journey.destinationName ?? "destination"}${journey.arriveLocal ? ` · arrives ${timeLabel(journey.arriveLocal)}` : ""}` }
      : { key: "journey", label: "Add your journey", kind: "LIKELY", done: false, auto: true, detail: "Upload a ticket or add the details.", href: `${base}/journey` }
  );
  items.push(
    stay
      ? { key: "stay", label: "Stay", kind: "CONFIRMED", done: true, auto: true, detail: stay.placeName ?? "Confirmed" }
      : { key: "stay", label: "Stay", kind: "LIKELY", done: false, auto: true, detail: "Not confirmed yet — it's the group's decision." }
  );
  if (journey && stay) {
    items.push(
      journey.routeToStaySeconds != null && journey.routeStayBookingId === stay.id
        ? { key: "arrival-route", label: "Arrival → stay", kind: "CONFIRMED", done: true, auto: true, detail: `${((journey.routeToStayMeters ?? 0) / 1000).toFixed(1)} km · about ${Math.round(journey.routeToStaySeconds / 60)} min by car`, source: `${journey.routeProvider ?? "provider"} route${journey.routeComputedAt ? `, ${journey.routeComputedAt.toISOString().slice(11, 16)} UTC` : ""}` }
        : { key: "arrival-route", label: "Arrival → stay", kind: "LIKELY", done: false, auto: true, detail: journey.arrivalLat == null ? "I couldn't pin down where you arrive, so I haven't measured this." : "Not measured yet." }
    );
  }
  items.push(
    vibe === "COMPLETED"
      ? { key: "vibe", label: "Vibe check", kind: "CONFIRMED", done: true, auto: true }
      : { key: "vibe", label: "Finish your vibe check", kind: "LIKELY", done: false, auto: true, detail: "30 seconds, private.", href: `${base}?vibe=1` }
  );

  // Weather: only the real forecast, only for the trip's own dates.
  let weatherNote: string | null = null;
  const where = stay?.latitude != null && stay.longitude != null ? { lat: stay.latitude, lng: stay.longitude } : anchors.find((a) => a.kind === "destination")?.point;
  if (where && trip?.coreStartDate && trip.coreEndDate) {
    try {
      const w = await getWeather(where);
      const from = trip.coreStartDate.toISOString().slice(0, 10);
      const to = trip.coreEndDate.toISOString().slice(0, 10);
      const days = w.forecast.filter((d) => d.date >= from && d.date <= to);
      if (days.length === 0) {
        weatherNote = "The forecast doesn't reach your trip dates yet, so no weather-based suggestions.";
      } else {
        const max = Math.max(...days.map((d) => d.maxC));
        const min = Math.min(...days.map((d) => d.minC));
        const rain = Math.max(...days.map((d) => d.precipitationProbability ?? 0));
        const src = `Open-Meteo forecast ${from}–${to}: ${Math.round(min)}–${Math.round(max)}°C, rain chance up to ${rain}%`;
        weatherNote = src;
        if (max >= 30) {
          items.push({ key: "sunscreen", label: "Sunscreen", kind: "LIKELY", done: false, auto: false, detail: `Highs of ${Math.round(max)}°C.`, source: src, nearby: "pharmacy" });
          items.push({ key: "water", label: "Water bottle", kind: "LIKELY", done: false, auto: false, source: src, nearby: "convenience" });
        }
        if (rain >= 50) items.push({ key: "rain", label: "Rain layer / umbrella", kind: "LIKELY", done: false, auto: false, detail: `Up to ${rain}% chance of rain.`, source: src });
        if (min <= 12) items.push({ key: "warm", label: "A warm layer", kind: "LIKELY", done: false, auto: false, detail: `Lows of ${Math.round(min)}°C.`, source: src });
      }
    } catch {
      weatherNote = "I couldn't fetch the forecast just now.";
    }
  } else if (!trip?.coreStartDate) {
    weatherNote = "Trip dates aren't set, so there's no forecast to base suggestions on.";
  }

  items.push({ key: "id", label: "Check the ID or documents your carrier requires", kind: "LIKELY", done: false, auto: false, detail: "Requirements vary by carrier and route — check with them. I don't assert any rule." });
  items.push({ key: "charger", label: "Phone charger / power bank", kind: "OPTIONAL", done: false, auto: false, nearby: "shopping" });
  items.push({ key: "meds", label: "Any regular medication", kind: "OPTIONAL", done: false, auto: false, nearby: "pharmacy" });
  items.push({ key: "shoes", label: "Comfortable shoes", kind: "OPTIONAL", done: false, auto: false });

  for (const it of items) if (!it.auto && tick.get(it.key)) it.done = true;
  const counted = items.filter((i) => i.kind !== "OPTIONAL");
  return { items, sorted: counted.filter((i) => i.done).length, total: counted.length, weatherNote, vibe };
}
