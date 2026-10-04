// Delhivery Maps: India-native spatial intelligence. Server-side only; the Bearer JWT never leaves
// this file (never NEXT_PUBLIC_, never logged, never in evidence: see rails/evidence.ts).
// Endpoints are exactly those in the official reference (https://www.delhivery.com/maps/reference):
//   POST /geocode   POST /rvg   POST /route   POST /matrix   POST /validate   GET /search
// Delhivery supplies facts (a location, a route, a duration). Clockwise makes the decisions.
// Every call is recorded as sanitised Developer Evidence (partner DELHIVERY).
import { logRailCall } from "@/lib/rails/evidence";
import type { LatLng } from "@/lib/travel/types";

const DEFAULT_BASE = "https://gateway-maps-pub-int.delhivery.com";
export const delhiveryBase = () => (process.env.DELHIVERY_MAPS_BASE_URL || DEFAULT_BASE).replace(/\/+$/, "");
export const isDelhiveryConfigured = () => Boolean(process.env.DELHIVERY_MAPS_TOKEN?.trim());

// The API only serves India ("all waypoints within India"): a coarse bounding box is enough to
// decide whether to even ask. Outside it, callers use another provider and say so.
export const inIndia = (p: LatLng) => p.lat >= 6 && p.lat <= 37.6 && p.lng >= 68 && p.lng <= 97.5;

// Evidence stays readable: long strings (encoded polylines) and long arrays are summarised, never dropped silently.
export function compactForEvidence(v: unknown, depth = 0): unknown {
  if (typeof v === "string") return v.length > 600 ? `${v.slice(0, 80)}… <${v.length} chars total>` : v;
  if (Array.isArray(v)) return v.length > 12 && depth > 0 ? [...v.slice(0, 5).map((x) => compactForEvidence(x, depth + 1)), `… <${v.length} items total>`] : v.map((x) => compactForEvidence(x, depth + 1));
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, compactForEvidence(x, depth + 1)]));
  return v;
}

export type DelhiveryOutcome =
  | { ok: true; httpStatus: number; latencyMs: number; data: unknown; evidenceId: string | null }
  | { ok: false; blocked: "DELHIVERY_CREDENTIALS_REQUIRED" | "DELHIVERY_TOKEN_REJECTED" | "DELHIVERY_RATE_LIMITED" | null; httpStatus: number | null; latencyMs: number; error: string; data?: unknown; evidenceId: string | null };

// After a 429 this server instance stops asking for a while, so a rate-limited token isn't burned
// further by retries. The window follows Retry-After when Delhivery sends it.
let rateLimitedUntil = 0;
export const delhiveryRateLimitedFor = () => Math.max(0, rateLimitedUntil - Date.now());

export type EvidenceCtx = { tripId?: string | null; userId?: string | null; decision?: string };

// `evidenceOverride` replaces what is RECORDED (never what is sent): used so a live location or a
// resolved home address never lands in the evidence log.
export type EvidenceOverride = { request?: unknown; response?: unknown | ((data: unknown) => unknown) };

