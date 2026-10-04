// WHERE IS "HERE"? Resolving places and positions for Around You and routing.
// Delhivery Maps resolves first (autosuggest, geocode, reverse geocode). Geoapify is the labelled
// fallback when Delhivery is unavailable or rate-limited, and the result always says which one answered.
// Geoapify stays the place-DISCOVERY provider (cafés, restaurants...) - that is elsewhere.
//
// A live position is the traveller's private state: coordinates come in for ONE call, the result is a
// locality NAME, and neither the coordinates nor a trail of them is stored or logged.
import { delhiverySuggest, delhiveryGeocode, delhiveryReverse, isDelhiveryConfigured, inIndia, type Suggestion } from "@/lib/delhivery/client";
import { geocodeCandidates, isGeoapifyConfigured } from "./geoapify-provider";
import type { LatLng } from "./types";

export type SuggestedPlace = { id: string; label: string; secondary: string | null; lat: number | null; lng: number | null };
export type SuggestOutcome =
  | { ok: true; provider: "delhivery" | "geoapify"; suggestions: SuggestedPlace[]; note: string | null; evidenceId: string | null }
  | { ok: false; error: string };

const cache = new Map<string, { at: number; value: SuggestOutcome }>();
const TTL = 5 * 60_000;

const toPlace = (s: Suggestion): SuggestedPlace => ({ id: s.id, label: s.label, secondary: s.secondary, lat: s.point?.lat ?? null, lng: s.point?.lng ?? null });

export async function suggestPlaces(query: string, opts: { bias?: LatLng | null; tripId?: string | null; userId?: string | null } = {}): Promise<SuggestOutcome> {
  const q = query.trim();
  if (q.length < 3) return { ok: true, provider: "delhivery", suggestions: [], note: null, evidenceId: null };
  const key = q.toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.value;

  let note: string | null = null;
  if (isDelhiveryConfigured()) {
    const r = await delhiverySuggest(q, opts.bias ?? null, { decision: "Anywhere search: resolve what the traveller typed", tripId: opts.tripId, userId: opts.userId });
    if (r.ok && r.suggestions.length > 0) {
      const value: SuggestOutcome = { ok: true, provider: "delhivery", suggestions: r.suggestions.slice(0, 6).map(toPlace), note: null, evidenceId: r.evidenceId };
      cache.set(key, { at: Date.now(), value });
      return value;
    }
    note = r.ok ? "Delhivery had no match, so these come from Geoapify." : r.blocked === "DELHIVERY_RATE_LIMITED" || r.httpStatus === 429 ? "Delhivery is rate-limiting this access token right now, so these come from Geoapify." : `Delhivery couldn't answer (${r.blocked ?? r.error}), so these come from Geoapify.`;
  } else note = "Delhivery isn't connected here, so these come from Geoapify.";

  if (!isGeoapifyConfigured()) return { ok: false, error: "No place-search provider is available right now." };
  try {
    const c = await geocodeCandidates(q, { bias: opts.bias ?? undefined, limit: 6 });
    const value: SuggestOutcome = { ok: true, provider: "geoapify", suggestions: c.map((x) => ({ id: x.placeId ?? x.label, label: x.name || x.label, secondary: x.label !== x.name ? x.label : null, lat: x.lat, lng: x.lng })), note, evidenceId: null };
    // A fallback answer is not cached for long: Delhivery is retried soon.
    cache.set(key, { at: Date.now() - TTL + 30_000, value });
    return value;
  } catch {
    return { ok: false, error: "Place search is unavailable right now." };
  }
}

// A chosen suggestion without a coordinate gets one from Delhivery's geocoder (then Geoapify).
export async function pointForSuggestion(label: string, known: LatLng | null, ctx: { tripId?: string | null; userId?: string | null } = {}): Promise<{ point: LatLng; provider: string } | null> {
  if (known) return { point: known, provider: "as suggested" };
  if (isDelhiveryConfigured()) {
    const g = await delhiveryGeocode(label, { decision: "Anywhere search: coordinates for the chosen place", ...ctx });
    if (g.ok && g.point) return { point: g.point, provider: "delhivery" };
  }
  if (isGeoapifyConfigured()) {
    const c = await geocodeCandidates(label, { limit: 1 }).catch(() => []);
    if (c[0]) return { point: { lat: c[0].lat, lng: c[0].lng }, provider: "geoapify" };
  }
  return null;
}

export type Locality = { locality: string | null; city: string | null; state: string | null; provider: "delhivery" | "geoapify" };

export async function reverseLocality(p: LatLng, ctx: { tripId?: string | null; userId?: string | null } = {}): Promise<Locality | null> {
  if (isDelhiveryConfigured() && inIndia(p)) {
    const r = await delhiveryReverse(p, { decision: "ME: turn the traveller's position into a readable locality (coordinates not stored)", ...ctx }, true);
    if (r.ok && r.place && (r.place.locality || r.place.city)) return { locality: r.place.locality, city: r.place.city, state: r.place.state, provider: "delhivery" };
  }
  if (!isGeoapifyConfigured() || !process.env.GEOAPIFY_API_KEY) return null;
  try {
    const params = new URLSearchParams({ lat: String(p.lat), lon: String(p.lng), format: "json", apiKey: process.env.GEOAPIFY_API_KEY });
    const res = await fetch(`https://api.geoapify.com/v1/geocode/reverse?${params}`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const d = (await res.json()) as { results?: { suburb?: string; neighbourhood?: string; district?: string; city?: string; town?: string; state?: string }[] };
    const r = d.results?.[0];
    if (!r) return null;
    return { locality: r.suburb ?? r.neighbourhood ?? r.district ?? null, city: r.city ?? r.town ?? null, state: r.state ?? null, provider: "geoapify" };
  } catch {
    return null;
  }
}
