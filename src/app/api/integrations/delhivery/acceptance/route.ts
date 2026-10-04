import { NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/session";
import { delhiverySuggest, delhiveryGeocode, delhiveryReverse, delhiveryRoute, delhiveryMatrix, delhiveryIsochrone, extractMatrixCell, pointInIsochrone, isDelhiveryConfigured, delhiveryRateLimitedFor } from "@/lib/delhivery/client";

export const maxDuration = 60;

// One real call per Delhivery capability, each recorded as Developer Evidence. Signed-in, read-only.
// Reports PASS only when the response was HTTP 2xx AND yielded the value Clockwise uses; anything else is
// reported as it was (status, blocked reason) - nothing is mocked or retried until it looks green.
export async function GET() {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (!isDelhiveryConfigured()) return NextResponse.json({ blocked: "DELHIVERY_CREDENTIALS_REQUIRED" }, { status: 503 });
  // fresh: the acceptance run must hit Delhivery for real, never a saved response.
  const ctx = { decision: "acceptance", userId, fresh: true };
  const rows: { capability: string; ok: boolean; status: number | null; ms: number; used: string; evidenceId: string | null; blocked?: string | null; error?: string }[] = [];
  const add = (capability: string, r: { ok: boolean; httpStatus: number | null; latencyMs: number; evidenceId: string | null; blocked?: string | null; error?: string }, pass: boolean, used: string) =>
    rows.push({ capability, ok: r.ok && pass, status: r.httpStatus, ms: r.latencyMs, used, evidenceId: r.evidenceId, ...(r.ok ? {} : { blocked: r.blocked ?? null, error: r.error }) });

  const sug = await delhiverySuggest("Indiranagar Bengaluru", { lat: 12.9716, lng: 77.5946 }, ctx);
  add("Autosuggest", sug, sug.suggestions.length > 0, sug.suggestions.length ? `${sug.suggestions.length} suggestions; first: ${sug.suggestions[0].label}` : "no suggestions parsed");
  const g = await delhiveryGeocode("Indiranagar, Bengaluru", ctx);
  add("Geocode", g, Boolean(g.point), g.point ? "a point for the chosen place" : "no point in response");
  const rv = await delhiveryReverse({ lat: 12.9784, lng: 77.6408 }, ctx, true);
  add("Reverse geocode", rv, Boolean(rv.place?.locality || rv.place?.city), rv.place ? `${rv.place.locality ?? "?"}, ${rv.place.city ?? "?"}` : "no locality parsed");
  const a = { lat: 13.1986, lng: 77.7066 };
  const b = { lat: 12.9784, lng: 77.6408 };
  const rt = await delhiveryRoute(a, b, { trafficAware: true, departureTime: "2026-12-13T21:15", decision: "acceptance", userId, fresh: true });
  add("Route", rt, Boolean(rt.route), rt.route ? `${(rt.route.distanceMeters / 1000).toFixed(1)} km, ${Math.round(rt.route.durationSeconds / 60)} min (traffic-aware, 21:15)` : "no duration parsed");
  const mx = await delhiveryMatrix([a, b], [b, { lat: 12.9719, lng: 77.5937 }], "auto", ctx);
  const cell = mx.ok ? extractMatrixCell(mx.data) : null;
  add("Distance Matrix", mx, Boolean(cell), cell ? `first cell ${Math.round(cell.durationSeconds / 60)} min` : "no cell parsed");
  const iso = await delhiveryIsochrone(b, 900, "auto", ctx);
  add("IsoSuite", iso, Boolean(iso.polygons), iso.polygons ? `15-min reach polygon; Cubbon Park inside: ${pointInIsochrone({ lat: 12.9763, lng: 77.5929 }, iso.polygons)}` : "no polygon parsed");
  return NextResponse.json({ rateLimitedForMs: delhiveryRateLimitedFor(), rows });
}
