// Rendezvous: ONE TRIP, MANY CLOCKS. Each traveller arrives at their own time at
// their own arrival point; the stay is the shared anchor. This module computes,
// from CONFIRMED journeys + the CONFIRMED stay + provider-measured routes, when
// each person can realistically be at the stay and what that means for shared
// commitments. It never invents a route time: no provider route => UNKNOWN.
import { prisma } from "./prisma";
import { driveRoute } from "./travel/route-provider";
import { isDelhiveryConfigured, inIndia } from "./delhivery/client";
import { notify } from "./notifications";

// A stated assumption (collecting bags, leaving the terminal, finding the car).
export const ARRIVAL_BUFFER_MIN = 15;

const toMs = (local: string) => new Date(`${local}:00.000Z`).getTime();
const toLocal = (ms: number) => new Date(ms).toISOString().slice(0, 16);

// WHERE EVERYONE NEEDS TO GET TO, in this order, and never the city centre by default:
//   1. the confirmed stay  2. a meeting point the group named ("meet us at Church Street")
//   3. the location of the next shared commitment, if it names a real place  4. nothing -> Clockwise asks.
export type GroupAnchor = { id: string; placeName: string; latitude: number; longitude: number; kind: "stay" | "meeting" | "commitment" };

const geocodeMemo = new Map<string, { at: number; value: { lat: number; lng: number; label: string } | null }>();
export async function geocodeAnchorText(tripId: string, text: string) {
  const key = `${tripId}:${text.toLowerCase()}`;
  const hit = geocodeMemo.get(key);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.value;
  const { suggestPlaces, pointForSuggestion } = await import("./travel/locate");
  // "Church Street" exists in every country: ask for it IN the trip's city and bias the provider to the destination.
  const dest = await prisma.destination.findFirst({ where: { tripId }, orderBy: { order: "asc" }, select: { name: true, city: true, latitude: true, longitude: true } });
  const city = (dest?.city ?? dest?.name ?? "").split(",")[0].trim();
  const query = city && !text.toLowerCase().includes(city.toLowerCase()) ? `${text}, ${city}` : text;
  const bias = dest?.latitude != null && dest.longitude != null ? { lat: dest.latitude, lng: dest.longitude } : null;
  const sug = await suggestPlaces(query, { tripId, bias }).catch(() => null);
  let value: { lat: number; lng: number; label: string } | null = null;
  if (sug && sug.ok && sug.suggestions[0]) {
    const pick = sug.suggestions[0];
    const pt = await pointForSuggestion(pick.label, pick.lat != null && pick.lng != null ? { lat: pick.lat, lng: pick.lng } : null, { tripId });
    // A street name that resolves hundreds of km from the trip is the wrong street: refuse it rather than route to it.
    const far = pt && bias ? Math.hypot((pt.point.lat - bias.lat) * 111, (pt.point.lng - bias.lng) * 111 * Math.cos((bias.lat * Math.PI) / 180)) > 150 : false;
    if (pt && !far) value = { lat: pt.point.lat, lng: pt.point.lng, label: pick.label.split(",")[0] };
  }
  geocodeMemo.set(key, { at: Date.now(), value });
  return value;
}

// A commitment location that is just the city / trip / placeholder is not a specific place.
export async function genericLocations(tripId: string): Promise<Set<string>> {
  const trip = await prisma.trip.findUnique({ where: { id: tripId }, select: { name: true, destinations: { select: { name: true, displayName: true, city: true } } } });
  return new Set(["", "to be decided", "tbd", (trip?.name ?? "").toLowerCase(), ...(trip?.destinations ?? []).flatMap((d) => [d.name.toLowerCase(), (d.displayName ?? "").toLowerCase(), (d.displayName ?? "").split(",")[0].toLowerCase(), (d.city ?? "").toLowerCase()])]);
}

