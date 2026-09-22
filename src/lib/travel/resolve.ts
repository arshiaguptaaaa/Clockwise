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
import { resolveLocationText, isGeoapifyConfigured } from "./geoapify-provider";
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
    const hotelBooking = await prisma.booking.findFirst({
      where: { tripId, latitude: { not: null }, longitude: { not: null } },
      orderBy: { createdAt: "desc" },
    });
    if (hotelBooking?.latitude != null && hotelBooking?.longitude != null) {
      return {
        point: { lat: hotelBooking.latitude, lng: hotelBooking.longitude },
        label: hotelBooking.placeName ?? "your hotel",
      };
    }
    return { error: "I don't have a stored hotel/stay address for this trip yet, so I can't resolve its location." };
  }

  const resolved = await geocodeViaOpenMeteo(trimmed);
  if (!resolved) return { error: `Couldn't find a location matching "${trimmed}".` };
  return resolved;
}

// Matches free text against this trip's own stored destinations so a
// phrase like "Vienna" reuses the coordinate already captured at trip-
// creation time (via Open-Meteo, see wizard-actions.ts) instead of
// spending a Geoapify geocode re-resolving a place we've already
// canonicalized. This also preserves provenance: an Open-Meteo-resolved
// destination's point is never silently swapped for a Geoapify one just
// because a Geoapify-backed tool (routing/hotels/nearby) consumes it.
async function findStoredDestinationPoint(tripId: string, text: string): Promise<ResolvedPlace | null> {
  const normalized = text.trim().toLowerCase();
  if (!normalized) return null;

  const destinations = await prisma.destination.findMany({
    where: { tripId, latitude: { not: null }, longitude: { not: null } },
  });

  const match = destinations.find((d) => {
    const candidates = [d.name, d.displayName, d.city].filter((v): v is string => Boolean(v));
    return candidates.some((c) => {
      const lower = c.toLowerCase();
      return lower === normalized || lower.includes(normalized) || normalized.includes(lower);
    });
  });

  if (!match || match.latitude == null || match.longitude == null) return null;
  return { point: { lat: match.latitude, lng: match.longitude }, label: match.displayName ?? match.name };
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
    const hotelBooking = await prisma.booking.findFirst({
      where: { tripId, latitude: { not: null }, longitude: { not: null } },
      orderBy: { createdAt: "desc" },
    });
    if (hotelBooking?.latitude != null && hotelBooking?.longitude != null) {
      return {
        point: { lat: hotelBooking.latitude, lng: hotelBooking.longitude },
        label: hotelBooking.placeName ?? "your hotel",
      };
    }
    return { error: "I don't have a stored hotel/stay address for this trip yet, so I can't resolve its location." };
  }

  const storedDestination = await findStoredDestinationPoint(tripId, trimmed);
  if (storedDestination) return storedDestination;

  if (!isGeoapifyConfigured()) {
    return { error: "Live location search isn't configured yet (GEOAPIFY_API_KEY missing)." };
  }

  const commitment = await prisma.commitment.findFirst({
    where: { tripId, name: { contains: trimmed } },
  });
  const searchText = commitment?.location || trimmed;

  try {
    const resolved = await resolveLocationText(searchText, cityBias);
    if (!resolved) return { error: `Couldn't find a location matching "${searchText}".` };
    return { point: { lat: resolved.latitude, lng: resolved.longitude }, label: resolved.displayName };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Live location search failed." };
  }
}
