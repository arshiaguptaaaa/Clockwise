"use server";

// The Level-3 boundary for the Uber sandbox integration. Every external
// Uber call in this file happens only in response to an explicit human
// button press passed up from src/components/action-cards/TransportCard.tsx
// — Gemini (src/lib/agent/tools.ts) can only ever reach the read-only
// functions in src/lib/transport.ts, never anything here.
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/session";
import { updateCardStatus, decodeCard, encodeCard } from "@/lib/action-cards";
import { getOrganiserAuth, resolveRoute, assignVehicles, isFailure } from "@/lib/transport";
import { getUberConnection, getUberConnectionStatus } from "@/lib/uber/connection";
import {
  mobilityProvider,
  type VehicleOption,
  type PreparedRide,
} from "@/lib/providers/mobility";
import { isFareExpired, advanceSandboxRide } from "@/lib/providers/uber-sandbox-provider";

async function getPlanOrThrow(planId: string) {
  return prisma.transportPlan.findUniqueOrThrow({ where: { id: planId } });
}

function cityHintFor(destination: string) {
  // The demo's Vienna leg locations already include the city name; for
  // free-text real usage this is a no-op (geocodeLocation just appends it).
  return destination.includes(",") ? undefined : destination;
}

function revalidateTrip(tripId: string) {
  revalidatePath(`/trips/${tripId}/room`);
  revalidatePath(`/trips/${tripId}/agent`);
  revalidatePath(`/trips/${tripId}/plan`);
}

export type TransportPlanState = {
  plan: { id: string; pickup: string; destination: string; partySize: number; status: string };
  participants: { tripMemberId: string; userId: string; name: string; status: string }[];
  rideOrders: {
    id: string;
    productName: string | null;
    status: string;
    fareEstimateLow: number | null;
    fareEstimateHigh: number | null;
    currency: string | null;
    pickupEtaMinutes: number | null;
    errorMessage: string | null;
    memberNames: string[];
  }[];
  organiserId: string;
  organiserName: string;
  organiserConnected: boolean;
  viewerIsOrganiser: boolean;
  sandbox: boolean;
};

// Read-only — safe to call from anywhere, including on every TransportCard
// mount/refresh. Never mutates ride state itself.
export async function getTransportPlanState(planId: string): Promise<TransportPlanState> {
  const plan = await getPlanOrThrow(planId);
  const trip = await prisma.trip.findUniqueOrThrow({ where: { id: plan.tripId } });
  const organiser = await prisma.user.findUniqueOrThrow({ where: { id: trip.createdBy } });
  const { status: connectionStatus } = await getUberConnectionStatus(trip.createdBy);
  const viewerId = await getCurrentUserId();

  const participants = await prisma.transportParticipant.findMany({
    where: { transportPlanId: planId },
    include: { tripMember: { include: { user: true } } },
  });

  const rideOrders = await prisma.rideOrder.findMany({
    where: { transportPlanId: planId },
    include: { participants: { include: { tripMember: { include: { user: true } } } } },
    orderBy: { createdAt: "asc" },
  });

  return {
    plan: {
      id: plan.id,
      pickup: plan.pickup,
      destination: plan.destination,
      partySize: plan.partySize,
      status: plan.status,
    },
    participants: participants.map((p) => ({
      tripMemberId: p.tripMemberId,
      userId: p.tripMember.userId,
      name: p.tripMember.user.name,
      status: p.status,
    })),
    rideOrders: rideOrders.map((r) => ({
      id: r.id,
      productName: r.productName,
      status: r.status,
      fareEstimateLow: r.fareEstimateLow,
      fareEstimateHigh: r.fareEstimateHigh,
      currency: r.currency,
      pickupEtaMinutes: r.pickupEtaMinutes,
      errorMessage: r.errorMessage,
      memberNames: r.participants.map((p) => p.tripMember.user.name),
    })),
    organiserId: trip.createdBy,
    organiserName: organiser.name,
    // REAUTH_REQUIRED counts as not-connected here too — a stale
    // connection with no usable refresh path can't actually request
    // rides, so the UI shouldn't imply it can.
    organiserConnected: connectionStatus === "CONNECTED",
    viewerIsOrganiser: viewerId === trip.createdBy,
    sandbox: (process.env.UBER_ENV ?? "sandbox") === "sandbox",
  };
}

export async function updateTransportParticipant(
  planId: string,
  tripMemberId: string,
  status: "CONFIRMED" | "LEAVING_LATER"
) {
  await prisma.transportParticipant.updateMany({
    where: { transportPlanId: planId, tripMemberId },
    data: { status },
  });
  const plan = await getPlanOrThrow(planId);
  revalidateTrip(plan.tripId);
}

