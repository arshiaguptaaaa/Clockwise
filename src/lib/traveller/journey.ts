// A traveller's own journey to the destination. Ticket extraction proposes one
// (PENDING_CONFIRMATION); only the traveller's confirmation makes it canonical.
// Confirming it is the ONE propagation point: personal availability limit,
// group-safe arrival event, rendezvous recompute, notifications, revalidation.
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { postActionCard } from "@/lib/action-cards";
import { notify } from "@/lib/notifications";
import { resolveTripLocationText, isResolveFailure } from "@/lib/travel/resolve";
import { recordPersonalConstraint, formatTime12 } from "@/lib/personal-state";
import { recomputeRendezvous } from "@/lib/rendezvous";

// departure minus lead time, as a wall-clock date + HH:MM (document-local frame).
function latestArrivalFor(departureLocal: string, leadMinutes: number): { date: string; hhmm: string } {
  const [d, t] = departureLocal.split("T");
  const at = new Date(new Date(`${d}T${t}:00.000Z`).getTime() - leadMinutes * 60_000);
  return { date: at.toISOString().slice(0, 10), hhmm: at.toISOString().slice(11, 16) };
}

export type JourneyMode = "FLIGHT" | "TRAIN" | "BUS" | "DRIVE" | "OTHER";
export const MODE_ICON: Record<string, string> = { FLIGHT: "✈", TRAIN: "🚆", BUS: "🚌", DRIVE: "🚗", OTHER: "→" };
export const MODE_LABEL: Record<string, string> = { FLIGHT: "Flight", TRAIN: "Train", BUS: "Bus", DRIVE: "Drive", OTHER: "Journey" };
// How early someone must be at the departure point. A stated assumption, shown to
// the traveller — never read from the ticket.
const LEAD_MINUTES: Record<string, number> = { FLIGHT: 180, TRAIN: 45, BUS: 30 };

export type JourneyFacts = {
  mode: JourneyMode;
  carrier?: string | null;
  originName?: string | null;
  destinationName?: string | null;
  departLocal?: string | null;
  arriveLocal?: string | null;
};

const LOCAL_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const clean = (v: unknown, n = 80) => (typeof v === "string" && v.trim() ? v.trim().slice(0, n) : null);
const cleanLocal = (v: unknown) => (typeof v === "string" && LOCAL_RE.test(v) ? v : null);

