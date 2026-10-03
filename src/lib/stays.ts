// Stays: discovery -> saved (private) -> proposed -> group vote -> organiser
// approval -> marked booked. Only a CONFIRMED stay is authoritative for the
// Plan, routing and "our hotel". Discovery data comes from the HotelProvider
// only; this file never writes a price or availability it was not given.
import { prisma } from "./prisma";
import { getTripById } from "./trip";
import { createProposal, type ProposalPayload } from "./proposals";
import { resolveTripCityPoint } from "./travel/resolve";
import { hotelProvider, type HotelListing } from "./travel/hotel-provider";
import { notify } from "./notifications";
import { getClockwiseUserId } from "./clockwise";
import { formatMoney } from "./budget/money";
import { createExpense } from "./budget/ledger";
import { revalidatePath } from "next/cache";

export type StayRef = NonNullable<ProposalPayload["stay"]>;

export type StayFinding =
  | {
      ok: true;
      destination: string;
      dates: string | null;
      nights: number | null;
      travellers: number;
      listings: HotelListing[];
      notes: string[];
    }
  | { ok: false; error: string };

const DAY = 86_400_000;
const fmt = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

export function tripWindow(trip: { coreStartDate: Date | null; coreEndDate: Date | null }) {
  if (!trip.coreStartDate || !trip.coreEndDate) return { dates: null as string | null, nights: null as number | null };
  const nights = Math.max(1, Math.round((trip.coreEndDate.getTime() - trip.coreStartDate.getTime()) / DAY));
  return { dates: `${fmt(trip.coreStartDate)} – ${fmt(trip.coreEndDate)}`, nights };
}

// Preferences the provider's data can honestly support. Anything else is
// reported back as "not something this data can filter" rather than faked.
const SUPPORTED_WANTS = new Set(["Central"]);

export async function findStays(tripId: string, wants: string[] = []): Promise<StayFinding> {
  if (!hotelProvider.isConfigured()) return { ok: false, error: "Stay search isn't connected in this environment yet (no Geoapify key)." };
  const trip = await getTripById(tripId);
  const city = await resolveTripCityPoint(trip);
  if (!city) return { ok: false, error: "I don't know where the trip is yet — add a destination first." };
  let listings: HotelListing[];
  try {
    listings = await hotelProvider.search(city.point, { radiusMeters: 6000, limit: 12 });
  } catch (err) {
    return { ok: false, error: `Stay search failed: ${err instanceof Error ? err.message : "unknown error"}.` };
  }
  // "Central" = closest to the city point. The distance is the provider's.
  if (wants.includes("Central")) listings = [...listings].sort((a, b) => (a.distanceMeters ?? 1e9) - (b.distanceMeters ?? 1e9));
  const notes = wants.filter((w) => !SUPPORTED_WANTS.has(w)).map((w) => `"${w}" isn't something this place data can tell us — check each stay's page.`);
  const { dates, nights } = tripWindow(trip);
  return { ok: true, destination: city.label, dates, nights, travellers: trip.members.length, listings, notes };
}

export function toStayRef(l: HotelListing, window?: { checkIn?: Date | null; checkOut?: Date | null; travellers?: number }): StayRef {
  return {
    provider: l.provider,
    providerPlaceId: l.providerPlaceId,
    name: l.name,
    address: l.address,
    latitude: l.latitude,
    longitude: l.longitude,
    retrievedAt: l.retrievedAt,
    checkIn: window?.checkIn?.toISOString(),
    checkOut: window?.checkOut?.toISOString(),
    travellers: window?.travellers,
  };
}

export async function saveStay(tripId: string, userId: string, stay: StayRef): Promise<{ ok: boolean; saved: boolean }> {
  const member = await prisma.tripMember.findFirst({ where: { tripId, userId }, select: { id: true } });
  if (!member) return { ok: false, saved: false };
  const key = { tripId_userId_provider_providerPlaceId: { tripId, userId, provider: stay.provider, providerPlaceId: stay.providerPlaceId } };
  const existing = await prisma.savedPlace.findUnique({ where: key });
  if (existing) {
    await prisma.savedPlace.delete({ where: key });
    return { ok: true, saved: false };
  }
  await prisma.savedPlace.create({
    data: {
      tripId,
      userId,
      kind: "STAY",
      provider: stay.provider,
      providerPlaceId: stay.providerPlaceId,
      name: stay.name,
      address: stay.address,
      latitude: stay.latitude,
      longitude: stay.longitude,
      retrievedAt: new Date(stay.retrievedAt),
    },
  });
  return { ok: true, saved: true };
}

