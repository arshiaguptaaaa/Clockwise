"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/session";
import { destinationSearchProvider } from "@/lib/destination-search/open-meteo-provider";
import { QUESTIONS, setPref, getPrefs, type QuestionId } from "@/lib/traveller/vibe";
import { confirmJourney, discardJourney, createPendingJourney, type JourneyFacts } from "@/lib/traveller/journey";
import { searchAroundPoint, brandSearch, resolveAnchor, anchorsFor, whyPicked, orderCategories, type AroundPlace, type AnchorType } from "@/lib/travel/around";
import { nextUpFor, freeTimeOptions, localNowZ, type NextUp, type FreeTime } from "@/lib/travel/window";
import { hoursAt } from "@/lib/travel/hours";
import { getRoute } from "@/lib/travel/geoapify-provider";
import { savedOverlaps } from "@/lib/travel/saved-overlap";
import { proposePlace, type PlaceRef } from "@/lib/places/place-proposals";
import type { TravelMode } from "@/lib/travel/types";
import { AROUND_CATEGORIES } from "@/lib/travel/around-categories";
import { suggestPlaces, pointForSuggestion, reverseLocality, type SuggestOutcome, type SuggestedPlace, type Locality } from "@/lib/travel/locate";
import { doesThisFit, type FitResult } from "@/lib/travel/fit";
import { parseDiscoveryQuery } from "@/lib/travel/discovery-query";
import { easiestForEveryone, type MeetupResult, type MeetCandidate } from "@/lib/travel/meetup";

async function member(tripId: string) {
  const userId = await getCurrentUserId();
  if (!userId) return null;
  const m = await prisma.tripMember.findFirst({ where: { tripId, userId }, select: { id: true } });
  return m ? userId : null;
}

// ---- Vibe Check (private) ---------------------------------------------------

export async function searchOriginAction(query: string) {
  if (!(await getCurrentUserId())) return [];
  const q = query.trim();
  if (q.length < 2) return [];
  try {
    const results = await destinationSearchProvider.search(q);
    return results.slice(0, 6).map((r) => ({ displayName: r.displayName, name: r.name, region: r.region, country: r.country, place: r }));
  } catch {
    return [];
  }
}

export async function saveVibeAnswerAction(tripId: string, id: QuestionId, values: string[], detail?: unknown): Promise<{ ok: boolean }> {
  const userId = await member(tripId);
  if (!userId || !QUESTIONS.some((q) => q.id === id)) return { ok: false };
  await setPref(tripId, userId, id, values, detail);
  return { ok: true };
}

export async function deferVibeAction(tripId: string): Promise<void> {
  const userId = await member(tripId);
  if (!userId) return;
  // "Later" never downgrades a completed vibe check.
  const existing = await prisma.vibeCheck.findUnique({ where: { tripId_userId: { tripId, userId } } });
  if (existing?.status === "COMPLETED") return;
  await prisma.vibeCheck.upsert({ where: { tripId_userId: { tripId, userId } }, create: { tripId, userId, status: "DEFERRED" }, update: { status: "DEFERRED" } });
}

export async function completeVibeAction(tripId: string): Promise<{ ok: boolean }> {
  const userId = await member(tripId);
  if (!userId) return { ok: false };
  await prisma.vibeCheck.upsert({ where: { tripId_userId: { tripId, userId } }, create: { tripId, userId, status: "COMPLETED", completedAt: new Date() }, update: { status: "COMPLETED", completedAt: new Date() } });
  const prefs = await getPrefs(tripId, userId);
  await prisma.tripEvent.create({
    data: {
      tripId,
      kind: "VIBE_CHECK_COMPLETED",
      scope: "PERSONAL",
      actorUserId: userId,
      subjectUserId: userId,
      sourceChannel: "SYSTEM",
      confidence: "HIGH",
      // Which questions were answered — never the answers.
      payload: JSON.stringify({ answered: Object.keys(prefs).filter((k) => k !== "originPlace") }),
      propagation: JSON.stringify(["my-clockwise", "around-you", "ready"]),
    },
  });
  // Deliberately NOT revalidating here: that would re-render the trip layout and unmount
  // the vibe check before the "GOT YOUR VIBE." screen is seen. The client refreshes on exit.
  return { ok: true };
}

// ---- Journey ------------------------------------------------------------------