export async function delhiveryCall(op: string, method: "GET" | "POST", path: string, payload: Record<string, unknown>, ctx?: EvidenceCtx | string, evidenceOverride?: EvidenceOverride): Promise<DelhiveryOutcome> {
  const evCtx: EvidenceCtx = typeof ctx === "string" ? { decision: ctx } : (ctx ?? {});
  const token = process.env.DELHIVERY_MAPS_TOKEN?.trim();
  if (!token) return { ok: false, blocked: "DELHIVERY_CREDENTIALS_REQUIRED", httpStatus: null, latencyMs: 0, error: "DELHIVERY_MAPS_TOKEN is not set", evidenceId: null };
  if (Date.now() < rateLimitedUntil) {
    return { ok: false, blocked: "DELHIVERY_RATE_LIMITED", httpStatus: 429, latencyMs: 0, error: `Delhivery rate limit: not retried for another ${Math.ceil((rateLimitedUntil - Date.now()) / 1000)}s`, evidenceId: null };
  }
  const url = new URL(`${delhiveryBase()}${path}`);
  if (method === "GET") for (const [k, v] of Object.entries(payload)) if (v != null) url.searchParams.set(k, String(v));
  const started = Date.now();
  let status: number | null = null;
  let data: unknown = null;
  let error = "";
  let rateHeaders: Record<string, string> | null = null;
  try {
    const res = await fetch(url, {
      method,
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json", "User-Agent": "Clockwise/1.0 (+https://clockwise-lemon.vercel.app)", ...(method === "POST" ? { "Content-Type": "application/json" } : {}) },
      ...(method === "POST" ? { body: JSON.stringify(payload) } : {}),
      signal: AbortSignal.timeout(15_000),
    });
    status = res.status;
    if (res.status === 429) {
      const ra = Number(res.headers.get("retry-after"));
      rateLimitedUntil = Date.now() + (ra > 0 && ra < 3600 ? ra * 1000 : 60_000);
    }
    // Only rate-limit headers (never auth or cookies) are kept, so the evidence shows the actual limit.
    rateHeaders = {};
    res.headers.forEach((v, k) => {
      if (/^(retry-after|x-ratelimit|ratelimit)/i.test(k)) rateHeaders![k] = v;
    });
    const text = await res.text();
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { raw: text.slice(0, 500) };
    }
    if (!res.ok) error = `HTTP ${res.status}`;
  } catch (err) {
    error = err instanceof Error ? err.name : "request failed";
  }
  const latencyMs = Date.now() - started;
  const evidenceId = await logRailCall({
    partner: "DELHIVERY",
    operation: op,
    endpoint: `${method} ${url.origin}${url.pathname}`,
    method,
    request: evidenceOverride?.request ?? (method === "GET" ? Object.fromEntries(url.searchParams) : payload),
    response: (typeof evidenceOverride?.response === "function" ? (evidenceOverride.response as (d: unknown) => unknown)(data) : evidenceOverride?.response) ?? compactForEvidence(rateHeaders && Object.keys(rateHeaders).length ? { ...(data && typeof data === "object" ? (data as object) : { value: data }), _rateLimitHeaders: rateHeaders } : (data ?? { error })),
    httpStatus: status,
    durationMs: latencyMs,
    context: evCtx,
  });
  if (status != null && status >= 200 && status < 300) return { ok: true, httpStatus: status, latencyMs, data, evidenceId };
  return { ok: false, blocked: status === 401 ? "DELHIVERY_TOKEN_REJECTED" : null, httpStatus: status, latencyMs, error: error || "failed", data: data ?? undefined, evidenceId };
}

// ---- Typed wrappers (response parsing is deliberately tolerant: the reference page documents the
// request bodies precisely but not every response body, so numbers are only ever taken from fields
// that exist; if none is found the call reports "no usable duration" rather than guessing).

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const pick = (o: unknown, path: string[]): unknown => path.reduce<unknown>((a, k) => (a && typeof a === "object" ? (a as Record<string, unknown>)[k] : undefined), o);

export async function delhiveryGeocode(address: string, decision?: EvidenceCtx | string) {
  const r = await delhiveryCall("maps.geocode", "POST", "/geocode", { address, req_id: `clockwise-${Date.now()}` }, decision);
  if (!r.ok) return { ...r, point: null as LatLng | null };
  const lat = num(pick(r.data, ["lat"]));
  const lng = num(pick(r.data, ["lng"]));
  return { ...r, point: lat != null && lng != null ? ({ lat, lng } as LatLng) : null, errorRadiusM: num(pick(r.data, ["error_radius"])), pincode: (pick(r.data, ["metadata", "pincode"]) as string | undefined) ?? null };
}

export type DelhiveryRoute = { distanceMeters: number; durationSeconds: number; trafficAware: boolean; departureTime: string | null; evidenceId: string | null; latencyMs: number };

// Pull distance (m) and duration (s) out of a /route response. Observed shape (real response):
//   { recommended_route: { distance: 38.2 (km), duration: 3998.0 (s), legs: [{ summary: { length (km), time (s), has_toll… } }] }, alternates: [] }
// so distance is kilometres and duration is seconds, matching the documented matrix units
// ("distance (km), duration (seconds)"). Nothing is returned unless both numbers exist.
export function extractRouteSummary(data: unknown): { distanceMeters: number; durationSeconds: number } | null {
  const rr = pick(data, ["recommended_route"]);
  const dur = num(pick(rr, ["duration"])) ?? num(pick(rr, ["legs", "0", "summary", "time"]));
  const km = num(pick(rr, ["distance"])) ?? num(pick(rr, ["legs", "0", "summary", "length"]));
  if (dur != null && km != null) return { durationSeconds: dur, distanceMeters: km * 1000 };
  return null;
}

export async function delhiveryRoute(from: LatLng, to: LatLng, opts: { mode?: "auto" | "motorcycle" | "pedestrian"; trafficAware?: boolean; departureTime?: string | null; decision?: string; tripId?: string | null; userId?: string | null } = {}) {
  const body: Record<string, unknown> = {
    geo_coords: [
      [from.lat, from.lng],
      [to.lat, to.lng],
    ],
    travel_mode: opts.mode ?? "auto",
    traffic_aware: Boolean(opts.trafficAware),
    ...(opts.trafficAware && opts.departureTime ? { departure_time: opts.departureTime } : {}),
    output_format: { encode_polyline: true, maneuvers: false },
  };
  const r = await delhiveryCall("maps.route", "POST", "/route", body, { decision: opts.decision, tripId: opts.tripId, userId: opts.userId });
  if (!r.ok) return { ...r, route: null as DelhiveryRoute | null };
  const sum = extractRouteSummary(r.data);
  return { ...r, route: sum ? ({ ...sum, trafficAware: Boolean(opts.trafficAware), departureTime: opts.trafficAware ? (opts.departureTime ?? null) : null, evidenceId: r.evidenceId, latencyMs: r.latencyMs } as DelhiveryRoute) : null };
}

