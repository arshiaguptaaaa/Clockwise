// Runs a parsed PlaceIntent against REAL providers and returns place cards. Nothing here is written by a model:
// every name, address, tag and distance comes from a provider response, every anchor is the one the person
// named, and the card says which provider answered.
//
// Provider chain (never scraped, never invented):
//   anchor lookup  Delhivery Autosuggest/Geocode -> Geoapify (labelled fallback when Delhivery is rate-limited)
//   places         Geoapify Places (the configured POI source). Google Places is NOT configured in this project,
//                  so it is reported as "not configured" in the chain rather than faked.
import { prisma } from "@/lib/prisma";
import { NEARBY_CATEGORIES, BROAD_CATEGORIES, searchNearbyRaw, isGeoapifyConfigured } from "./geoapify-provider";
import { anchorsFor, ladderSearch, withWalking, toAroundPlace, type AroundAnchor, type AroundPlace } from "./around";
import { suggestPlaces, pointForSuggestion } from "./locate";
import { resolveTripLocationText, isResolveFailure } from "./resolve";
import { hoursAt } from "./hours";
import { localNow } from "@/lib/when";
import type { PlaceIntent, Keyword } from "./place-intent";
import type { LatLng, PlaceResult } from "./types";

export type CardPlace = {
  name: string;
  formattedAddress: string | null;
  distanceMeters: number | null;
  latitude: number;
  longitude: number;
  walkMinutes: number | null;
  category: string | null;
  hours: string | null;
  provider: string;
  mapsUrl: string;
  matched: string | null; // why this one is shown for the keyword: "tagged dosa" / "name says South Indian"
  vegFriendly: boolean | null;
  // "Vegetarian-friendly · South Indian · 12 min walk from your stay": only facts the provider data and routes support.
  why: string | null;
  providerPlaceId: string;
};

export type ChainStep = { step: string; provider: string; status: "ok" | "rate_limited" | "fallback" | "not_configured" | "skipped" | "failed"; detail?: string };

export type PlaceSearchOutcome =
  | {
      ok: true;
      anchor: AroundAnchor;
      anchorWhy: string;
      title: string;
      context: string;
      places: CardPlace[];
      chain: ChainStep[];
      provider: string;
      retrievedAt: string;
      keywordMatches: number;
      diet: "vegetarian" | "vegan" | "halal" | null;
      dietWhy: string | null;
      category: string;
    }
  | { ok: false; error: string; needsLocation?: boolean; chain?: ChainStep[] };