export async function checkTransportOptions(
  planId: string
): Promise<{ options: VehicleOption[] } | { error: string }> {
  const plan = await getPlanOrThrow(planId);

  const confirmed = await prisma.transportParticipant.count({
    where: { transportPlanId: planId, status: "CONFIRMED" },
  });
  if (confirmed === 0) {
    return { error: "Confirm at least one traveller as leaving together first." };
  }

  const auth = await getOrganiserAuth(plan.tripId);
  if (isFailure(auth)) return { error: auth.error };

  const route = await resolveRoute(plan, cityHintFor(plan.destination));
  if (isFailure(route)) return { error: route.error };

  let options: VehicleOption[];
  try {
    options = await mobilityProvider.getEstimate(auth, route, confirmed);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Uber didn't return any ride options." };
  }

  if (options.length === 0) {
    return { error: "Uber has no ride options available for this route right now." };
  }

  await prisma.transportPlan.updateMany({
    where: { id: planId, status: "DRAFT" },
    data: { status: "OPTIONS_READY", partySize: confirmed },
  });

  return { options };
}

export type PreparedVehicle = {
  memberNames: string[];
  prepared: PreparedRide;
};

export async function prepareRideConfirmation(
  planId: string,
  productId: string
): Promise<
  | { displayName: string; vehicles: PreparedVehicle[]; totalLow: number; totalHigh: number; currency: string }
  | { error: string }
> {
  const plan = await getPlanOrThrow(planId);

  const auth = await getOrganiserAuth(plan.tripId);
  if (isFailure(auth)) return { error: auth.error };

  const route = await resolveRoute(plan, cityHintFor(plan.destination));
  if (isFailure(route)) return { error: route.error };

  const confirmedParticipants = await prisma.transportParticipant.findMany({
    where: { transportPlanId: planId, status: "CONFIRMED" },
    include: { tripMember: { include: { user: true } } },
  });
  if (confirmedParticipants.length === 0) {
    return { error: "No confirmed travellers to arrange transport for." };
  }

  let options: VehicleOption[];
  try {
    options = await mobilityProvider.getEstimate(auth, route, confirmedParticipants.length);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Couldn't refresh Uber options." };
  }
  const option = options.find((o) => o.productId === productId);
  if (!option) {
    return { error: "That ride option is no longer available — please check rides again." };
  }

  const groups = assignVehicles(
    confirmedParticipants.map((p) => p.tripMemberId),
    option.vehiclesNeeded
  );
  const nameByTripMemberId = new Map(confirmedParticipants.map((p) => [p.tripMemberId, p.tripMember.user.name]));

  const vehicles: PreparedVehicle[] = [];
  try {
    for (const group of groups) {
      const prepared = await mobilityProvider.prepareRide(auth, route, productId);
      vehicles.push({
        memberNames: group.map((id) => nameByTripMemberId.get(id) ?? "Traveller"),
        prepared,
      });
    }
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Couldn't get a fare quote from Uber." };
  }

  const totalLow = vehicles.reduce((sum, v) => sum + v.prepared.lowEstimate, 0);
  const totalHigh = vehicles.reduce((sum, v) => sum + v.prepared.highEstimate, 0);

  return {
    displayName: option.displayName,
    vehicles,
    totalLow,
    totalHigh,
    currency: vehicles[0]?.prepared.currency ?? "USD",
  };
}

export type ConfirmRideResult =
  | { ok: true; state: TransportPlanState }
  | { ok: false; expired: true }
  | { ok: false; error: string };

