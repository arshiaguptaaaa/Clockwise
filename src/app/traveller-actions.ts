"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/session";
import { destinationSearchProvider } from "@/lib/destination-search/open-meteo-provider";
import { QUESTIONS, setPref, getPrefs, type QuestionId } from "@/lib/traveller/vibe";
import { confirmJourney, discardJourney, createPendingJourney, type JourneyFacts } from "@/lib/traveller/journey";
import { searchAround, brandSearch, type AroundPlace } from "@/lib/travel/around";
import { AROUND_CATEGORIES } from "@/lib/travel/around-categories";

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

async function recordAround(tripId: string, userId: string, payload: Record<string, unknown>) {
  await prisma.tripEvent
    .create({
      data: { tripId, kind: "AROUND_YOU_REFRESHED", scope: "PERSONAL", actorUserId: userId, subjectUserId: userId, sourceChannel: "SYSTEM", confidence: "HIGH", payload: JSON.stringify(payload), propagation: JSON.stringify(["around-you"]) },
    })
    .catch(() => undefined);
}

export type AroundResponse =
  | { ok: true; anchorKind: "stay" | "destination"; anchorLabel: string; category: string; places: AroundPlace[]; retrievedAt: string; note?: string; saved: string[] }
  | { ok: false; error: string };

export async function aroundSearchAction(tripId: string, category: string, diet?: "vegetarian" | "vegan" | "halal"): Promise<AroundResponse> {
  const userId = await member(tripId);
  if (!userId) return { ok: false, error: "Sign in first." };
  if (!(category in AROUND_CATEGORIES)) return { ok: false, error: "Unknown category." };
  const r = await searchAround(tripId, category, { diet });
  if (!r.ok) return r;
  await recordAround(tripId, userId, { provider: "geoapify", category, diet: diet ?? null, anchorType: r.anchor.kind, anchor: r.anchor.label, resultCount: r.places.length, walkMinutesFromProvider: r.places.filter((p) => p.walkMinutes != null).length, retrievedAt: r.retrievedAt });
  const saved = (await prisma.savedPlace.findMany({ where: { tripId, userId }, select: { providerPlaceId: true } })).map((s) => s.providerPlaceId);
  return { ok: true, anchorKind: r.anchor.kind, anchorLabel: r.anchor.label, category, places: r.places, retrievedAt: r.retrievedAt, note: diet ? `Found using Geoapify's ${diet} search — a provider filter, not a check of each place.` : undefined, saved };
}

export async function brandSearchAction(tripId: string, brand: string): Promise<AroundResponse> {
  const userId = await member(tripId);
  if (!userId) return { ok: false, error: "Sign in first." };
  const q = brand.trim().slice(0, 60);
  if (!q) return { ok: false, error: "Type a store name." };
  const r = await brandSearch(tripId, q);
  if (!r.ok) return r;
  await recordAround(tripId, userId, { provider: "geoapify", category: "brand", brand: q, anchorType: r.anchor.kind, anchor: r.anchor.label, found: r.found.length, alternatives: r.alternatives.length, retrievedAt: r.retrievedAt });
  const saved = (await prisma.savedPlace.findMany({ where: { tripId, userId }, select: { providerPlaceId: true } })).map((s) => s.providerPlaceId);
  return { ok: true, anchorKind: r.anchor.kind, anchorLabel: r.anchor.label, category: "convenience", places: r.places, retrievedAt: r.retrievedAt, note: r.note, saved };
}

export async function toggleSavePlaceAction(tripId: string, place: AroundPlace, kind: string): Promise<{ ok: boolean; saved?: boolean }> {
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
  revalidatePath(`/trips/${tripId}/agent/saved`);
  return { ok: true, saved: true };
}