const first = (n: string) => n.split(/\s+/)[0] ?? n;
const lc = (s: string) => s.toLowerCase();
const mapsUrl = (lat: number, lng: number) => `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;

const CATEGORY_LABEL: Record<string, string> = { restaurant: "Restaurant", cafe: "Café", attraction: "Sight", shopping: "Shopping", park: "Park", museum: "Museum", nightlife: "Bar", pharmacy: "Pharmacy", atm: "ATM", supermarket: "Supermarket", convenience: "Convenience store" };

function humanCategory(categories: string[], cuisine: string | null, fallback: string): string {
  const c = categories.join(" ");
  const cu = cuisine ? cuisine.split(";")[0].replace(/_/g, " ") : null;
  const base = /cafe/.test(c) ? "Café" : /fast_food/.test(c) ? "Quick bites" : /food_court/.test(c) ? "Food court" : /restaurant/.test(c) ? "Restaurant" : /bar|pub/.test(c) ? "Bar" : /park/.test(c) ? "Park" : /museum/.test(c) ? "Museum" : /attraction|sights/.test(c) ? "Sight" : /shopping|commercial/.test(c) ? "Shopping" : (CATEGORY_LABEL[fallback] ?? "Place");
  return cu ? `${cu.replace(/^./, (x) => x.toUpperCase())} · ${base.toLowerCase()}` : base;
}

// ---- anchors ---------------------------------------------------------------------------------------------

async function resolveExplicit(text: string, tripId: string, userId: string, chain: ChainStep[]): Promise<{ ok: true; anchor: AroundAnchor; why: string } | { ok: false; error: string }> {
  const anchors = await anchorsFor(tripId, userId);
  // The trip's own destination first, so "Bengaluru" means the trip's Bengaluru, not another one.
  const stored = await resolveTripLocationText(text, tripId).catch(() => null);
  const sug = await suggestPlaces(text, { bias: anchors.destination?.point ?? null, tripId, userId });
  if (sug.ok && sug.suggestions.length > 0) {
    const want = lc(text);
    const pick = sug.suggestions.find((s) => lc(s.label) === want) ?? sug.suggestions.find((s) => lc(s.label).startsWith(want)) ?? sug.suggestions[0];
    const pt = await pointForSuggestion(pick.label, pick.lat != null && pick.lng != null ? { lat: pick.lat, lng: pick.lng } : null, { tripId, userId });
    if (pt) {
      chain.push({ step: "anchor", provider: sug.provider, status: sug.provider === "delhivery" ? "ok" : "fallback", detail: sug.note ?? undefined });
      return { ok: true, anchor: { kind: "anywhere", label: pick.label.split(",")[0], point: pt.point }, why: `${pick.label.split(",")[0]} (the place you named)` };
    }
  }
  if (stored && !isResolveFailure(stored)) {
    chain.push({ step: "anchor", provider: "geoapify", status: "fallback", detail: sug.ok ? sug.note ?? undefined : undefined });
    return { ok: true, anchor: { kind: "anywhere", label: stored.label.split(",")[0], point: stored.point }, why: `${stored.label.split(",")[0]} (the place you named)` };
  }
  return { ok: false, error: `I couldn't find "${text}" on the map. Try a fuller name, like the area and the city.` };
}

