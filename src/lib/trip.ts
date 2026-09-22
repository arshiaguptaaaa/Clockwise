import { prisma } from "./prisma";
import { getCurrentUserId } from "./session";

const tripInclude = {
  destinations: { orderBy: { order: "asc" } },
  members: {
    include: { user: true },
    orderBy: { participationStart: "asc" },
  },
} as const;

export async function getTripById(tripId: string) {
  const trip = await prisma.trip.findUnique({
    where: { id: tripId },
    include: tripInclude,
  });
  if (!trip) {
    throw new Error(`No trip found for id "${tripId}".`);
  }
  return trip;
}

// The one seeded Central Europe trip, found via the isDemo flag rather
// than "the first trip" or a name match — reliable regardless of how many
// real trips exist alongside it.
export async function getDemoTrip() {
  const trip = await prisma.trip.findFirst({
    where: { isDemo: true },
    include: tripInclude,
  });
  if (!trip) {
    throw new Error(
      "No demo trip found. Run `npm run db:seed` to create it."
    );
  }
  return trip;
}

export type Trip = Awaited<ReturnType<typeof getTripById>>;

// Validates the session cookie against real membership of THIS trip — not
// just "is a cookie present". A stale cookie (e.g. left over from before a
// reseed, which assigns fresh user ids, or from viewing a different trip
// than the one in the URL) must be treated as signed-out for this trip, or
// "/" and the trip layout can fight over redirects forever. See git
// history for the demo-mode version of this same bug.
export async function getCurrentMember(tripId: string) {
  const userId = await getCurrentUserId();
  if (!userId) return null;

  const trip = await getTripById(tripId);
  const member = trip.members.find((m) => m.userId === userId);
  if (!member) return null;
  return { trip, member };
}
