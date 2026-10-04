// Around You: real Geoapify places around an EXPLICIT anchor. Four anchors are
// kept distinct and never silently swapped for one another:
//   ME          the traveller's current location, only after they granted browser
//               permission (coordinates arrive with the request; they are never stored)
//   HOTEL       the confirmed stay
//   ARRIVAL     the traveller's own confirmed arrival point (airport/station)
//   DESTINATION the canonical trip destination
// Walking times are provider routes (never straight-line distance dressed up as
// minutes). Place existence is all this proves: nothing here says a product is in stock.
import { NEARBY_CATEGORIES, BROAD_CATEGORIES, searchNearby, searchNearbyRaw, getRoute, isGeoapifyConfigured } from "./geoapify-provider";
import { tripAnchors } from "./resolve";
import { prisma } from "@/lib/prisma";
import type { LatLng } from "./types";
import type { HoursStatus } from "./hours";

export { AROUND_CATEGORIES } from "./around-categories";

export type AnchorType = "me" | "stay" | "arrival" | "destination" | "anywhere";
export type AroundAnchor = { kind: AnchorType; label: string; point: LatLng };

// Back-compat: the default anchor is the confirmed stay, else the destination.
export async function getAroundAnchor(tripId: string): Promise<AroundAnchor | null> {
  const anchors = await tripAnchors(tripId);
  const stay = anchors.find((a) => a.kind === "stay");
  const a = stay ?? anchors[0];
  return a ? { kind: a.kind, label: a.label, point: a.point } : null;
}

export type AnchorAvailability = Record<AnchorType, { available: boolean; label?: string; reason?: string }>;

// What each anchor resolves to right now for this traveller (ME is decided in the browser).
export async function anchorsFor(tripId: string, userId: string): Promise<{ stay: AroundAnchor | null; arrival: AroundAnchor | null; destination: AroundAnchor | null }> {
  const [anchors, journey] = await Promise.all([
    tripAnchors(tripId),
    prisma.travellerJourney.findFirst({ where: { tripId, userId, status: "CONFIRMED", arrivalLat: { not: null }, arrivalLng: { not: null } }, orderBy: { updatedAt: "desc" } }),
  ]);
  const stay = anchors.find((a) => a.kind === "stay");
  const dest = anchors.find((a) => a.kind === "destination");
  return {
    stay: stay ? { kind: "stay", label: stay.label, point: stay.point } : null,
    destination: dest ? { kind: "destination", label: dest.label, point: dest.point } : null,
    arrival: journey ? { kind: "arrival", label: journey.arrivalPlaceName ?? "your arrival point", point: { lat: journey.arrivalLat!, lng: journey.arrivalLng! } } : null,
  };
}

const validCoord = (v: unknown, min: number, max: number): v is number => typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;

// Resolve ONE requested anchor. A missing anchor is reported; the destination
// centre is never substituted for it.
export async function resolveAnchor(tripId: string, userId: string, type: AnchorType, me?: { lat: number; lng: number; label?: string } | null): Promise<{ ok: true; anchor: AroundAnchor } | { ok: false; error: string }> {
  if (type === "me") {
    if (!me || !validCoord(me.lat, -90, 90) || !validCoord(me.lng, -180, 180)) return { ok: false, error: "I don't have your location. Tap USE MY LOCATION and allow it, or search around your hotel instead." };
    return { ok: true, anchor: { kind: "me", label: "where you are", point: { lat: me.lat, lng: me.lng } } };
  }
  // ANYWHERE: a place the traveller typed and picked (Delhivery autosuggest/geocode). The point rides along with the request.
  if (type === "anywhere") {
    if (!me || !validCoord(me.lat, -90, 90) || !validCoord(me.lng, -180, 180)) return { ok: false, error: "Pick a place from the suggestions first." };
    return { ok: true, anchor: { kind: "anywhere", label: (me.label ?? "that place").slice(0, 80), point: { lat: me.lat, lng: me.lng } } };
  }
  const a = await anchorsFor(tripId, userId);
  if (type === "stay") return a.stay ? { ok: true, anchor: a.stay } : { ok: false, error: "There's no confirmed stay yet, so there's no hotel to search around." };
  if (type === "arrival") return a.arrival ? { ok: true, anchor: a.arrival } : { ok: false, error: "You haven't confirmed an arrival point yet. Add your journey in My Clockwise." };
  return a.destination ? { ok: true, anchor: a.destination } : { ok: false, error: "No destination to centre this on yet." };
}

