"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { setCurrentUserId } from "@/lib/session";
import { getClockwiseUserId } from "@/lib/clockwise";
import { suggestTripName } from "@/lib/trip-name";
import { hasValidCoordinates } from "@/lib/location/types";
import { createAndEmailInvite } from "@/lib/invite";
import type { SelectedDestination } from "@/lib/destination-search/types";

export type CreateTripInput = {
  tripName: string;
  destinations: SelectedDestination[];
  coreStartDate: string | null; // ISO date, or null if undecided
  coreEndDate: string | null;
  creatorName: string;
  travellers: { name: string; contact: string }[];
};

// Real database writes, not a mocked screen: a Trip, its Destinations, the
// creator's own User+TripMember (role ORGANIZER), an Invite row per named
// traveller (lazily turned into a real member only when they actually
// join — see build notes), and a templated welcome message in the new
// Trip Room. The creator is never asked for anyone else's private
// information — that's each traveller's own My Clockwise conversation.
export async function createTrip(input: CreateTripInput) {
  const creatorName = input.creatorName.trim();
  if (!creatorName) {
    throw new Error("Trip creator name is required.");
  }

  const destinations = input.destinations.filter((d) => d.name.trim());
  const tripName =
    input.tripName.trim() || suggestTripName(destinations.map((d) => d.name));

  const coreStartDate = input.coreStartDate ? new Date(input.coreStartDate) : null;
  const coreEndDate = input.coreEndDate ? new Date(input.coreEndDate) : null;

  // Never trust the client's own validation — reject before any row is
  // written so an invalid submission can't leave an orphaned User behind.
  if (coreStartDate && isNaN(coreStartDate.getTime())) {
    throw new Error("That start date isn't valid.");
  }
  if (coreEndDate && isNaN(coreEndDate.getTime())) {
    throw new Error("That end date isn't valid.");
  }
  if (coreStartDate && coreEndDate && coreEndDate < coreStartDate) {
    throw new Error("End date can't be before the start date.");
  }

  const creator = await prisma.user.create({ data: { name: creatorName } });

  const trip = await prisma.trip.create({
    data: {
      name: tripName,
      coreStartDate,
      coreEndDate,
      status: "PLANNING",
      createdBy: creator.id,
      isDemo: false,
    },
  });

  // Client-supplied structured fields cross a trust boundary here — a
  // CanonicalPlace with an out-of-range/non-finite coordinate is
  // downgraded to a free-text row rather than persisted as if it were a
  // real geocoded point (never trust, only verify).
  await Promise.all(
    destinations.map((d, order) => {
      const trustedStructured = !d.freeText && hasValidCoordinates(d);
      return prisma.destination.create({
        data: trustedStructured
          ? {
              tripId: trip.id,
              name: d.name,
              displayName: d.displayName,
              city: d.city,
              region: d.region,
              country: d.country,
              countryCode: d.countryCode,
              latitude: d.latitude,
              longitude: d.longitude,
              placeId: d.providerPlaceId,
              provider: d.provider,
              order,
            }
          : { tripId: trip.id, name: d.name, displayName: d.displayName, order },
      });
    })
  );

  await prisma.tripMember.create({
    data: {
      tripId: trip.id,
      userId: creator.id,
      role: "ORGANIZER",
      participationStart: coreStartDate,
      participationEnd: coreEndDate,
    },
  });

  const namedTravellers = input.travellers
    .map((t) => ({ name: t.name.trim(), contact: t.contact.trim() }))
    .filter((t) => t.name);

  for (const traveller of namedTravellers) {
    await createAndEmailInvite({
      tripId: trip.id,
      tripName,
      inviterName: creator.name,
      invitedBy: creator.id,
      inviteeName: traveller.name,
      contact: traveller.contact || null,
      destinations: destinations.map((d) => d.name),
    });
  }

  const clockwiseUserId = await getClockwiseUserId();
  const destinationLabel =
    destinations.length > 0 ? destinations.map((d) => d.name).join(", ") : "your trip";
  await prisma.message.create({
    data: {
      tripId: trip.id,
      senderId: clockwiseUserId,
      channel: "GROUP",
      content: `You're set.\n\nI've created the trip room for ${destinationLabel}.\n\nEveryone can discuss the trip normally here. I'll keep track of what gets decided and step in when something needs coordinating.`,
    },
  });

  await setCurrentUserId(creator.id);
  redirect(`/trips/${trip.id}/room`);
}
