// Deterministic per-traveller readiness: "will this person make this
// commitment?" Signals in (live location, a stated delay), a status out.
// No model is involved at any step — a GPS fix recomputes this with plain
// arithmetic, so it is cheap to run on every update and always explainable.
//
// Honest limits: travel time is a straight-line estimate (distance × 1.3
// road factor at an assumed 30 km/h urban average), not a routing-API
// result, so confidence never exceeds MEDIUM. Where no signal exists the
// answer is UNKNOWN rather than a guess.
import { prisma } from "./prisma";
import { revalidatePath } from "next/cache";
import { notify, otherMemberIds, type Severity } from "./notifications";

export type ReadinessStatus = "ON_TRACK" | "AT_RISK" | "DELAYED" | "UNKNOWN";
export type ReadinessConfidence = "LOW" | "MEDIUM";

export const AT_RISK_BUFFER_MINUTES = 15;
const ASSUMED_KMH = 30;
const ROAD_FACTOR = 1.3;
const FRESH_FIX_MINUTES = 10;
const STALE_FIX_MINUTES = 30;

export type LatLng = { lat: number; lng: number };

export type ReadinessInput = {
  now: Date;
  latestCommitmentAt: Date | null;
  position: (LatLng & { recordedAt: Date }) | null;
  target: LatLng | null;
  // Minutes the traveller said they'll be late vs the commitment time.
  manualLateMinutes: number;
};

export type ReadinessResult = {
  status: ReadinessStatus;
  confidence: ReadinessConfidence;
  earliestReadyAt: Date | null;
  latestCommitmentAt: Date | null;
  travelMinutes: number | null;
  bufferMinutes: number | null;
  signals: string[];
};

export function haversineKm(a: LatLng, b: LatLng): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function estimateTravelMinutes(from: LatLng, to: LatLng): number {
  return Math.ceil(((haversineKm(from, to) * ROAD_FACTOR) / ASSUMED_KMH) * 60);
}

export function evaluateReadiness(input: ReadinessInput): ReadinessResult {
  const { now, latestCommitmentAt, position, target, manualLateMinutes } = input;
  const signals: string[] = [];

  let travelMinutes: number | null = null;
  let fixAgeMinutes: number | null = null;
  if (position && target) {
    fixAgeMinutes = Math.max(0, (now.getTime() - position.recordedAt.getTime()) / 60_000);
    travelMinutes = estimateTravelMinutes(position, target);
    signals.push("LIVE_LOCATION");
  }
  if (manualLateMinutes > 0) signals.push("STATED_DELAY");

  if (!latestCommitmentAt || signals.length === 0) {
    return {
      status: "UNKNOWN",
      confidence: "LOW",
      earliestReadyAt: null,
      latestCommitmentAt,
      travelMinutes,
      bufferMinutes: null,
      signals,
    };
  }

  let earliestMs = now.getTime() + (travelMinutes ?? 0) * 60_000;
  if (manualLateMinutes > 0) {
    earliestMs = Math.max(earliestMs, latestCommitmentAt.getTime() + manualLateMinutes * 60_000);
  }
  const bufferMinutes = Math.round((latestCommitmentAt.getTime() - earliestMs) / 60_000);

  const status: ReadinessStatus =
    bufferMinutes < 0 ? "DELAYED" : bufferMinutes < AT_RISK_BUFFER_MINUTES ? "AT_RISK" : "ON_TRACK";

  // A fix older than 30 minutes still informs the answer but can't be
  // trusted; a stated delay on its own is the traveller's own word.
  let confidence: ReadinessConfidence = "MEDIUM";
  if (fixAgeMinutes != null && fixAgeMinutes > STALE_FIX_MINUTES && manualLateMinutes === 0) confidence = "LOW";
  if (fixAgeMinutes != null && fixAgeMinutes > FRESH_FIX_MINUTES) signals.push("STALE_FIX");

  return {
    status,
    confidence,
    earliestReadyAt: new Date(earliestMs),
    latestCommitmentAt,
    travelMinutes,
    bufferMinutes,
    signals,
  };
}

