// PRIVATE DISCOVERY -> SAVE -> OVERLAP -> PROPOSE -> GROUP VOTE -> AGREED PLACE -> PLAN.
// ADDITIVE: place proposals ride the existing proposal/vote/organiser-confirm machinery
// (type OTHER, payload.place). Agreement means "the group agreed on this place". It does
// not mean booked, reserved or scheduled, and the Plan says exactly that.
import { prisma } from "@/lib/prisma";
import { getTripById } from "@/lib/trip";
import { createProposal, type ProposalPayload } from "@/lib/proposals";
import { notify } from "@/lib/notifications";
import { getClockwiseUserId } from "@/lib/clockwise";

export type PlaceRef = NonNullable<ProposalPayload["place"]>;

const KIND_WORD: Record<string, string> = { CAFE: "Coffee", RESTAURANT: "Food", ATTRACTION: "Something to do", PARK: "A park", SHOPPING: "Shopping", NIGHTLIFE: "A night out", CONVENIENCE: "A shop", SUPERMARKET: "A shop", PHARMACY: "A pharmacy", ATM: "An ATM" };
export const kindWord = (k: string) => KIND_WORD[k.toUpperCase()] ?? "A place";

export async function proposePlace(tripId: string, userId: string, place: PlaceRef): Promise<{ ok: true; proposalId: string; duplicate?: boolean } | { ok: false; error: string }> {
  if (place.provider !== "geoapify" || !place.providerPlaceId || !Number.isFinite(place.latitude) || !Number.isFinite(place.longitude)) return { ok: false, error: "Only real places from the search provider can be proposed." };
  const trip = await getTripById(tripId);
  const member = trip.members.find((m) => m.userId === userId);
  if (!member) return { ok: false, error: "You're not on this trip." };

  const open = await prisma.proposal.findMany({ where: { tripId, type: "OTHER", status: { in: ["AWAITING_APPROVAL", "APPROVED"] } } });
  const dup = open.find((p) => {
    try {
      return (JSON.parse(p.payload) as ProposalPayload).place?.providerPlaceId === place.providerPlaceId;
    } catch {
      return false;
    }
  });
  if (dup) return { ok: true, proposalId: dup.id, duplicate: true };

  const clockwiseUserId = await getClockwiseUserId();
  const proposal = await createProposal({
    tripId,
    type: "OTHER",
    title: `${place.name}: ${kindWord(place.kind)}?`,
    summary: `${member.user.name} suggested ${place.name}${place.address ? ` (${place.address})` : ""}. Agreeing means the group picks this place. Nothing is booked or scheduled.`,
    payload: { provider: "geoapify", destination: place.address ?? place.name, place },
    createdBy: userId,
  });
  const message = await prisma.message.create({ data: { tripId, senderId: clockwiseUserId, channel: "GROUP", content: `Proposal: ${proposal.title}` } });
  await prisma.proposal.update({ where: { id: proposal.id }, data: { groupMessageId: message.id } });
  await prisma.tripEvent.create({
    data: {
      tripId,
      kind: "PLACE_PROPOSED",
      scope: "GROUP",
      actorUserId: userId,
      sourceChannel: "SYSTEM",
      confidence: "HIGH",
      payload: JSON.stringify({ name: place.name, provider: place.provider, providerPlaceId: place.providerPlaceId, retrievedAt: place.retrievedAt, proposalId: proposal.id }),
      propagation: JSON.stringify(["proposals", "notifications"]),
    },
  });
  const others = trip.members.map((m) => m.userId).filter((id) => id !== userId);
  await notify({ tripId, recipientIds: others, severity: "IMPORTANT", kind: "PLACE_PROPOSED", title: "A place was suggested", body: `${member.user.name} suggested ${place.name}. Your vote is needed.`, href: `/trips/${tripId}/room` });
  return { ok: true, proposalId: proposal.id };
}

// Called only after the organiser confirmed the group's vote. Creates the agreed place; never a booking.
export async function agreeOnPlace(proposal: { id: string; tripId: string }, place: PlaceRef): Promise<{ ok: true; summary: string }> {
  const existing = await prisma.booking.findUnique({ where: { sourceProposalId: proposal.id } });
  if (!existing) {
    const members = await prisma.tripMember.findMany({ where: { tripId: proposal.tripId }, select: { userId: true } });
    await prisma.booking.create({
      data: {
        tripId: proposal.tripId,
        type: "PLACE",
        status: "AGREED",
        participantIds: JSON.stringify(members.map((m) => m.userId)),
        provider: "geoapify",
        placeName: place.name,
        formattedAddress: place.address,
        latitude: place.latitude,
        longitude: place.longitude,
        providerPlaceId: place.providerPlaceId,
        locationProvider: "geoapify",
        sourceProposalId: proposal.id,
        detailsJson: JSON.stringify({ kind: place.kind, retrievedAt: place.retrievedAt, bookable: false }),
      },
    });
    await prisma.tripEvent.create({
      data: { tripId: proposal.tripId, kind: "PLACE_AGREED", scope: "GROUP", sourceChannel: "SYSTEM", confidence: "HIGH", payload: JSON.stringify({ name: place.name, provider: place.provider, providerPlaceId: place.providerPlaceId, proposalId: proposal.id, booked: false }), propagation: JSON.stringify(["plan", "around-you"]) },
    });
    const clockwiseUserId = await getClockwiseUserId();
    await prisma.message.create({ data: { tripId: proposal.tripId, senderId: clockwiseUserId, channel: "GROUP", content: `The group agreed on ${place.name}. It's in the Plan as an agreed place. Nothing is booked or scheduled.` } });
  }
  return { ok: true, summary: `The group agreed on ${place.name}. It's an agreed place in the Plan, not a booking.` };
}

export async function agreedPlaces(tripId: string) {
  return prisma.booking.findMany({ where: { tripId, type: "PLACE", status: "AGREED" }, orderBy: { createdAt: "desc" } });
}
