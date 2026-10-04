import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/session";
import { compactForEvidence, extractMatrixCell, delhiveryGeocode, delhiveryRoute, delhiveryMatrix, isDelhiveryConfigured, delhiveryBase } from "@/lib/delhivery/client";
import { delhiverySearchRaw, delhiveryReverseRaw, delhiveryIsochroneRaw } from "@/lib/delhivery/client";
import { resolveLocationText } from "@/lib/travel/geoapify-provider";

// Signed-in, read-only capability probe. Calls the documented endpoints for a Bengaluru airport->Indiranagar
// pair and returns the sanitised responses (never the token). ?from=...&to=...
export async function GET(request: NextRequest) {
  if (!(await getCurrentUserId())) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (!isDelhiveryConfigured()) return NextResponse.json({ blocked: "DELHIVERY_CREDENTIALS_REQUIRED", note: "Set DELHIVERY_MAPS_TOKEN (Get Access Token at delhivery.com/maps/developer)." }, { status: 503 });
  const q = request.nextUrl.searchParams;
  // ?op=suggest&q=Indiranagar | ?op=reverse&lat=&lng= | ?op=iso&lat=&lng=&seconds=  (raw, sanitised shapes)
  const op = q.get("op");
  if (op === "suggest") {
    const r = await delhiverySearchRaw(q.get("q") ?? "Indiranagar", q.get("lat") ? { lat: Number(q.get("lat")), lng: Number(q.get("lng")) } : null, "probe");
    return NextResponse.json({ ok: r.ok, status: r.httpStatus, ms: r.latencyMs, data: compactForEvidence(r.data) });
  }
  if (op === "reverse") {
    const r = await delhiveryReverseRaw({ lat: Number(q.get("lat") ?? 12.9784), lng: Number(q.get("lng") ?? 77.6408) }, "probe", false);
    return NextResponse.json({ ok: r.ok, status: r.httpStatus, ms: r.latencyMs, data: compactForEvidence(r.data) });
  }
  if (op === "iso") {
    const r = await delhiveryIsochroneRaw({ lat: Number(q.get("lat") ?? 12.9784), lng: Number(q.get("lng") ?? 77.6408) }, Number(q.get("seconds") ?? 900), "auto", "probe");
    return NextResponse.json({ ok: r.ok, status: r.httpStatus, ms: r.latencyMs, data: compactForEvidence(r.data) });
  }
  const fromText = q.get("from") ?? "Kempegowda International Airport, Bengaluru";
  const toText = q.get("to") ?? "Indiranagar, Bengaluru";
  const out: Record<string, unknown> = { base: delhiveryBase(), from: fromText, to: toText };
  const g1 = await delhiveryGeocode(fromText, "probe");
  const g2 = await delhiveryGeocode(toText, "probe");
  out.geocodeFrom = { ok: g1.ok, status: g1.httpStatus, ms: g1.latencyMs, point: g1.point, data: g1.ok ? g1.data : (g1 as { data?: unknown }).data };
  out.geocodeTo = { ok: g2.ok, status: g2.httpStatus, ms: g2.latencyMs, point: g2.point, data: g2.ok ? g2.data : (g2 as { data?: unknown }).data };
  // Geoapify coordinates as the fallback pair if a geocode failed (so routing can still be exercised).
  const gf = g1.point ?? (await resolveLocationText(fromText).then((p) => (p ? { lat: p.latitude, lng: p.longitude } : null)));
  const gt = g2.point ?? (await resolveLocationText(toText).then((p) => (p ? { lat: p.latitude, lng: p.longitude } : null)));
  if (gf && gt) {
    const dep = q.get("depart") ?? "2026-12-13T21:15";
    const r1 = await delhiveryRoute(gf, gt, { trafficAware: false, decision: "probe" });
    const r2 = await delhiveryRoute(gf, gt, { trafficAware: true, departureTime: dep, decision: "probe" });
    const m = await delhiveryMatrix([gf], [gt], "auto", "probe");
    out.routeFreeFlow = { ok: r1.ok, status: r1.httpStatus, ms: r1.latencyMs, parsed: r1.route, data: compactForEvidence(r1.ok ? r1.data : (r1 as { data?: unknown }).data) };
    out.routeTrafficAware = { ok: r2.ok, status: r2.httpStatus, ms: r2.latencyMs, departure: dep, parsed: r2.route, data: compactForEvidence(r2.ok ? r2.data : (r2 as { data?: unknown }).data) };
    out.matrix = { ok: m.ok, status: m.httpStatus, ms: m.latencyMs, parsed: m.ok ? extractMatrixCell(m.data) : null, data: compactForEvidence(m.ok ? m.data : (m as { data?: unknown }).data) };
  }
  return NextResponse.json(out);
}
