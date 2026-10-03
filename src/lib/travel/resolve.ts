// Shared "turn a trip-relative phrase into real coordinates" logic, used
// by the agent's live-search tools. Two resolvers here deliberately use
// Open-Meteo's own keyless geocoding (already relied on for destination
// autocomplete) rather than Geoapify — city-level coordinate lookup
// doesn't need Geoapify's data, so tying it to Geoapify would make
// get_weather (genuinely keyless via Open-Meteo's forecast API) falsely
// depend on a Geoapify key whenever a Destination lacks stored lat/lng
// (e.g. the demo trip's seeded route, added before autocomplete existed).
// Geoapify is reserved for what only it can do: Places/hotels/routing.
import { prisma } from "@/lib/prisma";
import { geocodeCandidates, findAirportNear, isCityLevel, isGeoapifyConfigured, type GeocodeCandidate } from "./geoapify-provider";
import { destinationSearchProvider } from "@/lib/destination-search/open-meteo-provider";
import type { LatLng } from "./types";
import type { Trip } from "@/lib/trip";

export type ResolvedPlace = { point: LatLng; label: string };
export type ResolveFailure = { error: string };

export function isResolveFailure<T>(x: T | ResolveFailure): x is ResolveFailure {
  return typeof x === "object" && x !== null && "error" in x;
}

async function geocodeViaOpenMeteo(text: string): Promise<ResolvedPlace | null> {
  try {
    const results = await destinationSearchProvider.search(text);
    const first = results[0];
    if (!first) return null;
    return { point: { lat: first.latitude, lng: first.longitude }, label: first.name };
  } catch {
    return null;
  }
}

// Best-effort "where is the group right now" — generalizes
// prepare_transport's inferCurrentCity to also resolve a coordinate:
// prefers the Destination's own stored lat/lng (present when it came
// through the autocomplete provider), and geocodes the name as a keyless
// fallback for older/free-text destinations (e.g. the demo trip's seeded
// route).
export async function resolveTripCityPoint(trip: Trip): Promise<ResolvedPlace | null> {
  const now = new Date();
  const current = trip.destinations.find(
    (d) => d.startDate && d.endDate && d.startDate <= now && now <= d.endDate
  );
  const destination = current ?? [...trip.destinations].sort((a, b) => a.order - b.order)[0];
  if (!destination) return null;

  if (destination.latitude != null && destination.longitude != null) {
    return { point: { lat: destination.latitude, lng: destination.longitude }, label: destination.name };
  }
  return geocodeViaOpenMeteo(destination.name);
}

// "Our hotel" is the CONFIRMED stay when there is one. A stay that is only
// proposed/approved is not yet the plan and must not anchor routes. Legacy
// (non-STAY) bookings with coordinates keep working as before.
async function findHotelAnchor(tripId: string) {
  const stay = await prisma.booking.findFirst({
    where: { tripId, type: "STAY", status: "CONFIRMED", latitude: { not: null }, longitude: { not: null } },
    orderBy: { createdAt: "desc" },
  });
  if (stay) return stay;
  return prisma.booking.findFirst({
    where: { tripId, type: { not: "STAY" }, latitude: { not: null }, longitude: { not: null } },
    orderBy: { createdAt: "desc" },
  });
}