export type AroundPlace = {
  provider: string;
  providerPlaceId: string;
  name: string;
  address: string | null;
  lat: number;
  lng: number;
  categories: string[];
  distanceMeters: number | null;
  walkMinutes: number | null;
  // Provider fields, shown only when present.
  openingHours: string | null;
  // Computed server-side from openingHours against the destination's local clock; absent when not evaluated.
  hoursNow?: HoursStatus;
  website: string | null;
  phone: string | null;
  retrievedAt: string;
};

export type AroundResult =
  | { ok: true; anchor: AroundAnchor; category: string; places: AroundPlace[]; retrievedAt: string; note?: string }
  | { ok: false; error: string };

type Raw = Awaited<ReturnType<typeof searchNearby>>[number];
export const toAroundPlace = (r: Raw): AroundPlace => ({
  provider: r.provider,
  providerPlaceId: r.providerId,
  name: r.name,
  address: r.formattedAddress,
  lat: r.latitude,
  lng: r.longitude,
  categories: r.categories,
  distanceMeters: r.distanceMeters,
  walkMinutes: null,
  openingHours: r.openingHours ?? null,
  website: r.website ?? null,
  phone: r.phone ?? null,
  retrievedAt: r.retrievedAt,
});

export async function withWalking(anchor: LatLng, places: AroundPlace[]): Promise<AroundPlace[]> {
  const top = places.slice(0, 12);
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
  return [...timed, ...places.slice(12)];
}

// ONE place that decides how a place search widens: close first; if little comes back, a bigger radius; then the SAME
// intent in wider provider categories. Used by Around You and the chat agent so they can never disagree.
export async function ladderSearch(category: string, point: LatLng, opts: { diet?: "vegetarian" | "vegan" | "halal"; radiusM?: number; limit?: number } = {}) {
  const radii = opts.radiusM ? [opts.radiusM] : [1500, 4000, 10000];
  const usable = (r: { name: string }[]) => r.filter((x) => x.name !== "Unnamed place").length;
  let raw: Awaited<ReturnType<typeof searchNearby>> = [];
  let usedRadius = radii[0];
  let broadened = false;
  for (const radius of radii) {
    raw = await searchNearby(category, point, radius, opts.limit ?? 15, opts.diet);
    usedRadius = radius;
    if (usable(raw) >= 3) break;
  }
  if (usable(raw) < 3 && BROAD_CATEGORIES[category] && !opts.diet) {
    const wide = await searchNearbyRaw(BROAD_CATEGORIES[category], point, radii[radii.length - 1], opts.limit ?? 15);
    const seen = new Set(raw.map((r) => r.providerId));
    raw = [...raw, ...wide.filter((w) => !seen.has(w.providerId))];
    broadened = wide.length > 0;
    usedRadius = radii[radii.length - 1];
  }
  // Attractions: transit gates and bare junctions are real map objects but not things to do.
  if (category === "attraction") raw = raw.filter((r) => /[A-Za-z]/.test(r.name) && !/\b(gate|chowk|metro|station|bus stop|junction)\b/i.test(r.name));
  return { raw, usedRadius, broadened };
}

export async function searchAroundPoint(anchor: AroundAnchor, category: string, opts: { diet?: "vegetarian" | "vegan" | "halal"; radiusM?: number; limit?: number } = {}): Promise<AroundResult> {
  if (!isGeoapifyConfigured()) return { ok: false, error: "Place search isn't connected in this environment." };
  if (!(category in NEARBY_CATEGORIES)) return { ok: false, error: `Unknown category "${category}".` };
  // An empty answer is only given when the widest search genuinely found nothing.
  let raw: Awaited<ReturnType<typeof searchNearby>>;
  let usedRadius: number;
  let broadened: boolean;
  try {
    ({ raw, usedRadius, broadened } = await ladderSearch(category, anchor.point, opts));
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Place search failed." };
  }
  const all = raw.map(toAroundPlace);
  // A POI with no name (just a street) is real but not useful; keep it only when there is little else.
  const named = all.filter((p) => p.name !== "Unnamed place");
  const base = named.length >= 3 ? named : all;
  const routed = await withWalking(anchor.point, base);
  // Closest by the provider's own walking time first; places beyond the routed set keep provider order.
  // A walk of more than 45 minutes is not a walk: show the distance instead of a misleading "90 min walk".
  const walkable = routed.map((p) => (p.walkMinutes != null && p.walkMinutes > 45 ? { ...p, walkMinutes: null } : p));
  const places = [...walkable.filter((p) => p.walkMinutes != null).sort((a, b) => a.walkMinutes! - b.walkMinutes!), ...walkable.filter((p) => p.walkMinutes == null).sort((a, b) => (a.distanceMeters ?? 1e9) - (b.distanceMeters ?? 1e9))];
  const note = places.length === 0 ? undefined : broadened ? `Little matched closely, so I widened the search to everything in this area that fits "${category}" (up to ${usedRadius / 1000} km).` : usedRadius > 1500 ? `Widened to ${usedRadius / 1000} km to find enough real places.` : undefined;
  return { ok: true, anchor, category, places, retrievedAt: raw[0]?.retrievedAt ?? new Date().toISOString(), note };
}

