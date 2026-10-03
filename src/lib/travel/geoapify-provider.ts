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
  convenience: "commercial.convenience",
  shopping: "commercial.shopping_mall,commercial.clothing",
  nightlife: "adult.nightclub,catering.bar,catering.pub",
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
  // Airports are looked up as the provider's own airport POIs around the named city;
  // a text geocode of "<city> Airport" returns the city or a ground with a similar name.
  if (/\bairport\b/i.test(text)) {
    const area = text.replace(/\b(international|domestic)?\s*airport\b/gi, "").replace(/\s+/g, " ").trim();
    const anchor = area ? await geocodeText(area, near) : null;
    const centre = anchor ? { lat: anchor.latitude, lng: anchor.longitude } : near;
    return centre ? findAirportNear(centre, anchor) : null;
  }
  return geocodeText(text, near);
}

// The provider's airport POI within 40 km of a point. Never falls back to the
// point itself or to a city-centre geocode: no airport found means null.
export async function findAirportNear(centre: LatLng, anchor?: CanonicalPlace | null): Promise<CanonicalPlace | null> {
  const params = new URLSearchParams({
    categories: "airport",
    filter: `circle:${centre.lng},${centre.lat},40000`,
    bias: `proximity:${centre.lng},${centre.lat}`,
    limit: "5",
    apiKey: requireApiKey(),
  });
  const res = await fetch(`${PLACES_URL}?${params}`);
  if (!res.ok) return null;
  const data: { features?: GeoapifyPlaceFeature[] } = await res.json();
  const best = (data.features ?? []).find((f) => /airport|airfield/i.test(f.properties.name ?? ""));
  if (!best) return null;
  return {
    displayName: best.properties.formatted ?? best.properties.name ?? "Airport",
    name: best.properties.name ?? "Airport",
    city: anchor?.city ?? null,
    region: anchor?.region ?? null,
    country: anchor?.country ?? null,
    countryCode: anchor?.countryCode ?? null,
    latitude: best.geometry.coordinates[1],
    longitude: best.geometry.coordinates[0],
    provider: "geoapify",
    providerPlaceId: best.properties.place_id,
  };
}

export type GeocodeCandidate = {
  label: string;
  name: string;
  city: string | null;
  state: string | null;
  country: string | null;
  countryCode: string | null;
  lat: number;
  lng: number;
  placeId: string | null;
  importance: number;
  resultType: string | null;
};

const CITY_LEVEL_TYPES = ["city", "county", "state", "locality", "district", "postcode", "country"];
export const isCityLevel = (c: Pick<GeocodeCandidate, "resultType">) => CITY_LEVEL_TYPES.includes(c.resultType ?? "");

// Raw provider candidates with their administrative identity. `circle` turns
// the search into a FILTER (results must lie inside it) rather than a hint.
export async function geocodeCandidates(text: string, opts: { circle?: { lat: number; lng: number; radiusM: number }; bias?: LatLng; limit?: number } = {}): Promise<GeocodeCandidate[]> {
  const params = new URLSearchParams({ text, apiKey: requireApiKey(), limit: String(opts.limit ?? 5), format: "json" });
  if (opts.circle) params.set("filter", `circle:${opts.circle.lng},${opts.circle.lat},${opts.circle.radiusM}`);
  if (opts.bias) params.set("bias", `proximity:${opts.bias.lng},${opts.bias.lat}`);
  const res = await fetch(`${GEOCODE_URL}?${params}`);
  if (!res.ok) throw new Error(`Geoapify geocoding failed (${res.status})`);
  const data: { results?: (GeoapifyGeocodeResult & { rank?: { importance?: number }; result_type?: string })[] } = await res.json();
  return (data.results ?? []).map((r) => ({
    label: r.formatted,
    name: r.name ?? r.city ?? text,
    city: r.city ?? null,
    state: r.state ?? null,
    country: r.country ?? null,
    countryCode: r.country_code ? r.country_code.toUpperCase() : null,
    lat: r.lat,
    lng: r.lon,
    placeId: r.place_id ?? null,
    importance: r.rank?.importance ?? 0,
    resultType: r.result_type ?? null,
  }));
}

export function candidateToPlace(c: GeocodeCandidate, text: string): CanonicalPlace {
  return {
    displayName: c.label,
    name: c.name ?? text,
    city: c.city,
    region: c.state,
    country: c.country,
    countryCode: c.countryCode,
    latitude: c.lat,
    longitude: c.lng,
    provider: "geoapify",
    providerPlaceId: c.placeId,
  };
}

// Plain resolution for callers with no trip context: the provider's most
// important city-level match, or its own ranking (with an optional bias) for streets/POIs.
async function geocodeText(text: string, near?: LatLng): Promise<CanonicalPlace | null> {
  const results = await geocodeCandidates(text, { bias: near, limit: 5 });
  if (results.length === 0) return null;
  const byImportance = [...results].sort((a, b) => b.importance - a.importance)[0];
  const first = isCityLevel(byImportance) ? byImportance : results[0];
  return candidateToPlace(first, text);
}