const HOTEL_PHRASE = /\b(hotel|airbnb|where we'?r?e? stay(ing)?|our (place|stay|accommodation))\b/i;

// Weather-specific resolver — deliberately independent of Geoapify so
// get_weather works end to end with ONLY Open-Meteo (always available,
// no key). A named place ("weather in Salzburg") is geocoded via
// Open-Meteo, same as the trip's current-destination fallback above.
export async function resolveWeatherLocation(
  text: string,
  tripId: string
): Promise<ResolvedPlace | ResolveFailure> {
  const trimmed = text.trim();

  if (HOTEL_PHRASE.test(trimmed)) {
    const hotelBooking = await findHotelAnchor(tripId);
    if (hotelBooking?.latitude != null && hotelBooking?.longitude != null) {
      return {
        point: { lat: hotelBooking.latitude, lng: hotelBooking.longitude },
        label: hotelBooking.placeName ?? "your hotel",
      };
    }
    return { error: "I don't have a stored hotel/stay address for this trip yet, so I can't resolve its location." };
  }

  // The trip's own resolved destination wins over a fresh same-name geocode.
  const stored = await findStoredDestinationPoint(tripId, trimmed);
  if (stored) return { point: stored.point, label: stored.label };
  const resolved = await geocodeViaOpenMeteo(trimmed);
  if (!resolved) return { error: `Couldn't find a location matching "${trimmed}".` };
  return resolved;
}

const norm = (v: string) => v.toLowerCase().replace(/[^a-z0-9, ]/g, " ").replace(/\s+/g, " ").trim();

type StoredDestination = { name: string; displayName: string | null; city: string | null; region: string | null; country: string | null; countryCode: string | null; latitude: number | null; longitude: number | null };

// Does free text name THIS stored destination? Identity-based, not proximity:
// the head of the text must equal the destination's own name, and any qualifier
// ("Rajasthan", "India") must agree with its stored region/country. "Udaipur,
// Tripura" therefore does NOT match Udaipur, Rajasthan; "Udaipur Airport" is not
// a destination at all (airports are resolved separately, around the destination).
function namesDestination(text: string, d: StoredDestination): boolean {
  const parts = norm(text).split(",").map((x) => x.trim());
  const head = parts[0];
  const heads = [d.name, d.city, d.displayName?.split(",")[0]].filter((v): v is string => Boolean(v)).map(norm);
  if (!head || !heads.includes(head)) return false;
  const rest = parts.slice(1).join(" ").split(" ").filter(Boolean);
  const identity = norm([d.region, d.country, d.countryCode].filter(Boolean).join(" "));
  return rest.every((tok) => tok === "city" || identity.split(" ").includes(tok));
}

async function findStoredDestinationPoint(tripId: string, text: string): Promise<(ResolvedPlace & { region: string | null; country: string | null }) | null> {
  if (!text.trim()) return null;
  const destinations = await prisma.destination.findMany({ where: { tripId, latitude: { not: null }, longitude: { not: null } } });
  const match = destinations.find((d) => namesDestination(text, d));
  if (!match || match.latitude == null || match.longitude == null) return null;
  return { point: { lat: match.latitude, lng: match.longitude }, label: match.displayName ?? match.name, region: match.region, country: match.country };
}

// Where this trip actually is: the confirmed stay first, then every resolved destination.
export type Anchor = { label: string; point: LatLng; kind: "stay" | "destination" };
export async function tripAnchors(tripId: string): Promise<Anchor[]> {
  const [stay, destinations] = await Promise.all([
    prisma.booking.findFirst({ where: { tripId, type: "STAY", status: "CONFIRMED", latitude: { not: null }, longitude: { not: null } }, orderBy: { createdAt: "desc" } }),
    prisma.destination.findMany({ where: { tripId, latitude: { not: null }, longitude: { not: null } }, orderBy: { order: "asc" } }),
  ]);
  const out: Anchor[] = [];
  if (stay?.latitude != null && stay.longitude != null) out.push({ label: stay.placeName ?? "your stay", point: { lat: stay.latitude, lng: stay.longitude }, kind: "stay" });
  for (const d of destinations) out.push({ label: d.displayName ?? d.name, point: { lat: d.latitude!, lng: d.longitude! }, kind: "destination" });
  return out;
}

const distinctIdentity = (a: GeocodeCandidate, b: GeocodeCandidate) => `${a.state}|${a.country}` !== `${b.state}|${b.country}`;

// Provider geocode with identity, in this order:
//  1. FILTER to a 60 km circle around each trip anchor — a place the trip is
//     actually at beats any same-named place elsewhere;
//  2. otherwise unfiltered. A city-level name that several administrative areas
//     share (comparable provider importance) is AMBIGUOUS and is never guessed.
async function geocodeWithTripIdentity(text: string, anchors: Anchor[], bias?: LatLng): Promise<ResolvedPlace | ResolveFailure> {
  for (const a of anchors.slice(0, 3)) {
    const near = await geocodeCandidates(text, { circle: { lat: a.point.lat, lng: a.point.lng, radiusM: 60_000 }, limit: 3 });
    if (near[0]) return { point: { lat: near[0].lat, lng: near[0].lng }, label: near[0].label };
  }
  const results = await geocodeCandidates(text, { bias, limit: 5 });
  if (results.length === 0) return { error: `Couldn't find a location matching "${text}".` };
  const top = [...results].sort((a, b) => b.importance - a.importance)[0];
  if (isCityLevel(top)) {
    const rivals = results.filter((r) => r !== top && isCityLevel(r) && distinctIdentity(r, top) && r.importance >= 0.8 * top.importance);
    if (rivals.length > 0) {
      const options = [top, ...rivals].slice(0, 3).map((c) => c.label).join(" / ");
      return { error: `AMBIGUOUS: "${text}" could be ${options}. Ask the user "WHICH ${text.toUpperCase()}?" with those options. Do not pick one.` };
    }
    return { point: { lat: top.lat, lng: top.lng }, label: top.label };
  }
  return { point: { lat: results[0].lat, lng: results[0].lng }, label: results[0].label };
}

// Resolves a free-text location phrase the way a traveller would actually
// say it: "our hotel" checks stored Booking data (never guesses an
// address), a phrase matching a logged Commitment's name uses that
// Commitment's real location text, a phrase matching one of this trip's
// own stored destinations reuses its already-canonical coordinate, and
// anything else is geocoded live via Geoapify.
export async function resolveTripLocationText(
  text: string,
  tripId: string,
  cityBias?: LatLng
): Promise<ResolvedPlace | ResolveFailure> {
  const trimmed = text.trim();

  if (HOTEL_PHRASE.test(trimmed)) {
    const hotelBooking = await findHotelAnchor(tripId);
    if (hotelBooking?.latitude != null && hotelBooking?.longitude != null) {
      return {
        point: { lat: hotelBooking.latitude, lng: hotelBooking.longitude },
        label: hotelBooking.placeName ?? "your hotel",
      };
    }
    return { error: "I don't have a stored hotel/stay address for this trip yet, so I can't resolve its location." };
  }

  // Airports: the provider's airport POI around the canonical destination the
  // text names (or the trip's own destination) — never a city-centre fallback.
  if (/\bairport\b/i.test(trimmed)) {
    if (!isGeoapifyConfigured()) return { error: "Live location search is temporarily unavailable." };
    const area = trimmed.replace(/\b(international|domestic)?\s*airport\b/gi, "").replace(/\s+/g, " ").trim();
    const anchors = await tripAnchors(tripId);
    let around: ResolvedPlace | ResolveFailure | null = null;
    if (area) {
      around = (await findStoredDestinationPoint(tripId, area)) ?? (await geocodeWithTripIdentity(area, anchors, cityBias));
    } else if (anchors[0]) {
      around = { point: anchors[0].point, label: anchors[0].label };
    }
    if (!around) return { error: "Which airport? Say which city." };
    if (isResolveFailure(around)) return around;
    const airport = await findAirportNear(around.point);
    if (!airport) return { error: `No airport found near ${around.label} in the provider's data. Say so; do not guess one.` };
    return { point: { lat: airport.latitude, lng: airport.longitude }, label: airport.displayName };
  }

  const storedDestination = await findStoredDestinationPoint(tripId, trimmed);
  if (storedDestination) return { point: storedDestination.point, label: storedDestination.label };

  if (!isGeoapifyConfigured()) {
    return { error: "Live location search is temporarily unavailable." };
  }

  const commitment = await prisma.commitment.findFirst({
    where: { tripId, name: { contains: trimmed } },
  });
  const searchText = commitment?.location || trimmed;

  try {
    return await geocodeWithTripIdentity(searchText, await tripAnchors(tripId), cityBias);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Live location search failed." };
  }
}
