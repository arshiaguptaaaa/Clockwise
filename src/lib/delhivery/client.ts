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

export async function delhiveryCall(op: string, method: "GET" | "POST", path: string, payload: Record<string, unknown>, decision?: string): Promise<DelhiveryOutcome> {
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
    request: method === "GET" ? Object.fromEntries(url.searchParams) : payload,
    response: compactForEvidence(data ?? { error }),
    httpStatus: status,
    durationMs: latencyMs,
    context: decision ? { decision } : undefined,
  });
  if (status != null && status >= 200 && status < 300) return { ok: true, httpStatus: status, latencyMs, data, evidenceId };
  return { ok: false, blocked: status === 401 ? "DELHIVERY_TOKEN_REJECTED" : null, httpStatus: status, latencyMs, error: error || "failed", data: data ?? undefined, evidenceId };
}

// ---- Typed wrappers (response parsing is deliberately tolerant: the reference page documents the
// request bodies precisely but not every response body, so numbers are only ever taken from fields
// that exist; if none is found the call reports "no usable duration" rather than guessing).

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const pick = (o: unknown, path: string[]): unknown => path.reduce<unknown>((a, k) => (a && typeof a === "object" ? (a as Record<string, unknown>)[k] : undefined), o);

export async function delhiveryGeocode(address: string, decision?: string) {
  const r = await delhiveryCall("maps.geocode", "POST", "/geocode", { address, req_id: `clockwise-${Date.now()}` }, decision);
  if (!r.ok) return { ...r, point: null as LatLng | null };
  const lat = num(pick(r.data, ["lat"]));
  const lng = num(pick(r.data, ["lng"]));
  return { ...r, point: lat != null && lng != null ? ({ lat, lng } as LatLng) : null, errorRadiusM: num(pick(r.data, ["error_radius"])), pincode: (pick(r.data, ["metadata", "pincode"]) as string | undefined) ?? null };
}

export type DelhiveryRoute = { distanceMeters: number; durationSeconds: number; trafficAware: boolean; departureTime: string | null; evidenceId: string | null; latencyMs: number };

// Pull distance (m) and duration (s) out of a /route response. Valhalla-style summaries
// (trip.summary / legs[].summary with length in km and time in s) and flat shapes are handled;
// the units are fixed by the docs for the matrix ("distance (km), duration (seconds)") and by the
// response itself for routes (checked in the probe before this is trusted).
export function extractRouteSummary(data: unknown): { distanceMeters: number; durationSeconds: number } | null {
  const candidates: unknown[] = [pick(data, ["routes", "0"]), pick(data, ["trip"]), pick(data, ["route"]), data];
  for (const c of candidates) {
    const summary = pick(c, ["summary"]) ?? c;
    const dur = num(pick(summary, ["time"])) ?? num(pick(summary, ["duration"])) ?? num(pick(summary, ["duration_seconds"]));
    const lenKm = num(pick(summary, ["length"])) ?? num(pick(summary, ["distance_km"]));
    const distM = num(pick(summary, ["distance"])) ?? num(pick(summary, ["distance_meters"]));
    if (dur != null && (lenKm != null || distM != null)) return { durationSeconds: dur, distanceMeters: lenKm != null ? lenKm * 1000 : distM! };
  }
  return null;
}

export async function delhiveryRoute(from: LatLng, to: LatLng, opts: { mode?: "auto" | "motorcycle" | "pedestrian"; trafficAware?: boolean; departureTime?: string | null; decision?: string } = {}) {
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
  const r = await delhiveryCall("maps.route", "POST", "/route", body, opts.decision);
  if (!r.ok) return { ...r, route: null as DelhiveryRoute | null };
  const sum = extractRouteSummary(r.data);
  return { ...r, route: sum ? ({ ...sum, trafficAware: Boolean(opts.trafficAware), departureTime: opts.trafficAware ? (opts.departureTime ?? null) : null, evidenceId: r.evidenceId, latencyMs: r.latencyMs } as DelhiveryRoute) : null };
}

export async function delhiveryMatrix(sources: LatLng[], targets: LatLng[], mode: "auto" | "motorcycle" | "pedestrian" = "auto", decision?: string) {
  return delhiveryCall("maps.matrix", "POST", "/matrix", { sources: sources.map((p) => [p.lat, p.lng]), targets: targets.map((p) => [p.lat, p.lng]), travel_mode: mode }, decision);
}