function dayLabel(local: string | null) {
  return local ? new Date(`${local.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }) : "";
}
export const timeLabel = (local: string | null) => (local ? formatTime12(local.slice(11)) : "");

export async function createPendingJourney(tripId: string, userId: string, facts: JourneyFacts, source: "TICKET" | "MANUAL", attachmentId?: string | null) {
  await prisma.travellerJourney.updateMany({ where: { tripId, userId, status: "PENDING_CONFIRMATION" }, data: { status: "DISCARDED" } });
  return prisma.travellerJourney.create({
    data: {
      tripId,
      userId,
      mode: facts.mode,
      status: "PENDING_CONFIRMATION",
      carrier: clean(facts.carrier),
      originName: clean(facts.originName),
      destinationName: clean(facts.destinationName),
      departLocal: cleanLocal(facts.departLocal),
      arriveLocal: cleanLocal(facts.arriveLocal),
      source,
      attachmentId: attachmentId ?? null,
    },
  });
}

// Private card in the traveller's My Clockwise: "CLOCKWISE FOUND THIS ✦".
export async function postJourneyConfirmCard(journeyId: string) {
  const j = await prisma.travellerJourney.findUnique({ where: { id: journeyId } });
  if (!j) return;
  await postActionCard({
    tripId: j.tripId,
    channel: "PRIVATE",
    recipientId: j.userId,
    type: "DOCUMENT",
    status: "PENDING",
    data: {
      title: "CLOCKWISE FOUND THIS ✦",
      context: "From the ticket you uploaded. Nothing is saved or shared until you confirm.",
      journeyId: j.id,
    },
  });
}

// Arrival point = the provider's own airport / station / stand for the destination
// (never the city centre). Unresolvable => null, and rendezvous reports UNKNOWN.
async function resolveArrival(tripId: string, mode: string, destination: string | null) {
  if (!destination) return null;
  const text = mode === "FLIGHT" ? `${destination} airport` : mode === "TRAIN" ? `${destination} railway station` : mode === "BUS" ? `${destination} bus stand` : destination;
  const r = await resolveTripLocationText(text, tripId);
  if (isResolveFailure(r)) return null;
  return { name: r.label.split(",")[0], lat: r.point.lat, lng: r.point.lng };
}

export async function confirmJourney(journeyId: string, userId: string, edits?: Partial<JourneyFacts>): Promise<{ ok: true } | { ok: false; error: string }> {
  const j = await prisma.travellerJourney.findUnique({ where: { id: journeyId } });
  if (!j || j.userId !== userId) return { ok: false, error: "That journey isn't yours." };
  if (j.status === "CONFIRMED") return { ok: true };
  if (j.status !== "PENDING_CONFIRMATION") return { ok: false, error: "That journey is no longer pending." };

  const mode = (edits?.mode ?? j.mode) as string;
  const destinationName = clean(edits?.destinationName) ?? j.destinationName;
  const arrival = await resolveArrival(j.tripId, mode, destinationName);
  await prisma.travellerJourney.updateMany({ where: { tripId: j.tripId, userId, status: "CONFIRMED" }, data: { status: "DISCARDED" } });
  const saved = await prisma.travellerJourney.update({
    where: { id: j.id },
    data: {
      status: "CONFIRMED",
      mode,
      carrier: edits?.carrier !== undefined ? clean(edits.carrier) : j.carrier,
      originName: edits?.originName !== undefined ? clean(edits.originName) : j.originName,
      destinationName,
      departLocal: edits?.departLocal !== undefined ? cleanLocal(edits.departLocal) : j.departLocal,
      arriveLocal: edits?.arriveLocal !== undefined ? cleanLocal(edits.arriveLocal) : j.arriveLocal,
      arrivalPlaceName: arrival?.name ?? null,
      arrivalLat: arrival?.lat ?? null,
      arrivalLng: arrival?.lng ?? null,
      routeToStayMeters: null,
      routeToStaySeconds: null,
      routeComputedAt: null,
    },
  });

  // Personal availability limit (private): leave-for-departure time. Only now.
  const lead = LEAD_MINUTES[saved.mode];
  // Only a journey that LEAVES the trip (a return leg) limits what the traveller can attend. A journey that brings
  // them TO the trip says nothing about dinner at the destination, and used to wrongly block every later time that day.
  const tripPlaces = (await prisma.destination.findMany({ where: { tripId: saved.tripId }, select: { name: true, city: true } })).flatMap((d) => [d.name, d.city ?? ""]).map((x) => x.toLowerCase().split(",")[0].trim()).filter(Boolean);
  const leavesTheTrip = Boolean(saved.originName) && tripPlaces.some((p) => saved.originName!.toLowerCase().includes(p) || p.includes(saved.originName!.toLowerCase().split(",")[0].trim()));
  if (lead && saved.departLocal && leavesTheTrip) {
    const latest = latestArrivalFor(saved.departLocal, lead);
    await recordPersonalConstraint({
      tripId: saved.tripId,
      subjectUserId: userId,
      actorUserId: userId,
      channel: "PRIVATE",
      kind: "LATEST_END",
      localTime: latest.hhmm,
      onDate: new Date(`${latest.date}T00:00:00.000Z`),
      note: `From your confirmed ${saved.mode.toLowerCase()} (departs ${timeLabel(saved.departLocal)}); assumed ${lead / 60}h${lead % 60 ? ` ${lead % 60}m` : ""} lead time.`,
      sourceMessageId: null,
      confidence: "MEDIUM",
    }).catch(() => undefined);
  }

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { name: true } });
  // GROUP-safe projection only: who, how, when and where they ARRIVE. No PNR, no
  // name on the ticket, no carrier-specific identifiers.
  await prisma.tripEvent.create({
    data: {
      tripId: saved.tripId,
      kind: "TRAVELLER_JOURNEY_CONFIRMED",
      scope: "GROUP",
      actorUserId: userId,
      subjectUserId: userId,
      sourceChannel: "DOCUMENT",
      confidence: "HIGH",
      payload: JSON.stringify({ name: user?.name, mode: saved.mode, arriveLocal: saved.arriveLocal, arrivalPlace: saved.arrivalPlaceName, resolvedArrival: Boolean(arrival), journeyId: saved.id }),
      propagation: JSON.stringify(["my-clockwise", "plan", "ready", "rendezvous", "notifications"]),
    },
  });

  // Close the private confirm card.
  const cards = await prisma.message.findMany({ where: { tripId: saved.tripId, channel: "PRIVATE", recipientId: userId, cardStatus: "PENDING", cardData: { contains: j.id } }, select: { id: true } });
  for (const c of cards) await prisma.message.update({ where: { id: c.id }, data: { cardStatus: "CONFIRMED" } });

  await recomputeRendezvous(saved.tripId).catch((err: unknown) => console.error("[rendezvous]", err instanceof Error ? err.message : err));

  const others = (await prisma.tripMember.findMany({ where: { tripId: saved.tripId }, select: { userId: true } })).map((m) => m.userId).filter((id) => id !== userId);
  await notify({
    tripId: saved.tripId,
    recipientIds: others,
    severity: "INFO",
    kind: "JOURNEY_CONFIRMED",
    title: `${user?.name ?? "A traveller"} confirmed their arrival ${MODE_ICON[saved.mode] ?? ""}`,
    body: saved.arriveLocal ? `Arrives ${dayLabel(saved.arriveLocal)} at ${timeLabel(saved.arriveLocal)}${saved.arrivalPlaceName ? ` · ${saved.arrivalPlaceName}` : ""}.` : "Their journey is now in the Plan.",
    href: `/trips/${saved.tripId}/plan`,
  });
  for (const path of ["plan", "agent", "agent/journey", "agent/ready", "room"]) revalidatePath(`/trips/${saved.tripId}/${path}`);
  return { ok: true };
}

export async function discardJourney(journeyId: string, userId: string) {
  const j = await prisma.travellerJourney.findUnique({ where: { id: journeyId } });
  if (!j || j.userId !== userId) return;
  await prisma.travellerJourney.update({ where: { id: j.id }, data: { status: "DISCARDED" } });
  const cards = await prisma.message.findMany({ where: { tripId: j.tripId, channel: "PRIVATE", recipientId: userId, cardStatus: "PENDING", cardData: { contains: j.id } }, select: { id: true } });
  for (const c of cards) await prisma.message.update({ where: { id: c.id }, data: { cardStatus: "DISMISSED" } });
  revalidatePath(`/trips/${j.tripId}/agent/journey`);
}

export async function myJourneys(tripId: string, userId: string) {
  const rows = await prisma.travellerJourney.findMany({ where: { tripId, userId, status: { in: ["PENDING_CONFIRMATION", "CONFIRMED"] } }, orderBy: { createdAt: "desc" } });
  return { pending: rows.find((r) => r.status === "PENDING_CONFIRMATION") ?? null, confirmed: rows.find((r) => r.status === "CONFIRMED") ?? null };
}

// What the whole group may see: arrival facts of CONFIRMED journeys.
export async function groupJourneys(tripId: string) {
  const rows = await prisma.travellerJourney.findMany({ where: { tripId, status: "CONFIRMED" }, orderBy: { arriveLocal: "asc" } });
  const users = await prisma.user.findMany({ where: { id: { in: rows.map((r) => r.userId) } }, select: { id: true, name: true } });
  const name = new Map(users.map((u) => [u.id, u.name]));
  return rows.map((r) => ({
    id: r.id,
    userId: r.userId,
    name: name.get(r.userId) ?? "Traveller",
    mode: r.mode,
    originName: r.originName,
    arriveLocal: r.arriveLocal,
    arrivalPlaceName: r.arrivalPlaceName,
    routeToStaySeconds: r.routeToStaySeconds,
    routeToStayMeters: r.routeToStayMeters,
    routeProvider: r.routeProvider,
  }));
}