export async function confirmJourneyAction(tripId: string, journeyId: string, edits?: Partial<JourneyFacts>): Promise<{ ok: boolean; error?: string }> {
  const userId = await member(tripId);
  if (!userId) return { ok: false, error: "Sign in first." };
  const r = await confirmJourney(journeyId, userId, edits);
  return r.ok ? { ok: true } : { ok: false, error: r.error };
}

export async function discardJourneyAction(tripId: string, journeyId: string): Promise<void> {
  const userId = await member(tripId);
  if (userId) await discardJourney(journeyId, userId);
}

// Typed by the traveller themselves: entering it IS the confirmation.
export async function addManualJourneyAction(tripId: string, facts: JourneyFacts): Promise<{ ok: boolean; error?: string }> {
  const userId = await member(tripId);
  if (!userId) return { ok: false, error: "Sign in first." };
  if (!facts.arriveLocal && !facts.departLocal) return { ok: false, error: "Add at least the arrival or departure time." };
  const j = await createPendingJourney(tripId, userId, facts, "MANUAL");
  const r = await confirmJourney(j.id, userId);
  return r.ok ? { ok: true } : { ok: false, error: r.error };
}

// ---- Ready? ------------------------------------------------------------------

export async function toggleChecklistAction(tripId: string, key: string, done: boolean): Promise<void> {
  const userId = await member(tripId);
  if (!userId) return;
  await prisma.checklistItem.upsert({ where: { tripId_userId_key: { tripId, userId, key } }, create: { tripId, userId, key, done }, update: { done } });
  revalidatePath(`/trips/${tripId}/agent/ready`);
}

// ---- Around You ----------------------------------------------------------------
// Current location is PRIVATE traveller state: it arrives with a request the
// traveller explicitly made, is used for that one search, and is never stored,
// logged or shown to the group. Trace events record THAT a search happened and
// from which kind of anchor, never the coordinates.

export type Me = { lat: number; lng: number; label?: string } | null;

async function personalEvent(tripId: string, userId: string, kind: string, payload: Record<string, unknown>) {
  await prisma.tripEvent
    .create({
      data: { tripId, kind, scope: "PERSONAL", actorUserId: userId, subjectUserId: userId, sourceChannel: "SYSTEM", confidence: "HIGH", payload: JSON.stringify(payload), propagation: JSON.stringify(["around-you"]) },
    })
    .catch(() => undefined);
}

export async function locationEventAction(tripId: string, step: "requested" | "granted" | "denied"): Promise<void> {
  const userId = await member(tripId);
  if (!userId) return;
  const kind = step === "requested" ? "LOCATION_REQUESTED" : step === "granted" ? "LOCATION_PERMISSION_GRANTED" : "LOCATION_PERMISSION_DENIED";
  await personalEvent(tripId, userId, kind, { source: "browser-geolocation", at: new Date().toISOString(), stored: false });
}

export type AroundResponse =
  | { ok: true; anchorType: AnchorType; anchorLabel: string; category: string; places: AroundPlace[]; why: Record<string, string>; retrievedAt: string; note?: string; saved: string[] }
  | { ok: false; error: string };

export type AnchorStatus = Record<"stay" | "arrival" | "destination", { available: boolean; label?: string }>;

export async function anchorStatusAction(tripId: string): Promise<AnchorStatus | null> {
  const userId = await member(tripId);
  if (!userId) return null;
  const a = await anchorsFor(tripId, userId);
  return {
    stay: { available: Boolean(a.stay), label: a.stay?.label },
    arrival: { available: Boolean(a.arrival), label: a.arrival?.label },
    destination: { available: Boolean(a.destination), label: a.destination?.label },
  };
}

async function savedIds(tripId: string, userId: string) {
  return (await prisma.savedPlace.findMany({ where: { tripId, userId }, select: { providerPlaceId: true } })).map((s) => s.providerPlaceId);
}

// Open/closed NOW, from the provider's hours string and the destination's local clock. Unparseable or missing => left unknown.
async function annotateHours(places: AroundPlace[], at: { lat: number; lng: number }) {
  if (!places.some((p) => p.openingHours)) return;
  const now = await localNowZ(at);
  if (!now) return;
  for (const p of places) if (p.openingHours) p.hoursNow = hoursAt(p.openingHours, now);
}