export async function delhiveryMatrix(sources: LatLng[], targets: LatLng[], mode: "auto" | "motorcycle" | "pedestrian" = "auto", decision?: EvidenceCtx | string) {
  return delhiveryCall("maps.matrix", "POST", "/matrix", { sources: sources.map((p) => [p.lat, p.lng]), targets: targets.map((p) => [p.lat, p.lng]), travel_mode: mode }, decision);
}

// First cell of a /matrix response: distance in km, time in seconds.
export function extractMatrixCell(data: unknown): { distanceMeters: number; durationSeconds: number } | null {
  const cell = pick(data, ["sources_to_targets", "0", "0"]);
  const km = num(pick(cell, ["distance"]));
  const t = num(pick(cell, ["time"]));
  return km != null && t != null ? { distanceMeters: km * 1000, durationSeconds: t } : null;
}

// ---- Autosuggest, reverse geocode, IsoSuite (documented at delhivery.com/maps/reference) ----

// GET /search?query=&lat=&lng=  - ranked suggestions across India, optionally biased to a point.
export async function delhiverySearchRaw(query: string, bias?: LatLng | null, ctx?: EvidenceCtx | string) {
  return delhiveryCall("maps.autosuggest", "GET", "/search", { query, ...(bias ? { lat: bias.lat, lng: bias.lng } : {}) }, ctx);
}

// POST /rvg {req_id, lat, lng} - coordinates -> structured address. A LIVE location is the traveller's
// private state: the evidence record keeps neither the coordinates nor the full address (see redact).
export async function delhiveryReverseRaw(p: LatLng, ctx?: EvidenceCtx | string, redact = false) {
  return delhiveryCall("maps.reverse_geocode", "POST", "/rvg", { req_id: `clockwise-${Date.now()}`, lat: p.lat, lng: p.lng }, ctx, redact ? { request: { lat: "[not stored: live location]", lng: "[not stored: live location]" }, response: (d: unknown) => ({ stored: "locality only (live location is private)", locality: parseReverse(d)?.locality ?? null, city: parseReverse(d)?.city ?? null, state: parseReverse(d)?.state ?? null }) } : undefined);
}

// POST /isochrone {origin:[lat,lng], cost_type:"time"|"distance", cost_value, travel_mode, direction, encode_geojson}
export async function delhiveryIsochroneRaw(origin: LatLng, seconds: number, mode: "auto" | "motorcycle" | "pedestrian" = "auto", ctx?: EvidenceCtx | string) {
  return delhiveryCall("maps.isochrone", "POST", "/isochrone", { origin: [origin.lat, origin.lng], cost_type: "time", cost_value: Math.round(seconds), travel_mode: mode, direction: "outbound", encode_geojson: false }, ctx);
}

// ---- Parsed views (tolerant: numbers/labels are only taken from fields that exist) ----

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const firstStr = (o: unknown, keys: string[]): string | null => {
  for (const k of keys) {
    const v = str(pick(o, k.split(".")));
    if (v) return v;
  }
  return null;
};

export type Suggestion = { id: string; label: string; secondary: string | null; point: LatLng | null };

// Pulls a coordinate out of a suggestion in whichever of the common shapes it uses.
function suggestionPoint(o: unknown): LatLng | null {
  const pairs: [string[], string[]][] = [
    [["lat"], ["lng"]],
    [["lat"], ["lon"]],
    [["latitude"], ["longitude"]],
    [["location", "lat"], ["location", "lng"]],
    [["geometry", "location", "lat"], ["geometry", "location", "lng"]],
    [["coordinates", "lat"], ["coordinates", "lng"]],
  ];
  for (const [a, b] of pairs) {
    const lat = num(pick(o, a));
    const lng = num(pick(o, b));
    if (lat != null && lng != null) return { lat, lng };
  }
  const arr = pick(o, ["coordinates"]);
  if (Array.isArray(arr) && arr.length >= 2 && typeof arr[0] === "number" && typeof arr[1] === "number") return { lat: arr[1] as number, lng: arr[0] as number };
  return null;
}

