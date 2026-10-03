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
import { getOrganiserAuth, resolveRoute, isFailure } from "./transport";
import { mobilityProvider } from "./providers/mobility";
import { createTripPaymentRequest } from "./trip-payments";
import { commitFromProposal } from "./budget/ledger";

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

// Re-validated here rather than trusted from the stored payload — the
// same rule as everywhere else an LLM-originated value reaches a typed
// column: a malformed string is dropped (startDate/endDate end up null),
// never written as-is and never blocks the rest of the execution.
function parseIsoDatetime(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

async function executeItineraryChange(proposal: Proposal): Promise<ExecutionResult> {
  const payload = decodeProposalPayload(proposal.payload);
  const text = payload.destination?.trim();
  if (!text) return { ok: false, error: "This proposal has no destination text to resolve." };
  const startDate = parseIsoDatetime(payload.startTime);
  const endDate = parseIsoDatetime(payload.endTime);

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
    // The actual "make it 10 instead" fix: previously only displayName/
    // sourceProposalId were updated here, so a revised time never
    // actually reached Plan state even though the place-level dedup
    // (exactMatch, above) was already correctly avoiding a duplicate row.
    // Only overwrite a date when THIS proposal actually carried one —
    // never null out an existing confirmed time just because a later,
    // unrelated proposal about the same place happened to omit timing.
    await prisma.destination.update({
      where: { id: target.id },
      data: {
        displayName: resolved.label,
        sourceProposalId: proposal.id,
        ...(startDate ? { startDate } : {}),
        ...(endDate ? { endDate } : {}),
      },
    });
    return {
      ok: true,
      summary: `Updated destination "${resolved.label}"${startDate ? ` to ${startDate.toISOString()}` : ""} on the Plan.`,
    };
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
      startDate,
      endDate,
    },
  });
  return { ok: true, summary: `Added "${resolved.label}"${startDate ? ` at ${startDate.toISOString()}` : ""} to the Plan.` };
}