export async function savedStayIds(tripId: string, userId: string): Promise<string[]> {
  const rows = await prisma.savedPlace.findMany({ where: { tripId, userId, kind: "STAY" }, select: { providerPlaceId: true } });
  return rows.map((r) => r.providerPlaceId);
}

// Proposing never touches the Plan: it only opens a vote.
export async function proposeStay(tripId: string, userId: string, stay: StayRef): Promise<{ ok: true; proposalId: string; duplicate?: boolean } | { ok: false; error: string }> {
  const trip = await getTripById(tripId);
  const member = trip.members.find((m) => m.userId === userId);
  if (!member) return { ok: false, error: "You're not on this trip." };
  const open = await prisma.proposal.findMany({ where: { tripId, type: "BOOKING", status: { in: ["AWAITING_APPROVAL", "APPROVED"] } } });
  const dup = open.find((p) => {
    try {
      return (JSON.parse(p.payload) as ProposalPayload).stay?.providerPlaceId === stay.providerPlaceId;
    } catch {
      return false;
    }
  });
  if (dup) return { ok: true, proposalId: dup.id, duplicate: true };

  const { dates, nights } = tripWindow(trip);
  const timing = dates && nights ? `${dates} · ${nights} night${nights === 1 ? "" : "s"}` : undefined;
  const withWindow = { ...stay, checkIn: trip.coreStartDate?.toISOString(), checkOut: trip.coreEndDate?.toISOString(), travellers: trip.members.length };
  const clockwiseUserId = await getClockwiseUserId();
  const proposal = await createProposal({
    tripId,
    type: "BOOKING",
    title: `Stay: ${stay.name}`,
    summary: `${member.user.name} proposed staying at ${stay.name}${timing ? ` (${timing})` : ""}. Live rates aren't connected, so there is no price yet.`,
    payload: { provider: stay.provider, destination: stay.address ?? stay.name, timing, stay: withWindow },
    createdBy: userId,
  });
  const message = await prisma.message.create({
    data: { tripId, senderId: clockwiseUserId, channel: "GROUP", content: `Proposal: Stay: ${stay.name}` },
  });
  await prisma.proposal.update({ where: { id: proposal.id }, data: { groupMessageId: message.id } });
  await prisma.tripEvent.create({
    data: {
      tripId,
      kind: "STAY_PROPOSED",
      scope: "GROUP",
      actorUserId: userId,
      sourceChannel: "SYSTEM",
      confidence: "HIGH",
      payload: JSON.stringify({ name: stay.name, provider: stay.provider, providerPlaceId: stay.providerPlaceId, proposalId: proposal.id }),
      propagation: JSON.stringify(["proposals", "notifications"]),
    },
  });
  const others = trip.members.map((m) => m.userId).filter((id) => id !== userId);
  await notify({ tripId, recipientIds: others, severity: "IMPORTANT", kind: "STAY_PROPOSED", title: "A stay was proposed", body: `${member.user.name} proposed ${stay.name}. Your vote is needed.`, href: `/trips/${tripId}/room` });
  return { ok: true, proposalId: proposal.id };
}

// Organiser confirmed the proposal: the group's choice is APPROVED. It is not
// booked and not yet authoritative for the Plan.
export async function approveStayFromProposal(proposal: { id: string; tripId: string; title: string }, stay: StayRef): Promise<{ bookingId: string }> {
  const data = {
    tripId: proposal.tripId,
    type: "STAY",
    status: "APPROVED",
    participantIds: JSON.stringify([]),
    provider: stay.provider,
    amount: null,
    currency: null,
    placeName: stay.name,
    formattedAddress: stay.address,
    latitude: stay.latitude,
    longitude: stay.longitude,
    providerPlaceId: stay.providerPlaceId,
    locationProvider: stay.provider,
    checkIn: stay.checkIn ? new Date(stay.checkIn) : null,
    checkOut: stay.checkOut ? new Date(stay.checkOut) : null,
    detailsJson: JSON.stringify({ provider: stay.provider, providerPlaceId: stay.providerPlaceId, retrievedAt: stay.retrievedAt, isLiveRate: false, isBookable: false }),
    sourceProposalId: proposal.id,
  };
  const existing = await prisma.booking.findUnique({ where: { sourceProposalId: proposal.id } });
  const booking = existing ? await prisma.booking.update({ where: { id: existing.id }, data }) : await prisma.booking.create({ data });
  await prisma.tripEvent.create({
    data: {
      tripId: proposal.tripId,
      kind: "STAY_APPROVED",
      scope: "GROUP",
      sourceChannel: "SYSTEM",
      confidence: "HIGH",
      payload: JSON.stringify({ name: stay.name, bookingId: booking.id, booked: false }),
      propagation: JSON.stringify(["proposals", "notifications"]),
    },
  });
  const members = (await prisma.tripMember.findMany({ where: { tripId: proposal.tripId }, select: { userId: true } })).map((m) => m.userId);
  await notify({ tripId: proposal.tripId, recipientIds: members, severity: "IMPORTANT", kind: "STAY_APPROVED", title: "Everyone's aligned on a stay ✦", body: `${stay.name} is approved. It becomes the plan once it's booked.`, href: `/trips/${proposal.tripId}/room` });
  return { bookingId: booking.id };
}

