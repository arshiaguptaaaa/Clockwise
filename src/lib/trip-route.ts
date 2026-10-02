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
import { suggestTripName } from "./trip-name";

export type RouteOp =
  | { op: "ADD"; place: string; after?: string }
  // Swap one stop for another in the SAME slot ("actually let's do Udaipur
  // instead of Jaipur") — one transaction, one event, never add-then-remove.
  | { op: "REPLACE"; place: string; with: string }
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

export type RouteImpact = {
  // Things that name the stop that went away and are NOT re-derived from the
  // route (free-text strings), so a person has to look at them.
  commitments: string[];
  transportPlans: number;
  bookings: number;
  decisionsSuperseded: number;
  tripRenamed: { from: string; to: string } | null;
};

export type RouteChangeResult =
  | { ok: true; summary: string; route: string[]; changed: boolean; eventId: string | null; impact?: RouteImpact }
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

// Keeps the trip's title in step with its route — but only if the title was
// the auto-generated one for the route as it WAS. A name the organiser typed
// themselves is never overwritten.
async function syncAutoTripName(tripId: string, namesBefore: string[], namesAfter: string[]) {
  const trip = await prisma.trip.findUnique({ where: { id: tripId }, select: { name: true } });
  if (!trip) return null;
  if (trip.name !== suggestTripName(namesBefore)) return null;
  const next = suggestTripName(namesAfter);
  if (next === trip.name) return null;
  await prisma.trip.update({ where: { id: tripId }, data: { name: next } });
  return { from: trip.name, to: next };
}

// What still talks about a stop that left the route. Decisions that name it
// are marked SUPERSEDED (so the agent stops treating them as current); the
// rest is counted and reported, not silently rewritten.
async function reconcileAfterStopRemoved(tripId: string, removedNames: string[]): Promise<Omit<RouteImpact, "tripRenamed">> {
  const needles = removedNames.map((n) => n.trim()).filter((n) => n.length >= 3);
  if (needles.length === 0) return { commitments: [], transportPlans: 0, bookings: 0, decisionsSuperseded: 0 };
  const anyOf = (field: string) => needles.map((n) => ({ [field]: { contains: n, mode: "insensitive" as const } }));
  const [commitments, transportPlans, bookings, superseded] = await Promise.all([
    prisma.commitment.findMany({ where: { tripId, OR: anyOf("location") }, select: { name: true } }),
    prisma.transportPlan.count({ where: { tripId, OR: anyOf("destination") } }),
    prisma.booking.count({ where: { tripId, OR: [...anyOf("placeName"), ...anyOf("city")] } }),
    prisma.decision.updateMany({
      where: { tripId, status: { in: ["CANDIDATE", "UNRESOLVED", "CONFIRMED"] }, OR: anyOf("value") },
      data: { status: "SUPERSEDED" },
    }),
  ]);
  return { commitments: commitments.map((c) => c.name), transportPlans, bookings, decisionsSuperseded: superseded.count };
}