// The only sentence about someone's readiness the group may see — built from
// status and a minute count, so it can never carry a position or a reason.
export function readinessGroupLine(name: string, commitmentName: string, r: { status: string; bufferMinutes: number | null }): string {
  if (r.status === "DELAYED") {
    const late = r.bufferMinutes != null ? Math.abs(r.bufferMinutes) : null;
    const amount = !late ? "" : late >= 120 ? `~${Math.round(late / 60)} hours ` : `~${late} min `;
    return `${name} is likely to be ${amount}late for ${commitmentName}`;
  }
  if (r.status === "AT_RISK") return `${name} is at risk of being late for ${commitmentName}`;
  if (r.status === "ON_TRACK") return `${name} is on track for ${commitmentName}`;
  return `${name}'s readiness for ${commitmentName} isn't known yet`;
}

// --- persistence -----------------------------------------------------------

function parseIds(json: string): string[] {
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

// Where a Commitment happens, from places the trip already knows. No new
// geocoding: a commitment whose location matches no saved stop or booking
// simply has no travel-time estimate (confidence/status degrade honestly).
async function resolveCommitmentTarget(tripId: string, location: string): Promise<LatLng | null> {
  const needle = location.trim().toLowerCase();
  if (!needle) return null;
  const [destinations, bookings] = await Promise.all([
    prisma.destination.findMany({ where: { tripId }, select: { name: true, city: true, latitude: true, longitude: true } }),
    prisma.booking.findMany({
      where: { tripId, latitude: { not: null }, longitude: { not: null } },
      select: { placeName: true, latitude: true, longitude: true },
    }),
  ]);
  const hit =
    bookings.find((b) => b.placeName && (needle.includes(b.placeName.toLowerCase()) || b.placeName.toLowerCase().includes(needle))) ??
    destinations.find(
      (d) =>
        d.latitude != null &&
        d.longitude != null &&
        [d.name, d.city].some((s) => s && (needle.includes(s.toLowerCase()) || s.toLowerCase().includes(needle)))
    );
  if (!hit) return null;
  return hit.latitude != null && hit.longitude != null ? { lat: hit.latitude, lng: hit.longitude } : null;
}

export type RecomputeOptions = {
  // Set when the traveller just said they'll be late (0 clears a prior delay).
  statedLateMinutes?: number;
  sourceChannel: "GROUP" | "PRIVATE" | "LOCATION" | "SYSTEM";
  sourceMessageId?: string | null;
  actorUserId?: string | null;
};

export type TravellerReadinessView = {
  commitmentId: string;
  commitmentName: string;
  status: ReadinessStatus;
  confidence: string;
  bufferMinutes: number | null;
  line: string;
};

// Recompute one traveller's readiness for every upcoming commitment they're
// part of; persist it; and write a TripEvent only when the STATUS changes, so
// the event log (and later notifications) records transitions, not noise.
export async function recomputeTravellerReadiness(
  tripId: string,
  userId: string,
  opts: RecomputeOptions
): Promise<TravellerReadinessView[]> {
  const now = new Date();
  const horizon = new Date(now.getTime() - 90 * 60_000);
  const [commitments, location, user, existing] = await Promise.all([
    prisma.commitment.findMany({ where: { tripId, targetTime: { gt: horizon } }, orderBy: { targetTime: "asc" } }),
    prisma.travellerLocation.findUnique({ where: { tripId_userId: { tripId, userId } } }),
    prisma.user.findUnique({ where: { id: userId }, select: { name: true } }),
    prisma.travellerReadiness.findMany({ where: { tripId, userId } }),
  ]);
  const prior = new Map(existing.map((r) => [r.commitmentId, r]));
  const name = user?.name ?? "A traveller";
  const mine = commitments.filter((c) => parseIds(c.participantIds).includes(userId));
  const views: TravellerReadinessView[] = [];

  const sharing = location?.consent === "SHARING" && location.latitude != null && location.longitude != null && location.recordedAt;
  const position = sharing
    ? { lat: location!.latitude!, lng: location!.longitude!, recordedAt: location!.recordedAt! }
    : null;

  for (const c of mine) {
    const before = prior.get(c.id);
    const manualLate = opts.statedLateMinutes ?? before?.manualDelayMinutes ?? 0;
    const target = position ? await resolveCommitmentTarget(tripId, c.location) : null;
    const result = evaluateReadiness({ now, latestCommitmentAt: c.targetTime, position, target, manualLateMinutes: manualLate });

    const data = {
      status: result.status,
      confidence: result.confidence,
      earliestReadyAt: result.earliestReadyAt,
      latestCommitmentAt: result.latestCommitmentAt,
      travelMinutes: result.travelMinutes,
      bufferMinutes: result.bufferMinutes,
      manualDelayMinutes: manualLate,
      signals: JSON.stringify(result.signals),
      computedAt: now,
    };
    await prisma.travellerReadiness.upsert({
      where: { tripId_userId_commitmentId: { tripId, userId, commitmentId: c.id } },
      create: { tripId, userId, commitmentId: c.id, ...data },
      update: data,
    });

    const line = readinessGroupLine(name, c.name, result);
    if (result.status !== (before?.status ?? "UNKNOWN")) {
      const event = await prisma.tripEvent.create({
        data: {
          tripId,
          kind: "READINESS_CHANGED",
          // The event carries only derived status — no coordinates — so it
          // is group-scoped by construction.
          scope: "GROUP",
          actorUserId: opts.actorUserId ?? userId,
          subjectUserId: userId,
          sourceChannel: opts.sourceChannel,
          sourceMessageId: opts.sourceMessageId ?? null,
          confidence: result.confidence,
          payload: JSON.stringify({
            commitment: c.name,
            from: before?.status ?? "UNKNOWN",
            to: result.status,
            bufferMinutes: result.bufferMinutes,
            signals: result.signals,
            line,
          }),
          propagation: JSON.stringify(["travellers", "readiness", "notifications"]),
        },
      });
      // A transition into trouble (or back out of it) is what the others
      // need to hear about; UNKNOWN->ON_TRACK is not news. The body is the
      // same group-safe line shown on the Travellers page.
      const worsened = result.status === "AT_RISK" || result.status === "DELAYED";
      const recovered = result.status === "ON_TRACK" && (before?.status === "AT_RISK" || before?.status === "DELAYED");
      if (worsened || recovered) {
        const severity: Severity = result.status === "DELAYED" ? "HIGH" : result.status === "AT_RISK" ? "IMPORTANT" : "INFO";
        await notify({
          tripId,
          recipientIds: await otherMemberIds(tripId, userId),
          severity,
          kind: "READINESS_CHANGED",
          title: recovered ? `${name} is back on track` : result.status === "DELAYED" ? `${name} is running late` : `${name} may be late`,
          body: line,
          href: `/trips/${tripId}/plan/travellers`,
          eventId: event.id,
        });
      }
    }
    views.push({
      commitmentId: c.id,
      commitmentName: c.name,
      status: result.status,
      confidence: result.confidence,
      bufferMinutes: result.bufferMinutes,
      line,
    });
  }

  if (mine.length > 0) {
    try {
      revalidatePath(`/trips/${tripId}/plan/travellers`);
    } catch {
      // revalidation is best-effort outside a request scope (e.g. tests)
    }
  }
  return views;
}

// What the My Clockwise page needs to decide whether to OFFER live location:
// the soonest commitment this traveller is part of that is within 3 hours
// (or began within the last hour), and their current consent state.
export async function liveLocationOffer(tripId: string, userId: string) {
  const now = Date.now();
  const [upcoming, location] = await Promise.all([
    prisma.commitment.findMany({
      where: { tripId, targetTime: { gt: new Date(now - 60 * 60_000), lt: new Date(now + 3 * 60 * 60_000) } },
      orderBy: { targetTime: "asc" },
    }),
    prisma.travellerLocation.findUnique({ where: { tripId_userId: { tripId, userId } } }),
  ]);
  const commitment = upcoming.find((c) => parseIds(c.participantIds).includes(userId)) ?? null;
  return { commitment, consent: (location?.consent ?? "NONE") as "NONE" | "SHARING" | "DECLINED" | "STOPPED" };
}

// Group-safe readiness rows for the Travellers page: derived status only
// (the table holds no coordinates), for commitments not long past.
export async function currentReadinessRows(tripId: string) {
  return prisma.travellerReadiness.findMany({
    where: { tripId, status: { not: "UNKNOWN" }, latestCommitmentAt: { gt: new Date(Date.now() - 90 * 60_000) } },
  });
}