export function parseSuggestions(data: unknown): Suggestion[] {
  const list = Array.isArray(data) ? data : ([pick(data, ["results"]), pick(data, ["suggestions"]), pick(data, ["data"]), pick(data, ["predictions"]), pick(data, ["items"])].find((x) => Array.isArray(x)) as unknown[] | undefined) ?? [];
  const out: Suggestion[] = [];
  for (const [i, item] of list.entries()) {
    const label = firstStr(item, ["name", "title", "display_name", "displayName", "label", "main_text", "description", "formatted_address", "address", "text"]);
    if (!label) continue;
    const secondary = firstStr(item, ["secondary_text", "subtitle", "locality", "city", "formatted_address", "address", "description"]);
    out.push({ id: firstStr(item, ["id", "place_id", "placeId", "uid"]) ?? `s${i}`, label, secondary: secondary && secondary !== label ? secondary : null, point: suggestionPoint(item) });
  }
  return out;
}

export async function delhiverySuggest(query: string, bias?: LatLng | null, ctx?: EvidenceCtx | string) {
  const r = await delhiverySearchRaw(query, bias, ctx);
  return { ...r, suggestions: r.ok ? parseSuggestions(r.data) : ([] as Suggestion[]) };
}

export type ReverseGeocoded = { locality: string | null; city: string | null; state: string | null; formatted: string | null };

// /rvg answers in Google Geocoding format: results[].address_components[{long_name, types[]}], formatted_address.
export function parseReverse(data: unknown): ReverseGeocoded | null {
  const results = pick(data, ["results"]);
  const first = Array.isArray(results) ? results[0] : data;
  const comps = pick(first, ["address_components"]);
  const find = (...types: string[]) => {
    if (!Array.isArray(comps)) return null;
    for (const t of types) {
      const c = comps.find((x) => Array.isArray((x as { types?: unknown }).types) && ((x as { types: string[] }).types).includes(t));
      const v = str((c as { long_name?: unknown } | undefined)?.long_name);
      if (v) return v;
    }
    return null;
  };
  const out: ReverseGeocoded = {
    locality: find("sublocality_level_1", "sublocality", "neighborhood", "locality"),
    city: find("locality", "administrative_area_level_2"),
    state: find("administrative_area_level_1"),
    formatted: str(pick(first, ["formatted_address"])),
  };
  return out.locality || out.city || out.state || out.formatted ? out : null;
}

export async function delhiveryReverse(p: LatLng, ctx?: EvidenceCtx | string, live = false) {
  // For a live location the recorded evidence keeps only the locality, never the coordinates or the full address.
  const r = await delhiveryReverseRaw(p, ctx, live);
  const parsed = r.ok ? parseReverse(r.data) : null;
  return { ...r, place: parsed };
}

// GeoJSON from /isochrone with encode_geojson:false: features[0].geometry is a Polygon or MultiPolygon in [lng, lat].
export type Ring = [number, number][];
export function parseIsochrone(data: unknown): Ring[][] | null {
  const geom = pick(data, ["features", "0", "geometry"]);
  const type = str(pick(geom, ["type"]));
  const coords = pick(geom, ["coordinates"]);
  if (!Array.isArray(coords)) return null;
  const toRing = (r: unknown): Ring | null => (Array.isArray(r) && r.every((c) => Array.isArray(c) && typeof c[0] === "number" && typeof c[1] === "number") ? (r as Ring) : null);
  if (type === "Polygon") {
    const rings = coords.map(toRing).filter((r): r is Ring => Boolean(r));
    return rings.length ? [rings] : null;
  }
  if (type === "MultiPolygon") {
    const polys = coords.map((poly) => (Array.isArray(poly) ? poly.map(toRing).filter((r): r is Ring => Boolean(r)) : [])).filter((p) => p.length);
    return polys.length ? polys : null;
  }
  return null;
}

function inRing(x: number, y: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
// A point is reachable if it is inside an outer ring and not inside one of that polygon's holes.
export function pointInIsochrone(p: LatLng, polys: Ring[][]): boolean {
  return polys.some(([outer, ...holes]) => inRing(p.lng, p.lat, outer) && !holes.some((h) => inRing(p.lng, p.lat, h)));
}

export async function delhiveryIsochrone(origin: LatLng, seconds: number, mode: "auto" | "motorcycle" | "pedestrian" = "auto", ctx?: EvidenceCtx | string) {
  const r = await delhiveryIsochroneRaw(origin, seconds, mode, ctx);
  return { ...r, polygons: r.ok ? parseIsochrone(r.data) : null };
}

// /matrix sources_to_targets[i][j] = { distance (km), time (s) } -> seconds grid; null where no number came back.
export function parseMatrix(data: unknown, rows: number, cols: number): (number | null)[][] | null {
  const m = pick(data, ["sources_to_targets"]);
  if (!Array.isArray(m)) return null;
  return Array.from({ length: rows }, (_, i) => Array.from({ length: cols }, (_, j) => num(pick(m, [String(i), String(j), "time"]))));
}