export async function aroundSearchAction(tripId: string, category: string, opts: { diet?: "vegetarian" | "vegan" | "halal"; anchor: AnchorType; me?: Me }): Promise<AroundResponse> {
  const userId = await member(tripId);
  if (!userId) return { ok: false, error: "Sign in first." };
  if (!(category in AROUND_CATEGORIES)) return { ok: false, error: "Unknown category." };
  const a = await resolveAnchor(tripId, userId, opts.anchor, opts.me);
  if (!a.ok) return a;
  const r = await searchAroundPoint(a.anchor, category, { diet: opts.diet });
  if (!r.ok) return r;
  await annotateHours(r.places, a.anchor.point);
  const base = { provider: "geoapify", category, diet: opts.diet ?? null, anchorType: a.anchor.kind, resultCount: r.places.length, walkMinutesFromProvider: r.places.filter((p) => p.walkMinutes != null).length, retrievedAt: r.retrievedAt };
  // Hotel / destination / arrival anchors name a place; ME is recorded only as "current location".
  await personalEvent(tripId, userId, "PLACES_SEARCH_COMPLETED", { ...base, anchor: a.anchor.kind === "me" ? "current location (user-authorised)" : a.anchor.label, tool: "around-you" });
  if (a.anchor.kind === "me") await personalEvent(tripId, userId, "LOCATION_SEARCH_COMPLETED", { provider: "geoapify", category, resultCount: r.places.length, retrievedAt: r.retrievedAt, coordinatesStored: false });
  const prefs = await getPrefs(tripId, userId);
  const why: Record<string, string> = {};
  for (const p of r.places) {
    const w = whyPicked(category, { energy: prefs.energy, nearby: prefs.nearby, food: prefs.food }, opts.diet);
    if (w) why[p.providerPlaceId] = w;
  }
  return { ok: true, anchorType: a.anchor.kind, anchorLabel: a.anchor.label, category, places: r.places, why, retrievedAt: r.retrievedAt, note: opts.diet ? `Found using Geoapify's ${opts.diet} search. That's a provider filter, not a check of each place.` : r.note, saved: await savedIds(tripId, userId) };
}

export async function brandSearchAction(tripId: string, brand: string, opts: { anchor: AnchorType; me?: Me }): Promise<AroundResponse> {
  const userId = await member(tripId);
  if (!userId) return { ok: false, error: "Sign in first." };
  const q = brand.trim().slice(0, 60);
  if (!q) return { ok: false, error: "Type a store name." };
  const a = await resolveAnchor(tripId, userId, opts.anchor, opts.me);
  if (!a.ok) return a;
  const r = await brandSearch(tripId, q, a.anchor);
  if (!r.ok) return r;
  await annotateHours(r.places, a.anchor.point);
  await personalEvent(tripId, userId, "PLACES_SEARCH_COMPLETED", { provider: "geoapify", category: "brand", brand: q, anchorType: a.anchor.kind, anchor: a.anchor.kind === "me" ? "current location (user-authorised)" : a.anchor.label, resultCount: r.places.length, matchedBrand: r.found.length > 0, retrievedAt: r.retrievedAt, tool: "around-you" });
  if (a.anchor.kind === "me") await personalEvent(tripId, userId, "LOCATION_SEARCH_COMPLETED", { provider: "geoapify", category: "brand", resultCount: r.places.length, retrievedAt: r.retrievedAt, coordinatesStored: false });
  return { ok: true, anchorType: a.anchor.kind, anchorLabel: a.anchor.label, category: "convenience", places: r.places, why: {}, retrievedAt: r.retrievedAt, note: r.note, saved: await savedIds(tripId, userId) };
}

export type RouteLeg = { mode: TravelMode; distanceMeters: number; durationMinutes: number };
export type RouteResponse =
  | { ok: true; fromLabel: string; toLabel: string; legs: RouteLeg[]; geometry: { lat: number; lng: number }[] | null; retrievedAt: string }
  | { ok: false; error: string };