export function revalidateTripSurfaces(tripId: string) {
  // The layout holds the trip title, so revalidate the whole trip shell.
  revalidatePath(`/trips/${tripId}`, "layout");
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
  kind: "DESTINATION_ADDED" | "DESTINATION_REMOVED" | "DESTINATION_MOVED" | "DESTINATION_REPLACED",
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
  const who = actor?.name ?? "Someone";
  const impact = payload.impact as RouteImpact | undefined;
  const impactNote =
    impact && (impact.commitments.length || impact.transportPlans || impact.bookings)
      ? ` Still mentioning the old stop: ${[
          impact.commitments.length ? `${impact.commitments.length} meeting${impact.commitments.length > 1 ? "s" : ""}` : null,
          impact.transportPlans ? `${impact.transportPlans} transport plan${impact.transportPlans > 1 ? "s" : ""}` : null,
          impact.bookings ? `${impact.bookings} booking${impact.bookings > 1 ? "s" : ""}` : null,
        ]
          .filter(Boolean)
          .join(", ")} — worth a look.`
      : "";
  await notify({
    tripId: ctx.tripId,
    recipientIds: others,
    severity: "IMPORTANT",
    kind,
    title: kind === "DESTINATION_REPLACED" ? "The destination changed" : "The route changed",
    body:
      kind === "DESTINATION_REPLACED"
        ? `${who} changed ${payload.replaced} to ${payload.destination}. Route: ${routeAfter}.${impactNote}`
        : `${who} ${kind === "DESTINATION_ADDED" ? "added" : kind === "DESTINATION_REMOVED" ? "removed" : "moved"} ${payload.destination ?? "a stop"}. Route: ${routeAfter}.${impactNote}`,
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
    const tripRenamed = await syncAutoTripName(ctx.tripId, stops.map((x) => x.name), after.map((x) => x.name));
    const eventId = await recordRouteEvent(ctx, "DESTINATION_ADDED", {
      tripRenamed,
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
    return { ok: false, error: `"${change.place}" isn't on the route, so there was nothing to ${change.op === "REMOVE" ? "remove" : change.op === "REPLACE" ? "replace" : "move"}.` };
  }

  if (change.op === "REPLACE") {
    const others = stops.filter((x) => x.id !== target.id);
    if (matchStop(others, change.with)) {
      return { ok: false, error: `${change.with} is already on the route. If you meant to drop ${labelOf(target)}, remove it instead.` };
    }
    let candidates: DestinationSearchResult[];
    try {
      candidates = await destinationSearchProvider.search(change.with);
    } catch {
      return { ok: false, error: "Place search is temporarily unavailable, so I can't change that stop right now." };
    }
    // Same-country candidate first: "Udaipur instead of Jaipur" is Rajasthan's.
    const found = pickCandidate(candidates, target.countryCode ?? dominantCountryCode(stops));
    if (!found) return { ok: false, error: `Couldn't find a place called "${change.with}" — nothing was changed.` };
    if (found.name.toLowerCase() === target.name.toLowerCase()) {
      return { ok: true, summary: `${labelOf(target)} is already the destination.`, route: before, changed: false, eventId: null };
    }

    const old = await prisma.destination.findUniqueOrThrow({ where: { id: target.id } });
    // One transaction: the new stop takes the old stop's slot and dates.
    const [created] = await prisma.$transaction([
      prisma.destination.create({
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
          order: old.order,
          startDate: old.startDate,
          endDate: old.endDate,
        },
      }),
      prisma.destination.delete({ where: { id: target.id } }),
    ]);

    const after = await loadStops(ctx.tripId);
    const route = after.map(labelOf);
    const [tripRenamed, reconciled] = await Promise.all([
      syncAutoTripName(ctx.tripId, stops.map((x) => x.name), after.map((x) => x.name)),
      reconcileAfterStopRemoved(ctx.tripId, [target.name, labelOf(target)]),
    ]);
    const impact: RouteImpact = { ...reconciled, tripRenamed };
    const eventId = await recordRouteEvent(ctx, "DESTINATION_REPLACED", {
      destinationId: created.id,
      destination: found.name,
      replaced: labelOf(target),
      routeBefore: before,
      routeAfter: route,
      impact,
    });
    revalidateTripSurfaces(ctx.tripId);
    const stale = [
      reconciled.commitments.length ? `${reconciled.commitments.length} meeting(s) (${reconciled.commitments.join(", ")})` : null,
      reconciled.transportPlans ? `${reconciled.transportPlans} transport plan(s)` : null,
      reconciled.bookings ? `${reconciled.bookings} booking(s)` : null,
    ].filter(Boolean);
    return {
      ok: true,
      summary: `Changed ${labelOf(target)} to ${found.name}. Route: ${route.join(" → ")}.${tripRenamed ? ` Trip renamed to "${tripRenamed.to}".` : ""}${
        stale.length ? ` Still mentioning ${labelOf(target)} and not changed automatically: ${stale.join("; ")}. Tell the group these may need updating.` : ""
      }`,
      route,
      changed: true,
      eventId,
      impact,
    };
  }

  if (change.op === "REMOVE") {
    if (stops.length <= 1) {
      return { ok: false, error: "That's the only stop on the route — add its replacement first, then remove this one." };
    }
    await prisma.destination.delete({ where: { id: target.id } });
    const remaining = stops.filter((s) => s.id !== target.id);
    await writeOrder(remaining.map((s) => s.id));
    const route = remaining.map(labelOf);
    const [tripRenamed, reconciled] = await Promise.all([
      syncAutoTripName(ctx.tripId, stops.map((x) => x.name), remaining.map((x) => x.name)),
      reconcileAfterStopRemoved(ctx.tripId, [target.name, labelOf(target)]),
    ]);
    const eventId = await recordRouteEvent(ctx, "DESTINATION_REMOVED", {
      destinationId: target.id,
      destination: labelOf(target),
      routeBefore: before,
      routeAfter: route,
      impact: { ...reconciled, tripRenamed },
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
  const movedStops = await loadStops(ctx.tripId);
  const route = movedStops.map(labelOf);
  const movedRename = await syncAutoTripName(ctx.tripId, stops.map((x) => x.name), movedStops.map((x) => x.name));
  const eventId = await recordRouteEvent(ctx, "DESTINATION_MOVED", {
    tripRenamed: movedRename,
    destinationId: target.id,
    destination: labelOf(target),
    after: labelOf(anchor),
    routeBefore: before,
    routeAfter: route,
  });
  revalidateTripSurfaces(ctx.tripId);
  return { ok: true, summary: `Moved ${labelOf(target)} after ${labelOf(anchor)}. Route: ${route.join(" → ")}.`, route, changed: true, eventId };
}
