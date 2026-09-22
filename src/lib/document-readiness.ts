import { prisma } from "./prisma";

// Derived from real PrivateProfile data (never fabricated) — used both by
// the seed script (to post the initial cards) and available for reuse once
// live decision extraction can trigger this check itself.
export async function getPendingDocumentTravellers(tripId: string) {
  const profiles = await prisma.privateProfile.findMany({
    where: { tripId, visaStatus: "PENDING" },
    include: { user: true },
  });
  return profiles.map((p) => ({ userId: p.userId, name: p.user.name }));
}