// ROUTE: anchor -> chosen place, every number from Geoapify routing. Only modes the
// provider actually returned are shown (walking and driving; a mode that errors is omitted).
export async function routeToPlaceAction(tripId: string, place: { name: string; lat: number; lng: number }, opts: { anchor: AnchorType; me?: Me }): Promise<RouteResponse> {
  const userId = await member(tripId);
  if (!userId) return { ok: false, error: "Sign in first." };
  const a = await resolveAnchor(tripId, userId, opts.anchor, opts.me);
  if (!a.ok) return a;
  const modes: TravelMode[] = ["walk", "drive"];
  const results = await Promise.all(modes.map((m) => getRoute(a.anchor.point, { lat: place.lat, lng: place.lng }, m).catch(() => null)));
  const legs: RouteLeg[] = [];
  results.forEach((r, i) => {
    if (r) legs.push({ mode: modes[i], distanceMeters: r.distanceMeters, durationMinutes: Math.max(1, Math.round(r.durationSeconds / 60)) });
  });
  if (legs.length === 0) return { ok: false, error: "Geoapify couldn't route to this place from here. I won't estimate it." };
  const retrievedAt = results.find(Boolean)!.retrievedAt;
  await personalEvent(tripId, userId, "ROUTE_COMPLETED", { provider: "geoapify", anchorType: a.anchor.kind, from: a.anchor.kind === "me" ? "current location (user-authorised)" : a.anchor.label, to: place.name, modes: legs.map((l) => ({ mode: l.mode, distanceMeters: Math.round(l.distanceMeters), durationMinutes: l.durationMinutes })), retrievedAt, tool: "around-you" });
  return { ok: true, fromLabel: a.anchor.kind === "me" ? "Where you are" : a.anchor.label, toLabel: place.name, legs, geometry: results[0]?.geometry ?? null, retrievedAt };
}

export async function toggleSavePlaceAction(tripId: string, place: AroundPlace, kind: string): Promise<{ ok: boolean; saved?: boolean; overlap?: number }> {
  const userId = await member(tripId);
  if (!userId) return { ok: false };
  const key = { tripId_userId_provider_providerPlaceId: { tripId, userId, provider: place.provider, providerPlaceId: place.providerPlaceId } };
  const existing = await prisma.savedPlace.findUnique({ where: key });
  if (existing) {
    await prisma.savedPlace.delete({ where: key });
    revalidatePath(`/trips/${tripId}/agent/saved`);
    return { ok: true, saved: false };
  }
  await prisma.savedPlace.create({ data: { tripId, userId, kind: kind.toUpperCase().slice(0, 20), provider: place.provider, providerPlaceId: place.providerPlaceId, name: place.name, address: place.address, latitude: place.lat, longitude: place.lng, retrievedAt: new Date(place.retrievedAt) } });
  await prisma.tripEvent.create({ data: { tripId, kind: "SAVED_PLACE_ADDED", scope: "PERSONAL", actorUserId: userId, subjectUserId: userId, sourceChannel: "SYSTEM", confidence: "HIGH", payload: JSON.stringify({ provider: place.provider, providerPlaceId: place.providerPlaceId, kind }), propagation: "[]" } }).catch(() => undefined);
  // Overlap is a COUNT, never names: it only exists once at least two travellers saved the same real place.
  const overlap = (await savedOverlaps(tripId, userId)).find((o) => o.providerPlaceId === place.providerPlaceId);
  if (overlap) {
    await prisma.tripEvent.create({ data: { tripId, kind: "PLACE_OVERLAP_DETECTED", scope: "PERSONAL", actorUserId: userId, subjectUserId: userId, sourceChannel: "SYSTEM", confidence: "HIGH", payload: JSON.stringify({ provider: place.provider, providerPlaceId: place.providerPlaceId, name: place.name, savedBy: overlap.count, members: overlap.members }), propagation: JSON.stringify(["saved"]) } }).catch(() => undefined);
  }
  revalidatePath(`/trips/${tripId}/agent/saved`);
  return { ok: true, saved: true, overlap: overlap?.count };
}

// PROPOSE TO GROUP: a real provider place becomes a group proposal (vote, then organiser confirm).
// Proposing is the traveller's own choice to go public; it never says who else saved the place.
export async function proposePlaceAction(tripId: string, place: AroundPlace, kind: string): Promise<{ ok: boolean; error?: string; duplicate?: boolean }> {
  const userId = await member(tripId);
  if (!userId) return { ok: false, error: "Sign in first." };
  const ref: PlaceRef = { provider: place.provider, providerPlaceId: place.providerPlaceId, name: place.name, address: place.address, latitude: place.lat, longitude: place.lng, retrievedAt: place.retrievedAt, kind: kind.toUpperCase().slice(0, 20) };
  const r = await proposePlace(tripId, userId, ref);
  revalidatePath(`/trips/${tripId}/room`);
  return r.ok ? { ok: true, duplicate: r.duplicate } : { ok: false, error: r.error };
}

// ---- Right now: the traveller's clock + where they are + what's next -----------