async function executeBooking(proposal: Proposal): Promise<ExecutionResult> {
  const payload = decodeProposalPayload(proposal.payload);

  // Real fix, not a refactor: this previously marked every booking
  // "CONFIRMED" the instant the organiser approved the PROPOSAL, even one
  // carrying a real amount/currency — conflating "the group/organiser
  // agreed this should happen" with "money actually moved," with no
  // payment ever processed anywhere. A proposal that names an amount is a
  // payment request, not a settled booking; it only becomes CONFIRMED
  // once Pine Labs reports PROCESSED (see the webhook,
  // /api/integrations/pinelabs/webhook).
  if (payload.amount != null && payload.amount > 0) {
    const payerId = proposal.organiserConfirmedBy ?? proposal.createdBy ?? undefined;
    const payer = payerId ? await prisma.user.findUnique({ where: { id: payerId }, select: { name: true, email: true, phone: true } }) : null;
    const result = await createTripPaymentRequest({
      tripId: proposal.tripId,
      purpose: proposal.title,
      amountMinorUnits: Math.round(payload.amount * 100),
      currency: payload.currency ?? "INR",
      sourceProposalId: proposal.id,
      payerId,
      payerName: payer?.name,
      payerContact: payer?.email ?? payer?.phone ?? undefined,
    });
    if (!result.ok) {
      return { ok: false, error: `Couldn't create the payment request: ${result.reason}` };
    }
    // Group-approved and awaiting payment: the money is COMMITTED in Budget (never PAID until verified).
    await commitFromProposal({
      tripId: proposal.tripId,
      proposalId: proposal.id,
      title: proposal.title,
      amountMajor: payload.amount,
      currency: payload.currency ?? "INR",
      actorUserId: proposal.organiserConfirmedBy ?? proposal.createdBy ?? "",
    }).catch((err) => console.error("[budget] commit failed:", err instanceof Error ? err.message : err));
    return { ok: true, summary: `Payment request created for "${proposal.title}" — ${result.status}.` };
  }

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

  // No amount involved — this is a reservation/plan item with no payment
  // rail behind it (e.g. "book the 7pm table"), so there's nothing a
  // provider could confirm; CONFIRMED here means "the group/organiser
  // settled on this," never "money moved."
  const data = {
    tripId: proposal.tripId,
    type: "BOOKING",
    status: "CONFIRMED",
    participantIds: JSON.stringify([]),
    provider: payload.provider ?? "clockwise",
    amount: null,
    currency: null,
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

// R6 — the Uber-specific execution bridge. Reuses the exact same
// getOrganiserAuth/resolveRoute/mobilityProvider plumbing transport-actions.ts's
// confirmRideRequest already uses for the human-button-pressed flow — this
// is a second caller of that same real infrastructure, not a parallel
// reimplementation. Picks the first real option Uber actually returns
// (never a guessed/fabricated one); there is no human in this path
// choosing a specific vehicle, so "first available, real party size" is
// the deliberate default — a future pass could let the proposal specify a
// preferred product.
//
// IMPORTANT: this function performs a REAL Uber Sandbox ride request on
// success. It is reachable ONLY through organiserHardConfirm
// (src/lib/proposals.ts), which requires trip.createdBy specifically —
// the same hard-confirm gate every other proposal type goes through. No
// LLM output and no member vote can reach this code path by itself.
async function executeUberRide(proposal: Proposal): Promise<ExecutionResult> {
  const payload = decodeProposalPayload(proposal.payload);
  const pickupText = payload.pickup?.trim();
  const destinationText = payload.destination?.trim();
  if (!pickupText || !destinationText) {
    return { ok: false, error: "This proposal is missing a pickup or destination — can't request a ride." };
  }

  const auth = await getOrganiserAuth(proposal.tripId);
  if (isFailure(auth)) return { ok: false, error: auth.error };

  const route = await resolveRoute({ pickup: pickupText, destination: destinationText });
  if (isFailure(route)) return { ok: false, error: route.error };

  const partySize = payload.peopleAffected && payload.peopleAffected.length > 0 ? payload.peopleAffected.length : 1;

  let options;
  try {
    options = await mobilityProvider.getEstimate(auth, route, partySize);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Uber didn't return any ride options." };
  }
  const option = options[0];
  if (!option) return { ok: false, error: "Uber has no ride options available for this route right now." };

  let prepared;
  try {
    prepared = await mobilityProvider.prepareRide(auth, route, option.productId);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Couldn't get a fare quote from Uber." };
  }

  const existing = await findSupersededBooking(proposal);
  const bookingData = {
    tripId: proposal.tripId,
    type: "TRANSPORT",
    status: "PENDING",
    participantIds: JSON.stringify([]),
    provider: "uber",
    currency: prepared.currency,
    amount: Math.round((prepared.lowEstimate + prepared.highEstimate) / 2),
    sourceProposalId: proposal.id,
  };
  const booking = existing
    ? await prisma.booking.update({ where: { id: existing.id }, data: bookingData })
    : await prisma.booking.create({ data: bookingData });

  try {
    const result = await mobilityProvider.requestRide(auth, route, prepared);
    await prisma.booking.update({
      where: { id: booking.id },
      data: { status: "CONFIRMED", confirmationId: result.providerRideId },
    });
    return { ok: true, summary: `Uber ${option.displayName} requested — status: ${result.status}.` };
  } catch (err) {
    await prisma.booking.update({ where: { id: booking.id }, data: { status: "FAILED" } });
    return { ok: false, error: err instanceof Error ? err.message : "Uber couldn't process this ride request." };
  }
}

export async function executeConfirmedProposal(proposal: Proposal): Promise<ExecutionResult> {
  switch (proposal.type) {
    case "ITINERARY_CHANGE":
      return executeItineraryChange(proposal);
    case "BOOKING":
      return executeBooking(proposal);
    case "UBER_RIDE":
      return executeUberRide(proposal);
    case "DOCUMENT_UPDATE":
    case "OTHER":
      return { ok: false, error: `Execution for proposal type ${proposal.type} isn't implemented yet.` };
    default:
      return { ok: false, error: "Unknown proposal type." };
  }
}
