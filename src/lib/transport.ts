// Shared plumbing for the Uber transport flow — used by both the Gemini
// agent tools (read-only reasoning) and the human-confirmation-gated
// server actions (src/app/card-actions.ts), so neither has to re-derive
// "who is the authorised requester" or "how do we turn free-text pickup/
// destination into coordinates" independently.
import { prisma } from "@/lib/prisma";
import type { MobilityRoute } from "@/lib/providers/mobility";
import { getValidUberAccessToken } from "@/lib/uber/connection";
import { geocodeLocation } from "@/lib/uber/geocode";

export type OrganiserAuth = { accessToken: string; organiserId: string };
export type Failure = { error: string };

// Per the approved architecture: the trip's organiser (Trip.createdBy) is
// the sole authorised requester/payer for every RideOrder in a multi-car
// TransportPlan — Uber has no concept of a multi-account party booking.
export async function getOrganiserAuth(tripId: string): Promise<OrganiserAuth | Failure> {
  const trip = await prisma.trip.findUnique({ where: { id: tripId } });
  if (!trip) return { error: "Trip not found." };
  const accessToken = await getValidUberAccessToken(trip.createdBy);
  if (!accessToken) {
    return { error: "The trip organiser hasn't connected Uber yet." };
  }
  return { accessToken, organiserId: trip.createdBy };
}

export async function resolveRoute(
  plan: { pickup: string; destination: string },
  cityHint?: string
): Promise<MobilityRoute | Failure> {
  const [pickup, destination] = await Promise.all([
    geocodeLocation(plan.pickup, cityHint),
    geocodeLocation(plan.destination, cityHint),
  ]);
  if (!pickup) return { error: `Couldn't determine a location for "${plan.pickup}".` };
  if (!destination) return { error: `Couldn't determine a location for "${plan.destination}".` };
  return {
    pickup: { lat: pickup.lat, lng: pickup.lng, label: pickup.label },
    destination: { lat: destination.lat, lng: destination.lng, label: destination.label },
  };
}

export function isFailure<T>(x: T | Failure): x is Failure {
  return typeof x === "object" && x !== null && "error" in x;
}

// Splits a confirmed party into `vehiclesNeeded` groups as evenly as
// possible. Round-robin rather than sequential chunking so e.g. 5 people
// across 2 vehicles becomes 3/2, not a lopsided 4/1.
export function assignVehicles(participantIds: string[], vehiclesNeeded: number): string[][] {
  const groups: string[][] = Array.from({ length: Math.max(1, vehiclesNeeded) }, () => []);
  participantIds.forEach((id, idx) => {
    groups[idx % groups.length].push(id);
  });
  return groups;
}