// THE external-action boundary. Only ever called from the "CONFIRM &
// REQUEST RIDES" button — never from agent tool execution.
export async function confirmRideRequest(
  messageId: string,
  planId: string,
  productId: string,
  productName: string,
  prepared: PreparedRide[]
): Promise<ConfirmRideResult> {
  const plan = await getPlanOrThrow(planId);
  const actorId = await getCurrentUserId();

  // Idempotency: only one call can move the plan out of
  // DRAFT/OPTIONS_READY. A double-click's second call sees count === 0 and
  // just returns the (now in-flight or already-resolved) live state
  // instead of requesting a second set of rides.
  const claimed = await prisma.transportPlan.updateMany({
    where: { id: planId, status: { in: ["DRAFT", "OPTIONS_READY"] } },
    data: { status: "REQUESTING" },
  });
  if (claimed.count === 0) {
    return { ok: true, state: await getTransportPlanState(planId) };
  }

  const auth = await getOrganiserAuth(plan.tripId);
  if (isFailure(auth)) {
    await prisma.transportPlan.update({ where: { id: planId }, data: { status: "OPTIONS_READY" } });
    return { ok: false, error: auth.error };
  }

  if (prepared.some((p) => isFareExpired(p))) {
    await prisma.transportPlan.update({ where: { id: planId }, data: { status: "OPTIONS_READY" } });
    return { ok: false, expired: true };
  }

  const route = await resolveRoute(plan, cityHintFor(plan.destination));
  if (isFailure(route)) {
    await prisma.transportPlan.update({ where: { id: planId }, data: { status: "OPTIONS_READY" } });
    return { ok: false, error: route.error };
  }

  const confirmedParticipants = await prisma.transportParticipant.findMany({
    where: { transportPlanId: planId, status: "CONFIRMED" },
    include: { tripMember: true },
  });
  const groups = assignVehicles(
    confirmedParticipants.map((p) => p.tripMemberId),
    prepared.length
  );
  const userIdByTripMemberId = new Map(confirmedParticipants.map((p) => [p.tripMemberId, p.tripMember.userId]));

  const connection = await getUberConnection(auth.organiserId);
  await prisma.transportPlan.update({
    where: { id: planId },
    data: { requesterConnectionId: connection?.id ?? null },
  });

  let succeeded = 0;
  let failed = 0;

  for (let i = 0; i < prepared.length; i++) {
    const group = groups[i] ?? [];
    const groupUserIds = group.map((tmId) => userIdByTripMemberId.get(tmId)).filter(Boolean) as string[];

    const booking = await prisma.booking.create({
      data: {
        tripId: plan.tripId,
        type: "TRANSPORT",
        status: "PENDING",
        participantIds: JSON.stringify(groupUserIds),
        provider: "uber",
        currency: prepared[i].currency,
        amount: Math.round((prepared[i].lowEstimate + prepared[i].highEstimate) / 2),
      },
    });

    const rideOrder = await prisma.rideOrder.create({
      data: {
        transportPlanId: planId,
        bookingId: booking.id,
        provider: "uber",
        productId: prepared[i].productId,
        productName,
        status: "REQUESTING",
        fareEstimateLow: prepared[i].lowEstimate,
        fareEstimateHigh: prepared[i].highEstimate,
        currency: prepared[i].currency,
        idempotencyKey: `${planId}:${i}`,
      },
    });

    await prisma.transportParticipant.updateMany({
      where: { transportPlanId: planId, tripMemberId: { in: group } },
      data: { rideOrderId: rideOrder.id },
    });

    try {
      const result = await mobilityProvider.requestRide(auth, route, prepared[i]);
      await prisma.rideOrder.update({
        where: { id: rideOrder.id },
        data: {
          providerRideId: result.providerRideId,
          status: result.status,
          pickupEtaMinutes: result.pickupEtaMinutes,
          surgeMultiplier: result.surgeMultiplier,
        },
      });
      await prisma.booking.update({
        where: { id: booking.id },
        data: { status: "CONFIRMED", confirmationId: result.providerRideId },
      });
      succeeded++;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Uber couldn't process this ride request.";
      await prisma.rideOrder.update({
        where: { id: rideOrder.id },
        data: { status: "FAILED", errorMessage: message },
      });
      await prisma.booking.update({ where: { id: booking.id }, data: { status: "FAILED" } });
      failed++;
    }
  }

  const finalStatus = failed === 0 ? "CONFIRMED" : succeeded === 0 ? "FAILED" : "PARTIAL";
  await prisma.transportPlan.update({ where: { id: planId }, data: { status: finalStatus } });

  await prisma.auditLog.create({
    data: {
      tripId: plan.tripId,
      actorId: actorId ?? "unknown",
      actionType: "UBER_RIDE_REQUESTED",
      payloadSummary: `${succeeded} ride(s) requested successfully, ${failed} failed, for transport plan ${planId}.`,
    },
  });

  const original = await prisma.message.findUnique({ where: { id: messageId } });
  if (original?.cardData) {
    const data = decodeCard(original.cardData);
    const title =
      finalStatus === "CONFIRMED"
        ? `${succeeded} ride${succeeded === 1 ? "" : "s"} requested.`
        : finalStatus === "PARTIAL"
          ? `${succeeded} ride${succeeded === 1 ? "" : "s"} confirmed. Couldn't secure ${failed} more.`
          : `Couldn't secure any rides.`;
    await prisma.message.update({
      where: { id: messageId },
      data: { cardData: encodeCard({ ...data, title }) },
    });
  }
  await updateCardStatus(messageId, "CONFIRMED");

  revalidateTrip(plan.tripId);
  return { ok: true, state: await getTransportPlanState(planId) };
}

