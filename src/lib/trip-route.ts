// The canonical trip route is the ordered Destination list — nothing else.
// Map, Plan and Itinerary all read these rows, so changing them here is
// what makes every surface agree; there is no second copy to keep in sync.
// Every mutation also writes a TripEvent (provenance + what was
// re-derived), which is what Agent Trace renders.
import { revalidatePath } from "next/cache";
import { notify, otherMemberIds } from "@/lib/notifications";
import { prisma } from "./prisma";
import { destinationSearchProvider } from "./destination-search/open-meteo-provider";
import type { DestinationSearchResult } from "./destination-search/types";

export type RouteOp =
  | { op: "ADD"; place: string; after?: string }
  | { op: "REMOVE"; place: string }
  | { op: "MOVE"; place: string; after: string };

type RouteStop = {
  id: string;
  name: string;
  displayName: string | null;
  city: string | null;
  countryCode: string | null;
  order: number;
};

export type RouteChangeContext = {
  tripId: string;
  actorUserId: string;
  sourceChannel: "GROUP" | "PRIVATE" | "VOICE" | "GNANI" | "SYSTEM";
  sourceMessageId: string | null;
  confidence: "HIGH" | "MEDIUM";
};

export type RouteChangeResult =
  | { ok: true; summary: string; route: string[]; changed: boolean; eventId: string | null }
  | { ok: false; error: string };

// --- pure ordering helpers (unit-tested in isolation) ---------------------

// Inserts newId immediately after afterId; if afterId is null/absent, at
// the end. Returns a new array, never mutates.
export function insertAfter(ids: string[], newId: string, afterId: string | null): string[] {
  const out = ids.filter((id) => id !== newId);
  const at = afterId ? out.indexOf(afterId) : -1;
  if (at === -1) return [...out, newId];
  out.splice(at + 1, 0, newId);
  return out;
}

// Case-insensitive match against a stop's own names. Exact match wins over
// a substring match; substrings shorter than 3 chars never match (avoids
// "ba" matching "Bali" and "Basel").
export function matchStop<T extends Pick<RouteStop, "name" | "displayName" | "city">>(
  stops: T[],
  text: string
): T | null {
  const needle = text.trim().toLowerCase();
  if (!needle) return null;
  const names = (s: T) =>
    [s.name, s.displayName, s.city].filter((v): v is string => Boolean(v)).map((v) => v.toLowerCase());
  const exact = stops.find((s) => names(s).some((n) => n === needle || n.split(",")[0].trim() === needle));
  if (exact) return exact;
  if (needle.length < 3) return null;
  return stops.find((s) => names(s).some((n) => n.includes(needle) || (n.length >= 3 && needle.includes(n)))) ?? null;
}

// Prefers a geocoder candidate in the same country as the stop the user
// anchored to (or the route's dominant country) — "Udaipur after Jaipur"
// means Rajasthan's Udaipur, not another Udaipur elsewhere. Falls back to
// the provider's own ranking.
export function pickCandidate(
  candidates: DestinationSearchResult[],
  preferredCountryCode: string | null
): DestinationSearchResult | null {
  if (candidates.length === 0) return null;
  if (preferredCountryCode) {
    const same = candidates.find((c) => c.countryCode === preferredCountryCode);
    if (same) return same;
  }
  return candidates[0];
}

