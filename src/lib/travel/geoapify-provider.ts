// Real calls against Geoapify — Places, Geocoding, and Routing all share
// one API key/credit pool (see architecture note, researched 2026-09-21).
// Never called without a configured key; callers must check
// isGeoapifyConfigured() first and degrade honestly, never fabricate a
// result.
import type { LatLng, PlaceResult, RouteResult, TravelMode } from "./types";
import type { CanonicalPlace } from "@/lib/location/types";

const GEOCODE_URL = "https://api.geoapify.com/v1/geocode/search";
const PLACES_URL = "https://api.geoapify.com/v2/places";
const ROUTING_URL = "https://api.geoapify.com/v1/routing";

// Maps the small set of categories Gemini is allowed to request (see the
// tool schema in src/lib/agent/tools.ts) to Geoapify's actual taxonomy.
export const NEARBY_CATEGORIES: Record<string, string> = {
  restaurant: "catering.restaurant",
  cafe: "catering.cafe",
  bar: "catering.bar",
  hotel: "accommodation.hotel",
  hostel: "accommodation.hostel",
  pharmacy: "healthcare.pharmacy",
  hospital: "healthcare.hospital",
  supermarket: "commercial.supermarket",
  atm: "service.financial.atm",
  attraction: "tourism.attraction",
  museum: "entertainment.museum",
  park: "leisure.park",
};

export function isGeoapifyConfigured(): boolean {
  return Boolean(process.env.GEOAPIFY_API_KEY);
}

function requireApiKey(): string {
  const key = process.env.GEOAPIFY_API_KEY;
  if (!key) throw new Error("GEOAPIFY_API_KEY not configured");
  return key;
}

function nowIso(): string {
  return new Date().toISOString();
}

type GeoapifyGeocodeResult = {
  place_id?: string;
  lat: number;
  lon: number;
  formatted: string;
  name?: string;
  city?: string;
  state?: string;
  county?: string;
  country?: string;
  country_code?: string;
};

// Resolves a place NAME/address (e.g. "Stephansplatz, Vienna") to a full
// canonical place via Geoapify's Geocoding API — distinct from the Places
// API, needed because a "near <landmark>" question requires a coordinate
// before a nearby/category search can run. Same CanonicalPlace shape as
// the Open-Meteo destination resolver (Stage 3 consolidation) so routing/
// map/weather code never has to branch on which provider produced a point.
export async function resolveLocationText(text: string, near?: LatLng): Promise<CanonicalPlace | null> {
  const key = requireApiKey();
  const params = new URLSearchParams({ text, apiKey: key, limit: "1", format: "json" });
  if (near) params.set("bias", `proximity:${near.lng},${near.lat}`);

  const res = await fetch(`${GEOCODE_URL}?${params}`);
  if (!res.ok) throw new Error(`Geoapify geocoding failed (${res.status})`);
  const data: { results?: GeoapifyGeocodeResult[] } = await res.json();
  const first = data.results?.[0];
  if (!first) return null;

  return {
    displayName: first.formatted,
    name: first.name ?? first.city ?? text,
    city: first.city ?? null,
    region: first.state ?? first.county ?? null,
    country: first.country ?? null,
    countryCode: first.country_code ? first.country_code.toUpperCase() : null,
    latitude: first.lat,
    longitude: first.lon,
    provider: "geoapify",
    providerPlaceId: first.place_id ?? null,
  };
}

type GeoapifyPlaceFeature = {
  properties: {
    place_id: string;
    name?: string;
    address_line1?: string;
    formatted?: string;
    categories?: string[];
    distance?: number;
  };
  geometry: { coordinates: [number, number] };
};

async function placesSearch(params: URLSearchParams): Promise<PlaceResult[]> {
  params.set("apiKey", requireApiKey());
  const res = await fetch(`${PLACES_URL}?${params}`);
  if (!res.ok) throw new Error(`Geoapify places search failed (${res.status})`);
  const data: { features?: GeoapifyPlaceFeature[] } = await res.json();
  const retrievedAt = nowIso();

  return (data.features ?? []).map((f) => ({
    providerId: f.properties.place_id,
    name: f.properties.name ?? f.properties.address_line1 ?? "Unnamed place",
    formattedAddress: f.properties.formatted ?? null,
    categories: f.properties.categories ?? [],
    latitude: f.geometry.coordinates[1],
    longitude: f.geometry.coordinates[0],
    distanceMeters: f.properties.distance ?? null,
    provider: "geoapify",
    retrievedAt,
  }));
}