export async function searchAround(tripId: string, category: string, opts: { diet?: "vegetarian" | "vegan" | "halal"; radiusM?: number; limit?: number } = {}): Promise<AroundResult> {
  const anchor = await getAroundAnchor(tripId);
  if (!anchor) return { ok: false, error: "No destination or stay to centre this on yet." };
  return searchAroundPoint(anchor, category, opts);
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
  const all: AroundPlace[] = rows.map(toAroundPlace);
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

// WHY Clockwise surfaced a place: only ever a match between provider data and the
// traveller's own private Vibe Check answers. No qualitative claim about the venue.
const VIBE_BY_CATEGORY: Record<string, { energy?: string[]; nearby?: string; label: string }> = {
  cafe: { energy: ["CAFES", "SLOW_MORNINGS"], nearby: "cafe", label: "cafés" },
  restaurant: { energy: ["FOOD"], nearby: "restaurant", label: "food" },
  shopping: { energy: ["SHOPPING"], nearby: "shopping", label: "shopping" },
  attraction: { energy: ["CLASSICS", "PRETTY", "HIDDEN_GEMS"], nearby: "attraction", label: "sights" },
  park: { energy: ["NATURE", "PRETTY"], nearby: "park", label: "parks" },
  nightlife: { energy: ["NIGHTLIFE"], nearby: "nightlife", label: "nightlife" },
  convenience: { nearby: "convenience", label: "convenience stores" },
  supermarket: { nearby: "supermarket", label: "supermarkets" },
  pharmacy: { nearby: "pharmacy", label: "pharmacies" },
  atm: { nearby: "atm", label: "ATMs" },
};

const ENERGY_WORDS: Record<string, string> = { CAFES: "cafés", SLOW_MORNINGS: "slow mornings", FOOD: "food", SHOPPING: "shopping", PRETTY: "pretty places", CLASSICS: "classics", HIDDEN_GEMS: "hidden gems", NATURE: "nature", NIGHTLIFE: "nightlife", MUSEUMS: "museums" };
export function whyPicked(category: string, prefs: { energy?: string[]; nearby?: string[]; food?: string[] }, diet?: string | null): string | null {
  const v = VIBE_BY_CATEGORY[category];
  const parts: string[] = [];
  if (diet) parts.push(`it came from Geoapify's ${diet} search`);
  if (v) {
    const hitNearby = v.nearby && prefs.nearby?.includes(v.nearby);
    const hitEnergy = v.energy?.filter((e) => prefs.energy?.includes(e)) ?? [];
    if (hitNearby || hitEnergy.length) {
      // De-duplicated phrases: "cafés" must not appear twice just because two picks mean it.
      const phrases = [...new Set([...(hitNearby ? [v.label] : []), ...hitEnergy.map((e) => ENERGY_WORDS[e] ?? e.toLowerCase().replace(/_/g, " "))])];
      parts.push(`it matches your ${phrases.join(" + ")} ${phrases.length > 1 ? "picks" : "pick"}`);
    }
  }
  if (!parts.length) return null;
  const s = parts.join(" and ");
  return s[0].toUpperCase() + s.slice(1) + ".";
}

// Category order from the traveller's own Vibe Check: Nearby picks, then travel-energy
// matches, then everything else. Pure.
const ENERGY_TO_CATEGORY: Record<string, string> = { CAFES: "cafe", SLOW_MORNINGS: "cafe", FOOD: "restaurant", SHOPPING: "shopping", PRETTY: "attraction", CLASSICS: "attraction", HIDDEN_GEMS: "attraction", NATURE: "park", NIGHTLIFE: "nightlife", MUSEUMS: "museum" };
export function orderCategories(all: string[], prefs: { energy?: string[]; nearby?: string[] }): string[] {
  const mine = [...(prefs.nearby ?? []), ...(prefs.energy ?? []).map((e) => ENERGY_TO_CATEGORY[e]).filter(Boolean)].filter((c, i, arr) => arr.indexOf(c) === i);
  return [...mine.filter((c) => all.includes(c) || c === "museum"), ...all.filter((c) => !mine.includes(c))];
}
