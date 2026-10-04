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

async function confirmedStay(tripId: string) {
  return prisma.booking.findFirst({ where: { tripId, type: "STAY", status: "CONFIRMED", latitude: { not: null }, longitude: { not: null } }, orderBy: { createdAt: "desc" } });
}

// Measures arrival-point -> stay for every confirmed journey that doesn't have a
// fresh provider route for THIS stay. Safe to call repeatedly.
export async function recomputeRendezvous(tripId: string) {
  const stay = await confirmedStay(tripId);
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
        const departLocal = j.arriveLocal ? toLocal(toMs(j.arriveLocal) + ARRIVAL_BUFFER_MIN * 60_000) : null;
        const r = await driveRoute({ lat: j.arrivalLat, lng: j.arrivalLng }, { lat: stay.latitude, lng: stay.longitude }, { departLocal, tripId, userId: j.userId, decision: "Arrival point to confirmed stay: feeds readiness, rendezvous and commitment feasibility" });
        providersUsed.add(r.provider);
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
  routeMinutes: number | null;
  routeKm: number | null;
  routeProvider: string | null;
  hotelBy: string | null; // local YYYY-MM-DDTHH:mm
  status: "KNOWN" | "NO_STAY" | "NO_ARRIVAL_TIME" | "NO_ARRIVAL_POINT" | "NO_ROUTE";
};
export type CommitmentCheck = { id: string; name: string; target: string; allAtHotelBy: boolean; late: { name: string; hotelBy: string }[]; unknown: string[] };
export type RendezvousView = {
  stayName: string | null;
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

export async function buildRendezvousView(tripId: string): Promise<RendezvousView> {
  const [stay, journeys, members, commitments] = await Promise.all([
    confirmedStay(tripId),
    prisma.travellerJourney.findMany({ where: { tripId, status: "CONFIRMED" } }),
    prisma.tripMember.findMany({ where: { tripId }, include: { user: { select: { id: true, name: true } } } }),
    prisma.commitment.findMany({ where: { tripId }, orderBy: { targetTime: "asc" } }),
  ]);
  const nameOf = new Map(members.map((m) => [m.userId, m.user.name]));
  const clocks: TravellerClock[] = journeys.map((j) => {
    const base = { userId: j.userId, name: nameOf.get(j.userId) ?? "Traveller", mode: j.mode, arriveLocal: j.arriveLocal, arrivalPlace: j.arrivalPlaceName };
    if (!stay) return { ...base, routeMinutes: null, routeKm: null, routeProvider: null, hotelBy: null, status: "NO_STAY" as const };
    if (!j.arriveLocal) return { ...base, routeMinutes: null, routeKm: null, routeProvider: null, hotelBy: null, status: "NO_ARRIVAL_TIME" as const };
    if (j.arrivalLat == null) return { ...base, routeMinutes: null, routeKm: null, routeProvider: null, hotelBy: null, status: "NO_ARRIVAL_POINT" as const };
    if (j.routeToStaySeconds == null || j.routeStayBookingId !== stay.id) return { ...base, routeMinutes: null, routeKm: null, routeProvider: null, hotelBy: null, status: "NO_ROUTE" as const };
    const hotelBy = toLocal(toMs(j.arriveLocal) + (j.routeToStaySeconds + ARRIVAL_BUFFER_MIN * 60) * 1000);
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
    const knownHere = scoped.filter((k) => k.status === "KNOWN");
    const late = knownHere.filter((k) => k.hotelBy! > target).map((k) => ({ name: k.name, hotelBy: k.hotelBy! }));
    const unknown = scoped.filter((k) => k.status !== "KNOWN").map((k) => k.name);
    const missing = members.filter((m) => applies(m.userId) && !have.has(m.userId)).map((m) => m.user.name);
    return { id: c.id, name: c.name, target, allAtHotelBy: late.length === 0 && unknown.length === 0 && missing.length === 0, late, unknown };
  });
  return { stayName: stay?.placeName ?? null, clocks, noJourney, meetAt, meetComplete, commitments: checks };
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