function dominantCountryCode(stops: RouteStop[]): string | null {
  const counts = new Map<string, number>();
  for (const s of stops) if (s.countryCode) counts.set(s.countryCode, (counts.get(s.countryCode) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

const labelOf = (s: Pick<RouteStop, "name" | "city">) => s.city ?? s.name;

// --- persistence -----------------------------------------------------------

async function loadStops(tripId: string): Promise<RouteStop[]> {
  return prisma.destination.findMany({
    where: { tripId },
    orderBy: { order: "asc" },
    select: { id: true, name: true, displayName: true, city: true, countryCode: true, order: true },
  });
}

async function writeOrder(ids: string[]) {
  await prisma.$transaction(ids.map((id, order) => prisma.destination.update({ where: { id }, data: { order } })));
}

export function revalidateTripSurfaces(tripId: string) {
  for (const path of [`/trips/${tripId}/plan`, `/trips/${tripId}/plan/itinerary`, `/trips/${tripId}/room`]) {
    revalidatePath(path);
  }
}

// The surfaces that read Destination rows directly at render time — they
// are "propagated to" in the sense that they cannot disagree with the
// mutation, not because anything was pushed to them.
const ROUTE_SURFACES = ["map", "plan", "itinerary", "chat"];

async function recordRouteEvent(
  ctx: RouteChangeContext,
  kind: "DESTINATION_ADDED" | "DESTINATION_REMOVED" | "DESTINATION_MOVED",
  payload: Record<string, unknown>
) {
  const event = await prisma.tripEvent.create({
    data: {
      tripId: ctx.tripId,
      kind,
      scope: "GROUP",
      actorUserId: ctx.actorUserId,
      sourceChannel: ctx.sourceChannel,
      sourceMessageId: ctx.sourceMessageId,
      confidence: ctx.confidence,
      payload: JSON.stringify(payload),
      propagation: JSON.stringify(ROUTE_SURFACES),
    },
  });
  // Tell the others what changed — the same saved route every surface reads,
  // in plain words. Best-effort: notify() never throws into the mutation.
  const [actor, others] = await Promise.all([
    ctx.actorUserId ? prisma.user.findUnique({ where: { id: ctx.actorUserId }, select: { name: true } }) : null,
    otherMemberIds(ctx.tripId, ctx.actorUserId),
  ]);
  const routeAfter = Array.isArray(payload.routeAfter) ? (payload.routeAfter as string[]).join(" → ") : "";
  await notify({
    tripId: ctx.tripId,
    recipientIds: others,
    severity: "IMPORTANT",
    kind,
    title: "The route changed",
    body: `${actor?.name ?? "Someone"} ${kind === "DESTINATION_ADDED" ? "added" : kind === "DESTINATION_REMOVED" ? "removed" : "moved"} ${payload.destination ?? "a stop"}. Route: ${routeAfter}.`,
    href: `/trips/${ctx.tripId}/plan`,
    eventId: event.id,
  });
  return event.id;
}

export async function applyRouteChange(ctx: RouteChangeContext, change: RouteOp): Promise<RouteChangeResult> {
  const stops = await loadStops(ctx.tripId);
  const before = stops.map(labelOf);

  if (change.op === "ADD") {
    if (matchStop(stops, change.place)) {
      return { ok: true, summary: `${change.place} is already on the route.`, route: before, changed: false, eventId: null };
    }

    const anchor = change.after ? matchStop(stops, change.after) : null;
    const preferredCountry = anchor?.countryCode ?? dominantCountryCode(stops);

    let candidates: DestinationSearchResult[];
    try {
      candidates = await destinationSearchProvider.search(change.place);
    } catch {
      return { ok: false, error: "Place search is temporarily unavailable, so I can't add that stop right now." };
    }
    const found = pickCandidate(candidates, preferredCountry);
    if (!found) {
      return { ok: false, error: `Couldn't find a place called "${change.place}" — nothing was changed.` };
    }
    // A second check on the resolved place (the user may have typed a
    // variant spelling): same provider place id, or same resolved name.
    if (stops.some((s) => s.name.toLowerCase() === found.name.toLowerCase())) {
      return { ok: true, summary: `${found.name} is already on the route.`, route: before, changed: false, eventId: null };
    }

    const created = await prisma.destination.create({
      data: {
        tripId: ctx.tripId,
        name: found.name,
        displayName: found.displayName,
        city: found.city,
        region: found.region,
        country: found.country,
        countryCode: found.countryCode,
        latitude: found.latitude,
        longitude: found.longitude,
        placeId: found.providerPlaceId,
        provider: found.provider,
        order: stops.length,
      },
    });
    const ids = insertAfter(stops.map((s) => s.id), created.id, anchor?.id ?? null);
    await writeOrder(ids);

    const after = await loadStops(ctx.tripId);
    const route = after.map(labelOf);
    const eventId = await recordRouteEvent(ctx, "DESTINATION_ADDED", {
      destinationId: created.id,
      destination: found.name,
      after: anchor ? labelOf(anchor) : null,
      afterRequested: change.after ?? null,
      anchorFound: change.after ? Boolean(anchor) : null,
      routeBefore: before,
      routeAfter: route,
    });
    revalidateTripSurfaces(ctx.tripId);
    const note = change.after && !anchor ? ` (couldn't find "${change.after}" on the route, so it went at the end)` : "";
    return { ok: true, summary: `Added ${found.name}${note}. Route: ${route.join(" → ")}.`, route, changed: true, eventId };
  }

  const target = matchStop(stops, change.place);
  if (!target) {
    return { ok: false, error: `"${change.place}" isn't on the route, so there was nothing to ${change.op === "REMOVE" ? "remove" : "move"}.` };
  }

  if (change.op === "REMOVE") {
    if (stops.length <= 1) {
      return { ok: false, error: "That's the only stop on the route — add its replacement first, then remove this one." };
    }
    await prisma.destination.delete({ where: { id: target.id } });
    const remaining = stops.filter((s) => s.id !== target.id);
    await writeOrder(remaining.map((s) => s.id));
    const route = remaining.map(labelOf);
    const eventId = await recordRouteEvent(ctx, "DESTINATION_REMOVED", {
      destinationId: target.id,
      destination: labelOf(target),
      routeBefore: before,
      routeAfter: route,
    });
    revalidateTripSurfaces(ctx.tripId);
    return { ok: true, summary: `Removed ${labelOf(target)}. Route: ${route.join(" → ")}.`, route, changed: true, eventId };
  }

  // MOVE
  const anchor = matchStop(stops.filter((s) => s.id !== target.id), change.after);
  if (!anchor) {
    return { ok: false, error: `Couldn't find "${change.after}" on the route to place ${labelOf(target)} after.` };
  }
  const ids = insertAfter(stops.map((s) => s.id), target.id, anchor.id);
  if (ids.join() === stops.map((s) => s.id).join()) {
    return { ok: true, summary: `${labelOf(target)} is already right after ${labelOf(anchor)}.`, route: before, changed: false, eventId: null };
  }
  await writeOrder(ids);
  const route = (await loadStops(ctx.tripId)).map(labelOf);
  const eventId = await recordRouteEvent(ctx, "DESTINATION_MOVED", {
    destinationId: target.id,
    destination: labelOf(target),
    after: labelOf(anchor),
    routeBefore: before,
    routeAfter: route,
  });
  revalidateTripSurfaces(ctx.tripId);
  return { ok: true, summary: `Moved ${labelOf(target)} after ${labelOf(anchor)}. Route: ${route.join(" → ")}.`, route, changed: true, eventId };
}
