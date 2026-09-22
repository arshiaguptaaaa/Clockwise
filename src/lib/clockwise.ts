import { prisma } from "./prisma";
import { CLOCKWISE_SENDER_NAME } from "./demo-data";

// Clockwise-authored messages need a real senderId (see prisma/seed.ts).
// Deliberately NOT cached across requests: reseeding the database (an
// explicitly supported "safe to run anytime" workflow for this demo app)
// creates a brand new Clockwise user row with a new id, and a
// process-lifetime cache would keep pointing at the old, now-deleted row
// — causing a foreign key violation on the very next message. This is a
// single indexed lookup on a tiny table; the correctness cost of caching
// isn't worth the performance gain here.
//
// Create-if-missing rather than findFirstOrThrow: a stranger creating the
// first real trip on a fresh database (never having run `npm run
// db:seed`) must not crash here. Clockwise is one global system identity
// shared across every trip, demo or real — not scoped per-trip.
export async function getClockwiseUserId(): Promise<string> {
  const existing = await prisma.user.findFirst({
    where: { name: CLOCKWISE_SENDER_NAME },
  });
  if (existing) return existing.id;

  const created = await prisma.user.create({
    data: { name: CLOCKWISE_SENDER_NAME },
  });
  return created.id;
}
