// The bridge between the approval lifecycle (src/lib/proposals.ts) and
// Plan's structured tables. Called ONLY from organiserHardConfirm, after
// status has already moved to CONFIRMED — this file never decides
// authorization, it only performs the typed mutation. Chat is where
// people discuss; this is what makes a confirmed idea actually become
// Plan state instead of dying inside Message.cardData.
import type { Proposal } from "@prisma/client";
import { prisma } from "./prisma";
import { decodeProposalPayload } from "./proposals";
import { resolveTripLocationText, isResolveFailure } from "./travel/resolve";
import { hasValidCoordinates } from "./location/types";

export type ExecutionResult = { ok: true; summary: string } | { ok: false; error: string };

// Looks up whether the proposal THIS one supersedes already produced a
// structured record — if so, execution updates that record instead of
// creating a new one, so revising a proposal never duplicates Plan state.
// Only looks back one hop (the direct supersedesId): every successful
// execution re-stamps the record with the CURRENT proposal's id, so a
// chain of revisions propagates one confirmation at a time rather than
// needing a deep walk here.
async function findSupersededDestination(proposal: Proposal) {
  if (!proposal.supersedesId) return null;
  return prisma.destination.findUnique({ where: { sourceProposalId: proposal.supersedesId } });
}

async function findSupersededBooking(proposal: Proposal) {
  if (!proposal.supersedesId) return null;
  return prisma.booking.findUnique({ where: { sourceProposalId: proposal.supersedesId } });
}

async function executeItineraryChange(proposal: Proposal): Promise<ExecutionResult> {
  const payload = decodeProposalPayload(proposal.payload);
  const text = payload.destination?.trim();
  if (!text) return { ok: false, error: "This proposal has no destination text to resolve." };

  const resolved = await resolveTripLocationText(text, proposal.tripId);
  if (isResolveFailure(resolved)) {
    return { ok: false, error: `Couldn't resolve "${text}": ${resolved.error}` };
  }
  if (!hasValidCoordinates({ latitude: resolved.point.lat, longitude: resolved.point.lng })) {
    return { ok: false, error: "Resolved coordinates were out of range — refusing to persist them." };
  }

  const trip = await prisma.trip.findUniqueOrThrow({
    where: { id: proposal.tripId },
    include: { destinations: true },
  });

  // Already on the trip at this exact resolved point — resolveTripLocationText
  // matched an existing stored destination (see findStoredDestinationPoint
  // in resolve.ts), so this proposal is re-affirming/updating an existing
  // stop, not adding a new one. Never touch `provider` here: that field is
  // provenance (who originally resolved it), not "who most recently
  // confirmed it."
  const exactMatch = trip.destinations.find(
    (d) => d.latitude === resolved.point.lat && d.longitude === resolved.point.lng
  );

  const target = exactMatch ?? (await findSupersededDestination(proposal));

  if (target) {
    await prisma.destination.update({
      where: { id: target.id },
      data: { displayName: resolved.label, sourceProposalId: proposal.id },
    });
    return { ok: true, summary: `Updated destination "${resolved.label}" on the Plan.` };
  }

  const nextOrder = trip.destinations.length > 0 ? Math.max(...trip.destinations.map((d) => d.order)) + 1 : 0;
  await prisma.destination.create({
    data: {
      tripId: proposal.tripId,
      name: text,
      displayName: resolved.label,
      latitude: resolved.point.lat,
      longitude: resolved.point.lng,
      // resolveTripLocationText's live-geocode fallback (the only path
      // reached when no stored destination matched) always resolves via
      // Geoapify — see src/lib/travel/resolve.ts. Real provenance, not a
      // guess.
      provider: "geoapify",
      order: nextOrder,
      sourceProposalId: proposal.id,
    },
  });
  return { ok: true, summary: `Added "${resolved.label}" to the Plan.` };
}

async function executeBooking(proposal: Proposal): Promise<ExecutionResult> {
  const payload = decodeProposalPayload(proposal.payload);

  let location: { label: string; point: { lat: number; lng: number } } | null = null;
  if (payload.destination?.trim()) {
    const resolved = await resolveTripLocationText(payload.destination.trim(), proposal.tripId);
    if (!isResolveFailure(resolved) && hasValidCoordinates({ latitude: resolved.point.lat, longitude: resolved.point.lng })) {
      location = resolved;
    }
    // A location that fails to resolve is not a hard error for a booking
    // (e.g. a payment-only proposal with no place attached) — it's simply
    // omitted, never fabricated.
  }

  const existing = await findSupersededBooking(proposal);

  const data = {
    tripId: proposal.tripId,
    type: "BOOKING",
    status: "CONFIRMED",
    participantIds: JSON.stringify([]),
    provider: payload.provider ?? "clockwise",
    amount: payload.amount ?? null,
    currency: payload.currency ?? null,
    placeName: location?.label ?? null,
    latitude: location?.point.lat ?? null,
    longitude: location?.point.lng ?? null,
    locationProvider: location ? "geoapify" : null,
    sourceProposalId: proposal.id,
  };

  if (existing) {
    await prisma.booking.update({ where: { id: existing.id }, data });
    return { ok: true, summary: `Updated booking "${proposal.title}" on the Plan.` };
  }
  await prisma.booking.create({ data });
  return { ok: true, summary: `Created booking "${proposal.title}" on the Plan.` };
}

export async function executeConfirmedProposal(proposal: Proposal): Promise<ExecutionResult> {
  switch (proposal.type) {
    case "ITINERARY_CHANGE":
      return executeItineraryChange(proposal);
    case "BOOKING":
      return executeBooking(proposal);
    case "UBER_RIDE":
      // Deliberately not implemented yet (R6 — the Uber-specific bridge
      // deserves its own isolated, carefully-tested pass, not a rushed
      // addition here). Confirming must not silently no-op as if a ride
      // had actually been requested — this is an explicit, honest
      // failure, not a fake success.
      return { ok: false, error: "Uber ride execution isn't wired to the proposal flow yet." };
    case "DOCUMENT_UPDATE":
    case "OTHER":
      return { ok: false, error: `Execution for proposal type ${proposal.type} isn't implemented yet.` };
    default:
      return { ok: false, error: "Unknown proposal type." };
  }
}