// The one place a stay becomes authoritative. Everything downstream reads the
// Booking row (STAY + CONFIRMED) — Plan, My Clockwise, "our hotel" routing —
// so there is exactly one propagation point.
export async function markStayBooked(
  bookingId: string,
  actorUserId: string,
  money?: { amountMinor: number; currency: string }
): Promise<{ ok: true } | { ok: false; error: string }> {
  const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
  if (!booking || booking.type !== "STAY") return { ok: false, error: "Stay not found." };
  const trip = await prisma.trip.findUnique({ where: { id: booking.tripId }, select: { createdBy: true } });
  const member = await prisma.tripMember.findFirst({ where: { tripId: booking.tripId, userId: actorUserId }, select: { id: true } });
  if (!member) return { ok: false, error: "You're not on this trip." };
  if (actorUserId !== trip?.createdBy) return { ok: false, error: "Only the organiser can mark a stay as booked." };
  if (booking.status === "CONFIRMED") return { ok: true };
  if (booking.status !== "APPROVED") return { ok: false, error: "The group hasn't approved this stay yet." };

  await prisma.booking.update({ where: { id: booking.id }, data: { status: "CONFIRMED", amount: money?.amountMinor ?? null, currency: money?.currency ?? null } });
  await prisma.tripEvent.create({
    data: {
      tripId: booking.tripId,
      kind: "STAY_CONFIRMED",
      scope: "GROUP",
      actorUserId,
      sourceChannel: "SYSTEM",
      confidence: "HIGH",
      payload: JSON.stringify({ name: booking.placeName, bookingId: booking.id, checkIn: booking.checkIn, checkOut: booking.checkOut, lat: booking.latitude, lng: booking.longitude }),
      propagation: JSON.stringify(["plan", "my-clockwise", "routing", "rendezvous-anchor", "notifications", ...(money ? ["budget"] : [])]),
    },
  });
  if (money && money.amountMinor > 0) {
    const members = (await prisma.tripMember.findMany({ where: { tripId: booking.tripId }, select: { userId: true } })).map((m) => m.userId);
    await createExpense({
      tripId: booking.tripId,
      actorUserId,
      title: `Stay: ${booking.placeName}`,
      category: "STAYS",
      amountMinor: money.amountMinor,
      currency: money.currency,
      stage: "COMMITTED",
      status: "ACTIVE",
      source: "BOOKING",
      sourceReferenceId: booking.id,
      splitMethod: "EQUAL",
      participants: members.map((userId) => ({ userId })),
      idempotencyKey: `stay:${booking.id}`,
    }).catch((err) => console.error("[stays] budget commit failed:", err instanceof Error ? err.message : err));
  }
  const members = (await prisma.tripMember.findMany({ where: { tripId: booking.tripId }, select: { userId: true } })).map((m) => m.userId);
  await notify({
    tripId: booking.tripId,
    recipientIds: members,
    severity: "IMPORTANT",
    kind: "STAY_CONFIRMED",
    title: "Your stay is booked",
    body: `${booking.placeName} is confirmed${money ? ` (${formatMoney(money.amountMinor, money.currency)})` : ""}. It's now in the Plan.`,
    href: `/trips/${booking.tripId}/plan`,
  });
  for (const path of ["plan", "room", "agent", "budget"]) revalidatePath(`/trips/${booking.tripId}/${path}`);
  return { ok: true };
}

// The trip's stay: confirmed beats approved; null if there is none.
export async function getTripStay(tripId: string) {
  const rows = await prisma.booking.findMany({ where: { tripId, type: "STAY", status: { in: ["CONFIRMED", "APPROVED"] } }, orderBy: { createdAt: "desc" } });
  return rows.find((r) => r.status === "CONFIRMED") ?? rows[0] ?? null;
}