export async function nextUpAction(tripId: string, opts: { anchor: AnchorType; me?: Me }): Promise<{ ok: true; nextUp: NextUp | { none: string }; anchorType: AnchorType } | { ok: false; error: string }> {
  const userId = await member(tripId);
  if (!userId) return { ok: false, error: "Sign in first." };
  const a = await resolveAnchor(tripId, userId, opts.anchor, opts.me);
  if (!a.ok) return a;
  return { ok: true, nextUp: await nextUpFor(tripId, userId, a.anchor), anchorType: a.anchor.kind };
}

export async function freeTimeAction(tripId: string, opts: { anchor: AnchorType; me?: Me; minutes?: number }): Promise<(FreeTime & { anchorType: AnchorType }) | { ok: false; error: string }> {
  const userId = await member(tripId);
  if (!userId) return { ok: false, error: "Sign in first." };
  const a = await resolveAnchor(tripId, userId, opts.anchor, opts.me);
  if (!a.ok) return a;
  const prefs = await getPrefs(tripId, userId);
  const order = orderCategories(Object.keys(AROUND_CATEGORIES), prefs);
  const r = await freeTimeOptions(tripId, userId, a.anchor, { minutes: opts.minutes, categoryOrder: order, prefs: { energy: prefs.energy, nearby: prefs.nearby, food: prefs.food } });
  if (!r.ok) return r;
  await personalEvent(tripId, userId, "FREE_TIME_COMPUTED", { provider: "geoapify", weather: "open-meteo", anchorType: a.anchor.kind, windowMinutes: r.windowMinutes, windowSource: r.windowSource, considered: r.considered, fitting: r.options.length, rainyMode: r.rainyMode, retrievedAt: r.retrievedAt });
  return { ...r, anchorType: a.anchor.kind };
}


// ---- Anywhere, reverse geocoding, "does this fit?", "easiest for everyone" ----------------------

// ANYWHERE: type "Indiranagar" / "Hawa Mahal" / "Bangalore airport". Delhivery autosuggest answers first;
// the answer says if Geoapify had to step in. Biased to the destination so "Indiranagar" means Bengaluru's.
export async function suggestPlacesAction(tripId: string, query: string): Promise<SuggestOutcome> {
  const userId = await member(tripId);
  if (!userId) return { ok: false, error: "Sign in first." };
  const a = await anchorsFor(tripId, userId);
  return suggestPlaces(query.slice(0, 80), { bias: a.destination?.point ?? null, tripId, userId });
}

export async function chooseSuggestionAction(tripId: string, s: SuggestedPlace): Promise<{ ok: true; lat: number; lng: number; label: string; provider: string } | { ok: false; error: string }> {
  const userId = await member(tripId);
  if (!userId) return { ok: false, error: "Sign in first." };
  const known = s.lat != null && s.lng != null ? { lat: s.lat, lng: s.lng } : null;
  const r = await pointForSuggestion(s.label, known, { tripId, userId });
  if (!r) return { ok: false, error: "I couldn't place that on the map. Try a more specific name." };
  await personalEvent(tripId, userId, "ANYWHERE_RESOLVED", { label: s.label.slice(0, 80), provider: r.provider });
  return { ok: true, lat: r.point.lat, lng: r.point.lng, label: s.label, provider: r.provider };
}

// ME -> "YOU'RE AROUND Indiranagar". The coordinates are used for this one call and are neither stored nor logged.
export async function reverseLocalityAction(tripId: string, me: { lat: number; lng: number }): Promise<{ ok: true; locality: Locality } | { ok: false; error: string }> {
  const userId = await member(tripId);
  if (!userId) return { ok: false, error: "Sign in first." };
  if (!Number.isFinite(me?.lat) || !Number.isFinite(me?.lng)) return { ok: false, error: "No position." };
  const loc = await reverseLocality({ lat: me.lat, lng: me.lng }, { tripId, userId });
  await personalEvent(tripId, userId, "LOCATION_REVERSE_GEOCODED", { provider: loc?.provider ?? null, resolved: Boolean(loc), coordinatesStored: false, localityStored: false });
  return loc ? { ok: true, locality: loc } : { ok: false, error: "I couldn't turn your position into a place name." };
}