export async function groupAnchor(tripId: string): Promise<GroupAnchor | null> {
  const stay = await prisma.booking.findFirst({ where: { tripId, type: "STAY", status: "CONFIRMED", latitude: { not: null }, longitude: { not: null } }, orderBy: { createdAt: "desc" } });
  if (stay) return { id: stay.id, placeName: stay.placeName ?? "the stay", latitude: stay.latitude!, longitude: stay.longitude!, kind: "stay" };

  const meet = await prisma.tripPointer.findFirst({ where: { tripId, kind: "MEET", status: { not: "DISMISSED" } }, orderBy: { updatedAt: "desc" } });
  if (meet) {
    const g = await geocodeAnchorText(tripId, meet.subject);
    if (g) return { id: `meet:${meet.id}`, placeName: g.label, latitude: g.lat, longitude: g.lng, kind: "meeting" };
  }

  const generic = await genericLocations(tripId);
  const upcoming = await prisma.commitment.findMany({ where: { tripId, status: { not: "CANCELLED" }, targetTime: { gt: new Date(Date.now() - 12 * 3600_000) } }, orderBy: { targetTime: "asc" }, take: 5 });
  for (const c of upcoming) {
    const loc = c.location.trim();
    if (generic.has(loc.toLowerCase())) continue;
    const g = await geocodeAnchorText(tripId, loc);
    if (g) return { id: `commitment:${c.id}`, placeName: g.label, latitude: g.lat, longitude: g.lng, kind: "commitment" };
  }
  return null;
}

// Measures arrival-point -> stay for every confirmed journey that doesn't have a
// fresh provider route for THIS stay. Safe to call repeatedly.
export async function recomputeRendezvous(tripId: string) {
  const stay = await groupAnchor(tripId);
  const journeys = await prisma.travellerJourney.findMany({ where: { tripId, status: "CONFIRMED" } });
  let routed = 0;
  const providersUsed = new Set<string>();
  if (stay?.latitude != null && stay.longitude != null) {
    for (const j of journeys) {
      if (j.arrivalLat == null || j.arrivalLng == null) continue;
      // Keep a fresh route for THIS stay, unless Delhivery is available for these Indian points and the stored route came from elsewhere.
      const wantDelhivery = isDelhiveryConfigured() && inIndia({ lat: j.arrivalLat, lng: j.arrivalLng }) && inIndia({ lat: stay.latitude, lng: stay.longitude });
      if (j.routeStayBookingId === stay.id && j.routeToStaySeconds != null && (!wantDelhivery || j.routeProvider === "delhivery")) continue;
      try {
        // The traveller leaves the airport after the allowance for bags and exits: that is the departure time to price.
        const departLocal = j.arriveLocal ? outAt(j).outAtLocal : null;
        const r = await driveRoute({ lat: j.arrivalLat, lng: j.arrivalLng }, { lat: stay.latitude, lng: stay.longitude }, { departLocal, tripId, userId: j.userId, decision: "Arrival point to confirmed stay: feeds readiness, rendezvous and commitment feasibility" });
        providersUsed.add(r.provider);
        const nm = await prisma.user.findUnique({ where: { id: j.userId }, select: { name: true } });
        await prisma.tripEvent.create({
          data: {
            tripId,
            // Named for the provider that actually answered: a Geoapify fallback is never logged as Delhivery.
            kind: r.provider === "delhivery" ? "DELHIVERY_ROUTE_COMPLETED" : "ARRIVAL_ROUTE_COMPLETED",
            scope: "GROUP",
            actorUserId: j.userId,
            subjectUserId: j.userId,
            sourceChannel: "SYSTEM",
            confidence: "HIGH",
            payload: JSON.stringify({ provider: r.provider, traveller: nm?.name ?? null, from: j.arrivalPlaceName ?? "arrival point", to: stay.placeName, minutes: Math.round(r.durationSeconds / 60), km: Math.round(r.distanceMeters / 100) / 10, trafficAware: r.trafficAware, departure: r.departureTime, fellBackFrom: r.fellBackFrom ?? null, evidenceId: r.evidenceId }),
            propagation: JSON.stringify(["plan", "rendezvous"]),
          },
        }).catch(() => undefined);
        await prisma.travellerJourney.update({
          where: { id: j.id },
          data: { routeToStayMeters: Math.round(r.distanceMeters), routeToStaySeconds: Math.round(r.durationSeconds), routeProvider: r.provider, routeComputedAt: new Date(r.retrievedAt), routeStayBookingId: stay.id },
        });
        routed++;
      } catch {
        // No provider route: leave it null — the view reports it as unknown.
      }
    }
  }
  await prisma.tripEvent.create({
    data: {
      tripId,
      kind: "RENDEZVOUS_COMPUTED",
      scope: "GROUP",
      sourceChannel: "SYSTEM",
      confidence: "HIGH",
      payload: JSON.stringify({ journeys: journeys.length, routedNow: routed, stay: stay?.placeName ?? null, provider: [...providersUsed].join("+") || null, bufferMinutes: ARRIVAL_BUFFER_MIN }),
      propagation: JSON.stringify(["plan", "notifications"]),
    },
  });
  await warnAtRisk(tripId);
}