export async function resolveIntentAnchor(tripId: string, userId: string, intent: PlaceIntent, me: (LatLng & { label?: string }) | null | undefined, chain: ChainStep[]): Promise<{ ok: true; anchor: AroundAnchor; why: string } | { ok: false; error: string; needsLocation?: boolean }> {
  const spec = intent.anchor;
  const a = await anchorsFor(tripId, userId);
  if (spec.kind === "me") {
    if (!me) return { ok: false, needsLocation: true, error: "I'd need your location for that. Open Around, then tap USE MY LOCATION. It stays private to you. Or name a place or area and I'll search around that." };
    return { ok: true, anchor: { kind: "me", label: "where you are", point: me }, why: "where you are now" };
  }
  if (spec.kind === "stay") {
    if (!a.stay) return { ok: false, error: "There's no confirmed stay yet, so there's no hotel to search around. Name an area, or I can search around the destination if you ask." };
    return { ok: true, anchor: a.stay, why: `${a.stay.label} (your confirmed stay)` };
  }
  if (spec.kind === "destination") {
    if (!a.destination) return { ok: false, error: "The trip has no destination point yet. Name a place to search around." };
    return { ok: true, anchor: a.destination, why: `${a.destination.label.split(",")[0]} (the trip's destination)` };
  }
  if (spec.kind === "arrival") {
    let uid = userId;
    let who: string | null = null;
    if (spec.person) {
      const members = await prisma.tripMember.findMany({ where: { tripId }, include: { user: { select: { id: true, name: true } } } });
      const m = members.find((x) => lc(first(x.user.name)) === lc(spec.person!));
      if (!m) return { ok: false, error: `I don't see anyone called ${spec.person} on this trip.` };
      uid = m.userId;
      who = first(m.user.name);
    }
    const arr = uid === userId ? a.arrival : (await anchorsFor(tripId, uid)).arrival;
    if (arr) return { ok: true, anchor: arr, why: `${arr.label.replace(/ International Airport$/, "")} (${who ? `${who}'s` : "your"} confirmed arrival)` };
    if (spec.airportText) {
      const r = await resolveExplicit(spec.airportText, tripId, userId, chain);
      if (r.ok) return { ok: true, anchor: r.anchor, why: `${r.anchor.label} (you named it; no confirmed arrival on file)` };
    }
    return { ok: false, error: who ? `${who} hasn't confirmed an arrival point yet, so I won't guess where they land.` : "You haven't confirmed an arrival point yet. Add your journey under You, or name the place." };
  }
  return resolveExplicit(spec.text, tripId, userId, chain);
}

// ---- search ----------------------------------------------------------------------------------------------

function scoreKeyword(p: PlaceResult, kw: Keyword): { score: number; why: string | null } {
  const name = lc(p.name);
  const cuisine = lc(p.cuisine ?? "");
  const cats = lc(p.categories.join(" "));
  const syn = kw.synonyms.map(lc);
  let score = 0;
  let why: string | null = null;
  if (syn.some((s) => cuisine.includes(s.replace(/ /g, "_")) || cuisine.includes(s))) {
    score += 4;
    why = `provider tags it ${(p.cuisine ?? "").split(";")[0].replace(/_/g, " ")}`;
  }
  if (syn.some((s) => name.includes(s))) {
    score += 3;
    why = why ?? `name says ${syn.find((s) => name.includes(s))}`;
  }
  if (score === 0 && /indian/.test(cats) && /(dosa|idli|south|biryani|thali)/.test(lc(kw.word))) score += 0.5;
  return { score, why };
}

function toCard(p: PlaceResult, walk: number | null, category: string, now: Date, match: { why: string | null }, vegFriendly: boolean | null): CardPlace {
  const h = p.openingHours ? hoursAt(p.openingHours, now) : null;
  const hours = h ? (h.state === "open" ? `Open${h.until ? ` · until ${h.until}` : ""}` : h.state === "closed" ? `Closed${h.opensAt ? ` · opens ${h.opensAt}` : ""}` : null) : null;
  return {
    name: p.name,
    formattedAddress: p.formattedAddress,
    distanceMeters: p.distanceMeters,
    latitude: p.latitude,
    longitude: p.longitude,
    walkMinutes: walk,
    category: humanCategory(p.categories, p.cuisine ?? null, category),
    hours,
    provider: p.provider,
    mapsUrl: mapsUrl(p.latitude, p.longitude),
    matched: match.why,
    vegFriendly,
    why: null,
    providerPlaceId: p.providerId,
  };
}

const FOOD_BASE = "catering.restaurant,catering.fast_food,catering.food_court,catering.cafe";

export async function searchForIntent(params: { tripId: string; userId: string; intent: PlaceIntent; me?: (LatLng & { label?: string }) | null; groupDiet?: { diet: "vegetarian" | "vegan"; names: string[] } | null; anchorOverride?: { anchor: AroundAnchor; why: string } | null }): Promise<PlaceSearchOutcome> {
  const { tripId, userId, intent } = params;
  const chain: ChainStep[] = [];
  if (!isGeoapifyConfigured()) return { ok: false, error: "Place search isn't connected in this environment.", chain: [{ step: "places", provider: "geoapify", status: "not_configured" }] };
  const category = intent.category && intent.category in NEARBY_CATEGORIES ? intent.category : intent.keyword?.category ?? null;
  if (!category) return { ok: false, error: "What kind of place? Try coffee, dosa, shopping or things to do." };

  const located = params.anchorOverride ? ({ ok: true, anchor: params.anchorOverride.anchor, why: params.anchorOverride.why } as const) : await resolveIntentAnchor(tripId, userId, intent, params.me, chain);
  if (!located.ok) return { ok: false, error: located.error, needsLocation: "needsLocation" in located ? located.needsLocation : undefined, chain };
  const anchor = located.anchor;

  // Explicit diet in the words wins; otherwise the group's stated diet steers a FOOD search (and says so).
  const foodish = category === "restaurant" || category === "cafe";
  const diet = intent.diet ?? (foodish && params.groupDiet ? params.groupDiet.diet : null);
  const dietWhy = intent.diet ? `you asked for ${intent.diet}` : foodish && params.groupDiet ? `${params.groupDiet.names.join(" and ")} ${params.groupDiet.names.length > 1 ? "are" : "is"} ${params.groupDiet.diet}` : null;

  let raw: PlaceResult[] = [];
  let widened = false;
  let keywordMatches = 0;
  let ranked: { p: PlaceResult; score: number; why: string | null; veg: boolean }[] = [];
  try {
    if (intent.keyword) {
      const kw = intent.keyword;
      const cats = kw.category === "cafe" ? "catering.cafe,catering.fast_food,catering.restaurant" : FOOD_BASE;
      const [all, vegOnly] = await Promise.all([
        searchNearbyRaw(cats, anchor.point, 8000, 60),
        diet ? searchNearbyRaw(cats, anchor.point, 8000, 40, diet).catch(() => [] as PlaceResult[]) : Promise.resolve([] as PlaceResult[]),
      ]);
      const vegIds = new Set(vegOnly.map((v) => v.providerId));
      const pool = [...all, ...vegOnly.filter((v) => !all.some((a) => a.providerId === v.providerId))];
      raw = pool;
      ranked = pool
        .filter((p) => p.name !== "Unnamed place")
        .map((p) => {
          const k = scoreKeyword(p, kw);
          const veg = vegIds.has(p.providerId) || (p.dietTags ?? []).some((t) => /vegetarian|vegan/.test(t));
          return { p, score: k.score + (diet && veg ? 1.5 : 0), why: k.why, veg };
        });
      const matched = ranked.filter((r) => r.score >= 3).sort((a, b) => b.score - a.score || (a.p.distanceMeters ?? 1e9) - (b.p.distanceMeters ?? 1e9));
      keywordMatches = matched.length;
      // If the provider's data names few places for this dish, fill up with its closest related places and SAY so.
      const rest = ranked
        .filter((r) => r.score < 3 && (r.score > 0 || /indian|south/.test(lc(r.p.categories.join(" ")) + lc(r.p.cuisine ?? "")) || (diet && r.veg)))
        .sort((a, b) => b.score - a.score || (a.p.distanceMeters ?? 1e9) - (b.p.distanceMeters ?? 1e9));
      ranked = [...matched, ...rest].slice(0, 8);
      widened = matched.length < 3;
    } else {
      const ladder = await ladderSearch(category, anchor.point, { diet: diet ?? undefined, limit: 12 });
      raw = ladder.raw;
      widened = ladder.broadened || ladder.usedRadius > 1500;
      ranked = ladder.raw
        .filter((p) => p.name !== "Unnamed place")
        .map((p) => ({ p, score: 0, why: null as string | null, veg: Boolean(diet) }))
        .sort((a, b) => (a.p.distanceMeters ?? 1e9) - (b.p.distanceMeters ?? 1e9))
        .slice(0, 8);
    }
    chain.push({ step: "places", provider: "geoapify", status: "ok" });
  } catch (err) {
    chain.push({ step: "places", provider: "geoapify", status: "failed", detail: err instanceof Error ? err.message.slice(0, 80) : "error" });
    return { ok: false, error: "Place search is unavailable right now. Nothing was made up; try again in a moment.", chain };
  }
  chain.push({ step: "places", provider: "google_places", status: "not_configured", detail: "no Google Places credentials in this project" });

  if (ranked.length === 0) {
    return { ok: true, anchor, anchorWhy: located.why, title: titleFor(intent, category, anchor), context: `The provider's data has no ${intent.what ?? category} places within about 8 km of ${anchor.label}.`, places: [], chain, provider: "geoapify", retrievedAt: new Date().toISOString(), keywordMatches: 0, diet, dietWhy, category };
  }

  // Walking time from the anchor, by the provider's own route; nothing is converted from straight-line distance.
  const aroundPlaces: AroundPlace[] = ranked.map((r) => toAroundPlace(r.p as never));
  const walked = await withWalking(anchor.point, aroundPlaces);
  const nowLocal = localNow();
  const now = new Date(`${nowLocal.date}T${nowLocal.time}:00Z`);
  const places = ranked.map((r, i) => {
    const w = walked[i]?.walkMinutes ?? null;
    const card = toCard(r.p, w != null && w <= 30 ? w : null, category, now, { why: r.score >= 3 ? r.why : null }, diet ? r.veg : null);
    const from = anchor.kind === "stay" ? "your stay" : anchor.label;
    const parts = [diet && r.veg ? `${diet.replace(/^./, (c) => c.toUpperCase())}-friendly` : null, r.score >= 3 && intent.what ? intent.what.replace(/^./, (c) => c.toUpperCase()) : null, card.walkMinutes != null ? `${card.walkMinutes} min walk from ${from}` : card.distanceMeters != null ? `${(card.distanceMeters / 1000).toFixed(1)} km from ${from}` : null].filter(Boolean);
    card.why = parts.length >= 2 ? parts.join(" · ") : null;
    return card;
  });

  const retrievedAt = raw[0]?.retrievedAt ?? new Date().toISOString();
  const what = intent.what ?? CATEGORY_LABEL[category]?.toLowerCase() ?? category;
  const bits: string[] = [];
  if (intent.keyword) {
    bits.push(keywordMatches >= 3 ? `${keywordMatches} places the provider's data tags or names as ${what}.` : keywordMatches > 0 ? `Only ${keywordMatches} place${keywordMatches === 1 ? " is" : "s are"} tagged or named ${what} in the provider's data; the rest are the closest related restaurants.` : `No place is tagged or named ${what} in the provider's data here, so these are the closest related restaurants. They may or may not serve it.`);
  } else if (widened) bits.push("Widened the search to find enough real places.");
  if (diet) bits.push(`Found using Geoapify's ${diet} search${dietWhy ? ` (${dietWhy})` : ""}. That's a provider filter, not a check of each menu.`);
  return { ok: true, anchor, anchorWhy: located.why, title: titleFor(intent, category, anchor), context: bits.join(" "), places, chain, provider: "geoapify", retrievedAt, keywordMatches, diet, dietWhy, category };
}

function titleFor(intent: PlaceIntent, category: string, anchor: AroundAnchor) {
  const what = intent.what ? intent.what.replace(/^./, (c) => c.toUpperCase()) : (CATEGORY_LABEL[category] ?? category).replace(/^./, (c) => c.toUpperCase()) + "s";
  const near = anchor.kind === "stay" ? "your stay" : anchor.label;
  return `${what} near ${near}`;
}

// Travellers who said they're vegetarian/vegan (a pointer or a stored food preference): the group's diet for ranking.
export async function groupDietFor(tripId: string): Promise<{ diet: "vegetarian" | "vegan"; names: string[] } | null> {
  const [prefs, pointers] = await Promise.all([
    prisma.travellerPreference.findMany({ where: { tripId, key: "FOOD", value: { in: ["VEGETARIAN", "VEGAN"] } }, select: { userId: true, value: true } }),
    prisma.tripPointer.findMany({ where: { tripId, kind: "DIET", subject: { in: ["vegetarian", "vegan"] }, status: { not: "DISMISSED" } }, select: { userId: true, subject: true } }),
  ]);
  const ids = new Map<string, "vegetarian" | "vegan">();
  for (const p of prefs) ids.set(p.userId, p.value === "VEGAN" ? "vegan" : "vegetarian");
  for (const p of pointers) if (!ids.has(p.userId)) ids.set(p.userId, p.subject === "vegan" ? "vegan" : "vegetarian");
  if (ids.size === 0) return null;
  const users = await prisma.user.findMany({ where: { id: { in: [...ids.keys()] } }, select: { id: true, name: true } });
  return { diet: [...ids.values()].includes("vegetarian") ? "vegetarian" : "vegan", names: users.map((u) => first(u.name)) };
}

export { CATEGORY_LABEL, BROAD_CATEGORIES };