export async function fitCheckAction(tripId: string, place: { name: string; lat: number; lng: number; kind: string }, opts: { anchor: AnchorType; me?: Me; leaveLocal?: string | null }): Promise<FitResult> {
  const userId = await member(tripId);
  if (!userId) return { ok: false, error: "Sign in first." };
  const a = await resolveAnchor(tripId, userId, opts.anchor, opts.me);
  if (!a.ok) return a;
  const leave = opts.leaveLocal && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(opts.leaveLocal) ? opts.leaveLocal : null;
  const r = await doesThisFit({ tripId, userId, place: { name: place.name.slice(0, 120), lat: place.lat, lng: place.lng }, kind: place.kind, origin: { label: a.anchor.kind === "me" ? "where you are" : a.anchor.label, point: a.anchor.point }, leaveLocal: leave });
  if (r.ok) {
    await personalEvent(tripId, userId, "FIT_CHECKED", { place: r.place, verdict: r.verdict, routeProvider: r.routeProvider, reachChecked: r.reach.checked, reachInside: r.reach.inside, reachProvider: r.reach.provider, toMin: r.toMin, onMin: r.onMin, spareMin: r.spareMin, commitment: r.commitment?.name ?? null, whatIf: r.whatIf, evidenceIds: r.evidenceIds, anchorType: a.anchor.kind });
  }
  return r;
}

export async function meetupAction(tripId: string, places: AroundPlace[], opts: { me?: Me }): Promise<MeetupResult> {
  const userId = await member(tripId);
  if (!userId) return { ok: false, error: "Sign in first." };
  const candidates: MeetCandidate[] = places.slice(0, 6).map((p) => ({ providerPlaceId: p.providerPlaceId, name: p.name, lat: p.lat, lng: p.lng }));
  const r = await easiestForEveryone({ tripId, requesterId: userId, candidates, me: opts.me && Number.isFinite(opts.me.lat) ? { lat: opts.me.lat, lng: opts.me.lng } : null });
  if (r.ok) {
    await prisma.tripEvent
      .create({
        data: {
          tripId,
          kind: "MEETUP_RANKED",
          scope: "PERSONAL",
          actorUserId: userId,
          subjectUserId: userId,
          sourceChannel: "SYSTEM",
          confidence: "HIGH",
          payload: JSON.stringify({ provider: r.provider, travellers: r.people.length, candidates: candidates.length, best: r.ranked[0]?.candidate.name ?? null, bestWorstMinutes: r.ranked[0]?.worst ?? null, evidenceId: r.evidenceId }),
          propagation: JSON.stringify(["around-you"]),
        },
      })
      .catch(() => undefined);
  }
  return r;
}


// "coffee in Gurgaon" / "shopping in Bangalore" / "things to do near Indiranagar": a plain request, read by words
// alone (no Vibe Check or preference is consulted) and turned into WHERE + WHAT. The named place is resolved first
// (Delhivery, labelled Geoapify fallback), and the traveller's own position is never used unless they chose ME.
export type DiscoverResponse =
  | { ok: true; category: string | null; where: { lat: number; lng: number; label: string; provider: string } | null; note: string | null }
  | { ok: false; error: string };

export async function discoverAction(tripId: string, query: string): Promise<DiscoverResponse> {
  const userId = await member(tripId);
  if (!userId) return { ok: false, error: "Sign in first." };
  const q = parseDiscoveryQuery(query.slice(0, 120));
  if (!q.category && !q.place) return { ok: false, error: "Try something like \"coffee in Gurgaon\"." };
  let where: { lat: number; lng: number; label: string; provider: string } | null = null;
  let note: string | null = null;
  if (q.place) {
    const anchors = await anchorsFor(tripId, userId);
    const sug = await suggestPlaces(q.place, { bias: anchors.destination?.point ?? null, tripId, userId });
    if (!sug.ok || sug.suggestions.length === 0) return { ok: false, error: `I couldn't find "${q.place}" on the map. Try a fuller name.` };
    // Prefer the suggestion that actually carries the typed name; the provider's first hit otherwise.
    const want = q.place.toLowerCase();
    const pick = sug.suggestions.find((s) => s.label.toLowerCase() === want) ?? sug.suggestions.find((s) => s.label.toLowerCase().startsWith(want)) ?? sug.suggestions[0];
    const pt = await pointForSuggestion(pick.label, pick.lat != null && pick.lng != null ? { lat: pick.lat, lng: pick.lng } : null, { tripId, userId });
    if (!pt) return { ok: false, error: `I couldn't place "${pick.label}" on the map.` };
    where = { lat: pt.point.lat, lng: pt.point.lng, label: pick.label, provider: sug.provider };
    note = sug.note;
    await personalEvent(tripId, userId, "ANYWHERE_RESOLVED", { label: pick.label.slice(0, 80), provider: sug.provider, via: "search", category: q.category });
  }
  return { ok: true, category: q.category && q.category in AROUND_CATEGORIES ? q.category : null, where, note };
}