export type TravellerClock = {
  userId: string;
  name: string;
  mode: string;
  arriveLocal: string | null;
  arrivalPlace: string | null;
  // The arrival on the ticket, when a delay has moved arriveLocal off it.
  scheduledArrive: string | null;
  // Bags and exits: a stated assumption, shown apart from the route.
  allowanceMin: number;
  routeMinutes: number | null;
  routeKm: number | null;
  routeProvider: string | null;
  hotelBy: string | null; // local YYYY-MM-DDTHH:mm
  // The earliest the traveller can be OUT of the airport: landing + the stated allowance, or later if they said they are
  // still inside. `outFloor` is set only when what they said is what decides it.
  outAtLocal: string | null;
  outFloor: string | null;
  // "I'll join you directly at dinner": for this one commitment the traveller goes straight to the venue.
  direct: { commitmentId: string; seconds: number | null } | null;
  status: "KNOWN" | "NO_STAY" | "NO_ARRIVAL_TIME" | "NO_ARRIVAL_POINT" | "NO_ROUTE";
};
export type CommitmentCheck = { id: string; name: string; target: string; allAtHotelBy: boolean; late: { name: string; hotelBy: string; lowerBound?: boolean }[]; unknown: string[] };
export type RendezvousView = {
  stayName: string | null;
  anchorKind: "stay" | "meeting" | "commitment" | null;
  clocks: TravellerClock[];
  noJourney: string[];
  meetAt: string | null; // everyone-with-a-journey can be at the stay by this local time
  meetComplete: boolean; // false while anyone is unknown or hasn't added a journey
  commitments: CommitmentCheck[];
};

// Who a commitment applies to: its listed participants (empty/unparseable = everyone).
export function appliesTo(participantIdsJson: string): (userId: string) => boolean {
  let ids: string[] = [];
  try {
    const parsed = JSON.parse(participantIdsJson);
    if (Array.isArray(parsed)) ids = parsed.filter((x): x is string => typeof x === "string");
  } catch {
    ids = [];
  }
  return (userId) => ids.length === 0 || ids.includes(userId);
}

function outAt(j: { arriveLocal: string | null; notOutBeforeLocal: string | null }): { outAtLocal: string | null; outFloor: string | null } {
  if (!j.arriveLocal) return { outAtLocal: null, outFloor: null };
  const standard = toMs(j.arriveLocal) + ARRIVAL_BUFFER_MIN * 60_000;
  const floor = j.notOutBeforeLocal ? toMs(j.notOutBeforeLocal) : 0;
  return floor > standard ? { outAtLocal: toLocal(floor), outFloor: j.notOutBeforeLocal } : { outAtLocal: toLocal(standard), outFloor: null };
}