type GeoapifyPlaceFeature = {
  properties: {
    place_id: string;
    name?: string;
    address_line1?: string;
    formatted?: string;
    categories?: string[];
    distance?: number;
    opening_hours?: string;
    website?: string;
    contact?: { phone?: string };
    datasource?: { raw?: { opening_hours?: string; website?: string; phone?: string } };
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
    // An unnamed POI must not borrow its street name ("Bada Bazar Road" is not a store).
    name: f.properties.name ?? "Unnamed place",
    formattedAddress: f.properties.formatted ?? null,
    categories: f.properties.categories ?? [],
    latitude: f.geometry.coordinates[1],
    longitude: f.geometry.coordinates[0],
    distanceMeters: f.properties.distance ?? null,
    provider: "geoapify",
    retrievedAt,
    openingHours: f.properties.opening_hours ?? f.properties.datasource?.raw?.opening_hours ?? null,
    website: f.properties.website ?? f.properties.datasource?.raw?.website ?? null,
    phone: f.properties.contact?.phone ?? f.properties.datasource?.raw?.phone ?? null,
  }));
}

// category must be one of NEARBY_CATEGORIES' keys — validated by the
// caller (the agent tool schema constrains it via an enum).
export async function searchNearby(
  category: string,
  near: LatLng,
  radiusMeters = 1500,
  limit = 8,
  diet?: "vegetarian" | "vegan" | "halal"
): Promise<PlaceResult[]> {
  const mapped = NEARBY_CATEGORIES[category];
  if (!mapped) throw new Error(`Unknown place category "${category}"`);
  const params = new URLSearchParams({
    categories: mapped,
    ...(diet ? { conditions: diet } : {}),
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
  if (!res.ok) {
    const body = (await res.text().catch(() => "")).split(key).join("[redacted]").replace(/\s+/g, " ").slice(0, 200);
    throw new Error(`Geoapify routing failed (${res.status})${body ? `: ${body}` : ""}`);
  }
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

// Accommodation search across the stay types Geoapify classifies. Place data
// only: Geoapify carries no rates or availability, and nothing here pretends
// otherwise.
export const STAY_CATEGORIES = "accommodation.hotel,accommodation.guest_house,accommodation.hostel,accommodation.apartment";

export type GeoapifyStay = PlaceResult & { website: string | null; phone: string | null; stars: string | null };

export async function searchStays(near: LatLng, radiusMeters = 6000, limit = 12): Promise<GeoapifyStay[]> {
  const params = new URLSearchParams({
    categories: STAY_CATEGORIES,
    filter: `circle:${near.lng},${near.lat},${radiusMeters}`,
    bias: `proximity:${near.lng},${near.lat}`,
    limit: String(limit),
  });
  params.set("apiKey", requireApiKey());
  const res = await fetch(`${PLACES_URL}?${params}`);
  if (!res.ok) throw new Error(`Geoapify places search failed (${res.status})`);
  type Props = GeoapifyPlaceFeature["properties"] & {
    website?: string;
    contact?: { phone?: string };
    datasource?: { raw?: { stars?: string } };
  };
  const data: { features?: { properties: Props; geometry: { coordinates: [number, number] } }[] } = await res.json();
  const retrievedAt = nowIso();
  return (data.features ?? [])
    // A listing with no name is not something to propose to a group.
    .filter((f) => Boolean(f.properties.name) && !/\b(college|school|university|institute|restaurant|canteen|mess)\b/i.test(f.properties.name!))
    .map((f) => ({
      providerId: f.properties.place_id,
      name: f.properties.name!,
      formattedAddress: f.properties.formatted ?? null,
      categories: f.properties.categories ?? [],
      latitude: f.geometry.coordinates[1],
      longitude: f.geometry.coordinates[0],
      distanceMeters: f.properties.distance ?? null,
      provider: "geoapify",
      retrievedAt,
      website: f.properties.website ?? null,
      phone: f.properties.contact?.phone ?? null,
      stars: f.properties.datasource?.raw?.stars ?? null,
    }));
}

// Place Details (where Geoapify supports it for this id).
export async function getPlaceDetails(placeId: string): Promise<Partial<GeoapifyStay> | null> {
  const params = new URLSearchParams({ id: placeId, apiKey: requireApiKey() });
  const res = await fetch(`https://api.geoapify.com/v2/place-details?${params}`);
  if (!res.ok) return null;
  const data: { features?: { properties: Record<string, unknown> }[] } = await res.json();
  const p = data.features?.[0]?.properties as { name?: string; formatted?: string; website?: string; contact?: { phone?: string } } | undefined;
  if (!p) return null;
  return { name: p.name, formattedAddress: p.formatted ?? null, website: p.website ?? null, phone: p.contact?.phone ?? null, retrievedAt: nowIso() };
}

// A point that a router can start from: the closest mapped place within a short
// walk. Used only after the router rejected a raw point (e.g. the centre of a lake).
export async function nearestMappedPlace(point: LatLng, radiusMeters = 700): Promise<{ name: string; point: LatLng } | null> {
  const params = new URLSearchParams({
    categories: "catering,accommodation,tourism,commercial,leisure",
    filter: `circle:${point.lng},${point.lat},${radiusMeters}`,
    bias: `proximity:${point.lng},${point.lat}`,
    limit: "5",
    apiKey: requireApiKey(),
  });
  const res = await fetch(`${PLACES_URL}?${params}`);
  if (!res.ok) return null;
  const data: { features?: GeoapifyPlaceFeature[] } = await res.json();
  const f = (data.features ?? []).find((x) => x.properties.name);
  return f ? { name: f.properties.name!, point: { lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0] } } : null;
}
