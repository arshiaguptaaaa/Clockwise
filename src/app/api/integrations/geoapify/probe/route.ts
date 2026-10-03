import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/session";
import { getRoute, isGeoapifyConfigured, resolveLocationText, searchStays } from "@/lib/travel/geoapify-provider";

// Signed-in only. Exercises the live Geoapify calls the product depends on and
// reports each step's outcome (never the key): geocoding, stay search, routing.
//   ?from=Udaipur Airport&to=Lake Pichola&mode=drive
export async function GET(request: NextRequest) {
  if (!(await getCurrentUserId())) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (!isGeoapifyConfigured()) return NextResponse.json({ configured: false });
  const q = request.nextUrl.searchParams;
  const fromText = q.get("from") ?? "Udaipur Airport";
  const toText = q.get("to") ?? "Lake Pichola, Udaipur";
  const mode = (q.get("mode") ?? "drive") as "walk" | "drive" | "transit" | "bicycle";
  const out: Record<string, unknown> = { configured: true };
  const step = async (name: string, fn: () => Promise<unknown>) => {
    try {
      out[name] = { ok: true, ...((await fn()) as object) };
    } catch (err) {
      out[name] = { ok: false, error: err instanceof Error ? err.message : "unknown" };
    }
  };
  let from: { lat: number; lng: number } | null = null;
  let to: { lat: number; lng: number } | null = null;
  await step("geocodeFrom", async () => {
    const r = await resolveLocationText(fromText);
    if (r) from = { lat: r.latitude, lng: r.longitude };
    return { query: fromText, result: r ? { label: r.displayName, lat: r.latitude, lng: r.longitude } : null };
  });
  await step("geocodeTo", async () => {
    const r = await resolveLocationText(toText);
    if (r) to = { lat: r.latitude, lng: r.longitude };
    return { query: toText, result: r ? { label: r.displayName, lat: r.latitude, lng: r.longitude } : null };
  });
  if (from && to) {
    await step("route", async () => {
      const r = await getRoute(from!, to!, mode);
      return { mode, distanceMeters: r.distanceMeters, durationSeconds: r.durationSeconds, provider: r.provider, hasGeometry: Boolean(r.geometry?.length) };
    });
  }
  await step("staySearch", async () => {
    const rows = await searchStays({ lat: 24.5854, lng: 73.7125 }, 5000, 3);
    return { count: rows.length, first: rows[0]?.name ?? null };
  });
  return NextResponse.json(out);
}