export async function buildRendezvousView(tripId: string): Promise<RendezvousView> {
  const [stay, journeys, members, commitments] = await Promise.all([
    groupAnchor(tripId),
    prisma.travellerJourney.findMany({ where: { tripId, status: "CONFIRMED" } }),
    prisma.tripMember.findMany({ where: { tripId }, include: { user: { select: { id: true, name: true } } } }),
    prisma.commitment.findMany({ where: { tripId, status: { not: "CANCELLED" } }, orderBy: { targetTime: "asc" } }),
  ]);
  const nameOf = new Map(members.map((m) => [m.userId, m.user.name]));
  const clocks: TravellerClock[] = journeys.map((j) => {
    const base = { userId: j.userId, name: nameOf.get(j.userId) ?? "Traveller", mode: j.mode, arriveLocal: j.arriveLocal, arrivalPlace: j.arrivalPlaceName, scheduledArrive: j.scheduledArriveLocal && j.scheduledArriveLocal !== j.arriveLocal ? j.scheduledArriveLocal : null, allowanceMin: ARRIVAL_BUFFER_MIN, ...outAt(j), direct: j.directToCommitmentId ? { commitmentId: j.directToCommitmentId, seconds: j.directRouteSeconds ?? null } : null };
    if (!stay) return { ...base, routeMinutes: null, routeKm: null, routeProvider: null, hotelBy: null, status: "NO_STAY" as const };
    if (!j.arriveLocal) return { ...base, routeMinutes: null, routeKm: null, routeProvider: null, hotelBy: null, status: "NO_ARRIVAL_TIME" as const };
    if (j.arrivalLat == null) return { ...base, routeMinutes: null, routeKm: null, routeProvider: null, hotelBy: null, status: "NO_ARRIVAL_POINT" as const };
    if (j.routeToStaySeconds == null || j.routeStayBookingId !== stay.id) return { ...base, routeMinutes: null, routeKm: null, routeProvider: null, hotelBy: null, status: "NO_ROUTE" as const };
    const hotelBy = toLocal(toMs(outAt(j).outAtLocal!) + j.routeToStaySeconds * 1000);
    return { ...base, routeMinutes: Math.round(j.routeToStaySeconds / 60), routeKm: Math.round(((j.routeToStayMeters ?? 0) / 1000) * 10) / 10, routeProvider: j.routeProvider, hotelBy, status: "KNOWN" as const };
  });
  const have = new Set(journeys.map((j) => j.userId));
  const noJourney = members.filter((m) => !have.has(m.userId)).map((m) => m.user.name);
  const known = clocks.filter((c) => c.status === "KNOWN");
  const meetAt = known.length ? known.map((c) => c.hotelBy!).sort().at(-1)! : null;
  const meetComplete = known.length > 0 && known.length === clocks.length && noJourney.length === 0;

  const checks: CommitmentCheck[] = commitments.map((c) => {
    const target = c.targetTime.toISOString().slice(0, 16);
    // A commitment applies to its listed participants (empty/unparseable = everyone).
    const applies = appliesTo(c.participantIds);
    const scoped = clocks.filter((k) => applies(k.userId));
        // Someone joining THIS commitment directly is measured to its venue, not to the stay; with no measured venue route
    // they are "not measured" for it (never late by the stay's clock, never assumed on time).
    const directFor = (k: TravellerClock) => (k.direct?.commitmentId === c.id ? k.direct : null);
    const late = scoped.flatMap((k): { name: string; hotelBy: string; lowerBound?: boolean }[] => {
      const d = directFor(k);
      const exact = d ? (d.seconds != null && k.outAtLocal ? toLocal(toMs(k.outAtLocal) + d.seconds * 1000) : null) : k.status === "KNOWN" ? k.hotelBy : null;
      if (exact) return exact > target ? [{ name: k.name, hotelBy: exact }] : [];
      // Travel time unknown: landing after the start is impossible whatever any route says.
      return k.arriveLocal && k.arriveLocal >= target ? [{ name: k.name, hotelBy: k.arriveLocal, lowerBound: true }] : [];
    });
    const unknown = scoped.filter((k) => k.status !== "KNOWN" || (directFor(k) && directFor(k)!.seconds == null)).map((k) => k.name);
    const missing = members.filter((m) => applies(m.userId) && !have.has(m.userId)).map((m) => m.user.name);
    return { id: c.id, name: c.name, target, allAtHotelBy: late.length === 0 && unknown.length === 0 && missing.length === 0, late, unknown };
  });
  return { stayName: stay?.placeName ?? null, anchorKind: stay?.kind ?? null, clocks, noJourney, meetAt, meetComplete, commitments: checks };
}

// One notification per (commitment, traveller) risk, to the organiser — never repeated.
async function warnAtRisk(tripId: string) {
  const view = await buildRendezvousView(tripId);
  const trip = await prisma.trip.findUnique({ where: { id: tripId }, select: { createdBy: true } });
  if (!trip) return;
  for (const c of view.commitments) {
    for (const l of c.late) {
      const key = `${c.id}:${l.name}`;
      const prior = await prisma.tripEvent.findFirst({ where: { tripId, kind: "RENDEZVOUS_AT_RISK", payload: { contains: `"key":"${key}"` } } });
      if (prior) continue;
      await prisma.tripEvent.create({
        data: { tripId, kind: "RENDEZVOUS_AT_RISK", scope: "GROUP", sourceChannel: "SYSTEM", confidence: "MEDIUM", payload: JSON.stringify({ key, commitment: c.name, target: c.target, traveller: l.name, hotelBy: l.hotelBy }), propagation: JSON.stringify(["plan", "notifications"]) },
      });
      await prisma.tripEvent.create({
        data: { tripId, kind: "RENDEZVOUS_CONFLICT_DETECTED", scope: "GROUP", sourceChannel: "SYSTEM", confidence: "HIGH", payload: JSON.stringify({ commitment: c.name, target: c.target, traveller: l.name, hotelBy: l.hotelBy }), propagation: JSON.stringify(["plan", "proposals"]) },
      }).catch(() => undefined);
      await notify({
        tripId,
        recipientIds: [trip.createdBy],
        severity: "IMPORTANT",
        kind: "RENDEZVOUS_AT_RISK",
        title: "Someone's clock clashes with a shared plan",
        body: `${l.name} can't be at the stay until about ${l.hotelBy.slice(11)} — ${c.name} is at ${c.target.slice(11)}.`,
        href: `/trips/${tripId}/plan`,
      });
    }
  }
}
