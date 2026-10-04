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
  | { ok: false; blocked: "DELHIVERY_CREDENTIALS_REQUIRED" | "DELHIVERY_TOKEN_REJECTED" | null; httpStatus: number | null; latencyMs: number; error: string; data?: unknown; evidenceId: string | null };

export type EvidenceCtx = { tripId?: string | null; userId?: string | null; decision?: string };

// `evidenceOverride` replaces what is RECORDED (never what is sent): used so a live location or a
// resolved home address never lands in the evidence log.
export type EvidenceOverride = { request?: unknown; response?: unknown };

export async function delhiveryCall(op: string, method: "GET" | "POST", path: string, payload: Record<string, unknown>, ctx?: EvidenceCtx | string, evidenceOverride?: EvidenceOverride): Promise<DelhiveryOutcome> {
  const evCtx: EvidenceCtx = typeof ctx === "string" ? { decision: ctx } : (ctx ?? {});
  const token = process.env.DELHIVERY_MAPS_TOKEN?.trim();
  if (!token) return { ok: false, blocked: "DELHIVERY_CREDENTIALS_REQUIRED", httpStatus: null, latencyMs: 0, error: "DELHIVERY_MAPS_TOKEN is not set", evidenceId: null };
  const url = new URL(`${delhiveryBase()}${path}`);
  if (method === "GET") for (const [k, v] of Object.entries(payload)) if (v != null) url.searchParams.set(k, String(v));
  const started = Date.now();
  let status: number | null = null;
  let data: unknown = null;
  let error = "";
  try {
    const res = await fetch(url, {
      method,
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json", "User-Agent": "Clockwise/1.0 (+https://clockwise-lemon.vercel.app)", ...(method === "POST" ? { "Content-Type": "application/json" } : {}) },
      ...(method === "POST" ? { body: JSON.stringify(payload) } : {}),
      signal: AbortSignal.timeout(15_000),
    });
    status = res.status;
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
    response: evidenceOverride?.response ?? compactForEvidence(data ?? { error }),
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
  return delhiveryCall("maps.reverse_geocode", "POST", "/rvg", { req_id: `clockwise-${Date.now()}`, lat: p.lat, lng: p.lng }, ctx, redact ? { request: { lat: "[not stored: live location]", lng: "[not stored: live location]" } } : undefined);
}

// POST /isochrone {origin:[lat,lng], cost_type:"time"|"distance", cost_value, travel_mode, direction, encode_geojson}
export async function delhiveryIsochroneRaw(origin: LatLng, seconds: number, mode: "auto" | "motorcycle" | "pedestrian" = "auto", ctx?: EvidenceCtx | string) {
  return delhiveryCall("maps.isochrone", "POST", "/isochrone", { origin: [origin.lat, origin.lng], cost_type: "time", cost_value: Math.round(seconds), travel_mode: mode, direction: "outbound", encode_geojson: false }, ctx);
}
