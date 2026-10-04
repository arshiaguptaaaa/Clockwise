import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/session";
import { getRoute, isGeoapifyConfigured, resolveLocationText, searchStays, searchNearbyRaw } from "@/lib/travel/geoapify-provider";

// Signed-in only. Exercises the live Geoapify calls the product depends on and
// reports each step's outcome (never the key): geocoding, stay search, routing.
//   ?from=Udaipur Airport&to=Lake Pichola&mode=drive
export async function GET(request: NextRequest) {
  if (!(await getCurrentUserId())) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (!isGeoapifyConfigured()) return NextResponse.json({ configured: false });
  const q = request.nextUrl.searchParams;
  const fromText = q.get("from") ?? "Udaipur Airport";
  const toText = q.get("to") ?? "Lake Pichola, Udaipur";
  const bias = (q.get("bias") ?? "").split(",").map(Number);
  const near = bias.length === 2 && bias.every(Number.isFinite) ? { lat: bias[0], lng: bias[1] } : undefined;
  const mode = (q.get("mode") ?? "drive") as "walk" | "drive" | "transit" | "bicycle";
  const out: Record<string, unknown> = { configured: true };
  const step = async (name: string, fn: () => Promise<unknown>) => {
    try {
      out[name] = { ok: true, ...((await fn()) as object) };
    } catch (err) {
      out[name] = { ok: false, error: err instanceof Error ? err.message : "unknown" };
    }
  };
  // ?places=dosa&bias=12.9716,77.5946 : how each way of asking the provider for a dish performs (names only).
  const dish = q.get("places");
  if (dish && near) {
    const FOOD = "catering.restaurant,catering.fast_food,catering.food_court,catering.cafe";
    const variants: [string, () => Promise<{ name: string; cuisine?: string | null }[]>][] = [
      ["broad_8km_60", () => searchNearbyRaw(FOOD, near, 8000, 60)],
      ["broad_15km_100", () => searchNearbyRaw(FOOD, near, 15000, 100)],
      ["name_param", () => searchNearbyRaw(FOOD, near, 15000, 40, undefined, dish)],
      ["indian_subcats", () => searchNearbyRaw("catering.restaurant.indian,catering.restaurant.regional,catering.fast_food", near, 12000, 100)],
      ["name_param_veg", () => searchNearbyRaw(FOOD, near, 15000, 40, "vegetarian", dish)],
    ];
    const rows: Record<string, unknown> = {};
    for (const [label, fn] of variants) {
      try {
        const r = await fn();
        const re = new RegExp(`\\b(${dish}|dosai|udupi|darshini|south[ _]indian)\\b`, "i");
        rows[label] = { ok: true, count: r.length, withCuisine: r.filter((x) => x.cuisine).length, matching: r.filter((x) => re.test(x.name) || re.test(x.cuisine ?? "")).slice(0, 8).map((x) => `${x.name} [${x.cuisine ?? ""}]`), first: r.slice(0, 5).map((x) => `${x.name} [${x.cuisine ?? ""}]`) };
      } catch (err) {
        rows[label] = { ok: false, error: err instanceof Error ? err.message : "unknown" };
      }
    }
    out.places = rows;
    return NextResponse.json(out);
  }
  let from: { lat: number; lng: number } | null = null;
  let to: { lat: number; lng: number } | null = null;
  await step("geocodeFrom", async () => {
    const r = await resolveLocationText(fromText, near);
    if (r) from = { lat: r.latitude, lng: r.longitude };
    return { query: fromText, result: r ? { label: r.displayName, lat: r.latitude, lng: r.longitude } : null };
  });
  await step("geocodeTo", async () => {
    const r = await resolveLocationText(toText, near);
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
