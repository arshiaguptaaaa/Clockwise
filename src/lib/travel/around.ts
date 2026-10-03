// Around You: real Geoapify places around the traveller's anchor — the CONFIRMED
// stay once there is one, otherwise the canonical destination. Walking times are
// provider routes (never straight-line distance dressed up as minutes). Place
// existence is all this proves: nothing here says a product is in stock.
import { NEARBY_CATEGORIES, searchNearby, getRoute, isGeoapifyConfigured } from "./geoapify-provider";
import { tripAnchors } from "./resolve";
import type { LatLng } from "./types";

export { AROUND_CATEGORIES } from "./around-categories";

export type AroundAnchor = { kind: "stay" | "destination"; label: string; point: LatLng };
export async function getAroundAnchor(tripId: string): Promise<AroundAnchor | null> {
  const anchors = await tripAnchors(tripId);
  const stay = anchors.find((a) => a.kind === "stay");
  const a = stay ?? anchors[0];
  return a ? { kind: a.kind, label: a.label, point: a.point } : null;
}

export type AroundPlace = {
  provider: string;
  providerPlaceId: string;
  name: string;
  address: string | null;
  lat: number;
  lng: number;
  distanceMeters: number | null;
  walkMinutes: number | null;
  retrievedAt: string;
};

export type AroundResult =
  | { ok: true; anchor: AroundAnchor; category: string; places: AroundPlace[]; retrievedAt: string; note?: string }
  | { ok: false; error: string };

async function withWalking(anchor: LatLng, places: AroundPlace[]): Promise<AroundPlace[]> {
  const top = places.slice(0, 6);
  const timed = await Promise.all(
    top.map(async (p) => {
      try {
        const r = await getRoute(anchor, { lat: p.lat, lng: p.lng }, "walk");
        return { ...p, walkMinutes: Math.max(1, Math.round(r.durationSeconds / 60)) };
      } catch {
        return p; // no provider route => no minutes shown, never a guess
      }
    })
  );
  return [...timed, ...places.slice(6)];
}

export async function searchAround(tripId: string, category: string, opts: { diet?: "vegetarian" | "vegan" | "halal"; radiusM?: number; limit?: number } = {}): Promise<AroundResult> {
  if (!isGeoapifyConfigured()) return { ok: false, error: "Place search isn't connected in this environment." };
  if (!(category in NEARBY_CATEGORIES)) return { ok: false, error: `Unknown category "${category}".` };
  const anchor = await getAroundAnchor(tripId);
  if (!anchor) return { ok: false, error: "No destination or stay to centre this on yet." };
  const radius = opts.radiusM ?? 1500;
  let raw;
  try {
    raw = await searchNearby(category, anchor.point, radius, opts.limit ?? 10, opts.diet);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Place search failed." };
  }
  const base: AroundPlace[] = raw.map((r) => ({ provider: r.provider, providerPlaceId: r.providerId, name: r.name, address: r.formattedAddress, lat: r.latitude, lng: r.longitude, distanceMeters: r.distanceMeters, walkMinutes: null, retrievedAt: r.retrievedAt }));
  const places = await withWalking(anchor.point, base);
  return { ok: true, anchor, category, places, retrievedAt: raw[0]?.retrievedAt ?? new Date().toISOString() };
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

// "Any 7-Eleven nearby?" — searched in the provider's convenience stores and
// supermarkets. A brand that isn't in the provider's data is reported as not
// found (with the real closest alternatives), never inferred from "it exists
// in the country".
export async function brandSearch(tripId: string, brand: string, at?: AroundAnchor): Promise<(AroundResult & { found: AroundPlace[]; alternatives: AroundPlace[] }) | { ok: false; error: string }> {
  if (!isGeoapifyConfigured()) return { ok: false, error: "Place search isn't connected in this environment." };
  const anchor = at ?? (await getAroundAnchor(tripId));
  if (!anchor) return { ok: false, error: "No destination or stay to centre this on yet." };
  let rows;
  try {
    const [conv, sup] = await Promise.all([searchNearby("convenience", anchor.point, 3000, 40), searchNearby("supermarket", anchor.point, 3000, 40)]);
    rows = [...conv, ...sup];
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Place search failed." };
  }
  const all: AroundPlace[] = rows.map((r) => ({ provider: r.provider, providerPlaceId: r.providerId, name: r.name, address: r.formattedAddress, lat: r.latitude, lng: r.longitude, distanceMeters: r.distanceMeters, walkMinutes: null, retrievedAt: r.retrievedAt }));
  const q = norm(brand);
  const found = all.filter((p) => q && norm(p.name).includes(q));
  const alternatives = all.filter((p) => !found.includes(p)).sort((a, b) => (a.distanceMeters ?? 1e9) - (b.distanceMeters ?? 1e9)).slice(0, 5);
  const shown = found.length ? found : alternatives;
  const places = await withWalking(anchor.point, shown);
  return {
    ok: true,
    anchor,
    category: "convenience",
    places,
    retrievedAt: rows[0]?.retrievedAt ?? new Date().toISOString(),
    note: found.length ? undefined : `I couldn't find a nearby ${brand}, but here are the closest convenience stores and supermarkets.`,
    found: found.length ? places : [],
    alternatives: found.length ? [] : places,
  };
}