// category must be one of NEARBY_CATEGORIES' keys — validated by the
// caller (the agent tool schema constrains it via an enum).
export async function searchNearby(
  category: string,
  near: LatLng,
  radiusMeters = 1500,
  limit = 8
): Promise<PlaceResult[]> {
  const mapped = NEARBY_CATEGORIES[category];
  if (!mapped) throw new Error(`Unknown place category "${category}"`);
  const params = new URLSearchParams({
    categories: mapped,
    filter: `circle:${near.lng},${near.lat},${radiusMeters}`,
    bias: `proximity:${near.lng},${near.lat}`,
    limit: String(limit),
  });
  return placesSearch(params);
}

export function searchHotels(near: LatLng, radiusMeters = 2500, limit = 8): Promise<PlaceResult[]> {
  return searchNearby("hotel", near, radiusMeters, limit);
}

// Free-text lookup for a single named place (e.g. "Stephansplatz", "our
// hotel's street"), used by search_places when the question is really
// "where is X" rather than "what's near me."
export async function searchPlaceByText(query: string, near?: LatLng): Promise<PlaceResult[]> {
  const resolved = await resolveLocationText(query, near);
  if (!resolved) return [];
  return [
    {
      providerId: resolved.providerPlaceId ?? `geocode:${query}`,
      name: resolved.name,
      formattedAddress: resolved.displayName,
      categories: [],
      latitude: resolved.latitude,
      longitude: resolved.longitude,
      distanceMeters: null,
      provider: "geoapify",
      retrievedAt: nowIso(),
    },
  ];
}

type GeoapifyRouteGeometry = { type: "LineString" | "MultiLineString"; coordinates: number[][] | number[][][] };
type GeoapifyRouteFeature = {
  properties: { distance: number; time: number };
  geometry?: GeoapifyRouteGeometry;
};
type GeoapifyRouteResponse = {
  features?: GeoapifyRouteFeature[];
};

const ROUTE_MODE_MAP: Record<TravelMode, string> = {
  walk: "walk",
  drive: "drive",
  transit: "approximated_transit",
  bicycle: "bicycle",
};

const MAX_ROUTE_GEOMETRY_POINTS = 200;

// GeoJSON coordinates are [lng, lat], and a MultiLineString nests one more
// array level than a LineString — flatten both into a single ordered
// lat/lng path, then decimate (keeping the real endpoints) so a ~5,000-
// point turn-by-turn path from a long drive doesn't bloat every stored
// ActionCard. This is still the actual routed path, just thinned for
// rendering — never a fabricated straight line between two points.
function extractRouteGeometry(geometry: GeoapifyRouteGeometry | undefined): LatLng[] | undefined {
  if (!geometry) return undefined;
  const segments = geometry.type === "MultiLineString" ? (geometry.coordinates as number[][][]) : [geometry.coordinates as number[][]];
  const flat: LatLng[] = segments.flat().map(([lng, lat]) => ({ lat, lng }));
  if (flat.length === 0) return undefined;
  if (flat.length <= MAX_ROUTE_GEOMETRY_POINTS) return flat;

  const stride = Math.ceil(flat.length / MAX_ROUTE_GEOMETRY_POINTS);
  const decimated = flat.filter((_, i) => i % stride === 0);
  const last = flat[flat.length - 1];
  if (decimated[decimated.length - 1] !== last) decimated.push(last);
  return decimated;
}

export async function getRoute(from: LatLng, to: LatLng, mode: TravelMode): Promise<RouteResult> {
  const key = requireApiKey();
  const params = new URLSearchParams({
    waypoints: `${from.lat},${from.lng}|${to.lat},${to.lng}`,
    mode: ROUTE_MODE_MAP[mode],
    apiKey: key,
  });
  const res = await fetch(`${ROUTING_URL}?${params}`);
  if (!res.ok) throw new Error(`Geoapify routing failed (${res.status})`);
  const data: GeoapifyRouteResponse = await res.json();
  const feature = data.features?.[0];
  if (!feature) throw new Error("Geoapify returned no route for this pair of points");

  return {
    mode,
    distanceMeters: feature.properties.distance,
    durationSeconds: feature.properties.time,
    provider: "geoapify",
    retrievedAt: nowIso(),
    geometry: extractRouteGeometry(feature.geometry),
  };
}