export async function retryRideOrder(rideOrderId: string): Promise<ConfirmRideResult> {
  const ride = await prisma.rideOrder.findUniqueOrThrow({
    where: { id: rideOrderId },
    include: { transportPlan: true },
  });

  const claimed = await prisma.rideOrder.updateMany({
    where: { id: rideOrderId, status: "FAILED" },
    data: { status: "REQUESTING", errorMessage: null },
  });
  if (claimed.count === 0) {
    return { ok: true, state: await getTransportPlanState(ride.transportPlanId) };
  }

  const plan = ride.transportPlan;
  const auth = await getOrganiserAuth(plan.tripId);
  if (isFailure(auth)) {
    await prisma.rideOrder.update({ where: { id: rideOrderId }, data: { status: "FAILED", errorMessage: auth.error } });
    return { ok: false, error: auth.error };
  }

  const route = await resolveRoute(plan, cityHintFor(plan.destination));
  if (isFailure(route)) {
    await prisma.rideOrder.update({ where: { id: rideOrderId }, data: { status: "FAILED", errorMessage: route.error } });
    return { ok: false, error: route.error };
  }

  try {
    const prepared = await mobilityProvider.prepareRide(auth, route, ride.productId!);
    const result = await mobilityProvider.requestRide(auth, route, prepared);
    await prisma.rideOrder.update({
      where: { id: rideOrderId },
      data: {
        providerRideId: result.providerRideId,
        status: result.status,
        pickupEtaMinutes: result.pickupEtaMinutes,
        surgeMultiplier: result.surgeMultiplier,
        fareEstimateLow: prepared.lowEstimate,
        fareEstimateHigh: prepared.highEstimate,
      },
    });
    if (ride.bookingId) {
      await prisma.booking.update({
        where: { id: ride.bookingId },
        data: { status: "CONFIRMED", confirmationId: result.providerRideId },
      });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Uber couldn't process this ride request.";
    await prisma.rideOrder.update({ where: { id: rideOrderId }, data: { status: "FAILED", errorMessage: message } });
    if (ride.bookingId) {
      await prisma.booking.update({ where: { id: ride.bookingId }, data: { status: "FAILED" } });
    }
  }

  const allRides = await prisma.rideOrder.findMany({ where: { transportPlanId: plan.id } });
  const failedCount = allRides.filter((r) => r.status === "FAILED").length;
  await prisma.transportPlan.update({
    where: { id: plan.id },
    data: { status: failedCount === 0 ? "CONFIRMED" : failedCount === allRides.length ? "FAILED" : "PARTIAL" },
  });

  revalidateTrip(plan.tripId);
  return { ok: true, state: await getTransportPlanState(plan.id) };
}

const CANCELLABLE_STATUSES = ["REQUESTING", "PROCESSING", "ACCEPTED", "ARRIVING"];

export async function cancelRideOrder(rideOrderId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const ride = await prisma.rideOrder.findUniqueOrThrow({
    where: { id: rideOrderId },
    include: { transportPlan: true },
  });

  if (!CANCELLABLE_STATUSES.includes(ride.status)) {
    return { ok: false, error: `This ride is already ${ride.status.toLowerCase().replace("_", " ")} and can't be cancelled here.` };
  }
  if (!ride.providerRideId) {
    return { ok: false, error: "This ride was never successfully requested." };
  }

  const auth = await getOrganiserAuth(ride.transportPlan.tripId);
  if (isFailure(auth)) return { ok: false, error: auth.error };

  try {
    await mobilityProvider.cancelRide(auth, ride.providerRideId);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Uber couldn't cancel this ride." };
  }

  await prisma.rideOrder.update({ where: { id: rideOrderId }, data: { status: "RIDER_CANCELLED" } });

  const actorId = await getCurrentUserId();
  await prisma.auditLog.create({
    data: {
      tripId: ride.transportPlan.tripId,
      actorId: actorId ?? "unknown",
      actionType: "UBER_RIDE_CANCELLED",
      payloadSummary: `Ride order ${rideOrderId} cancelled by explicit human request.`,
    },
  });

  revalidateTrip(ride.transportPlan.tripId);
  return { ok: true };
}

// Sandbox-only development tooling, surfaced in the UI as "Simulate next
// status" — never available when UBER_ENV=production.
export async function advanceSandboxRideOrder(
  rideOrderId: string,
  status: "accepted" | "arriving" | "in_progress" | "completed" | "driver_canceled"
): Promise<{ ok: true } | { ok: false; error: string }> {
  const ride = await prisma.rideOrder.findUniqueOrThrow({
    where: { id: rideOrderId },
    include: { transportPlan: true },
  });
  if (!ride.providerRideId) return { ok: false, error: "This ride was never successfully requested." };

  const auth = await getOrganiserAuth(ride.transportPlan.tripId);
  if (isFailure(auth)) return { ok: false, error: auth.error };

  try {
    await advanceSandboxRide(auth, ride.providerRideId, status);
    const live = await mobilityProvider.getRide(auth, ride.providerRideId);
    await prisma.rideOrder.update({ where: { id: rideOrderId }, data: { status: live.status } });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Couldn't advance sandbox ride status." };
  }

  revalidateTrip(ride.transportPlan.tripId);
  return { ok: true };
}
