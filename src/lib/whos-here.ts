// "Who's here": one friendly line per traveller, from facts the group already shares
// (their confirmed arrival and whether it moved). Never ticket details, never private notes.
import { prisma } from "./prisma";
import { timeLabel } from "./traveller/journey";

export type HerePerson = { userId: string; name: string; status: string; tone: "ok" | "late" | "early" | "muted" };

export async function whosHere(tripId: string, members: { userId: string; user: { name: string } }[]): Promise<HerePerson[]> {
  const [journeys, moves] = await Promise.all([
    prisma.travellerJourney.findMany({ where: { tripId, status: "CONFIRMED" }, select: { userId: true, arriveLocal: true, mode: true } }),
    prisma.tripEvent.findMany({ where: { tripId, kind: "TRAVELLER_ARRIVAL_UPDATED" }, orderBy: { createdAt: "desc" }, select: { subjectUserId: true, payload: true } }),
  ]);
  const latestMove = new Map<string, { old: string | null; next: string | null }>();
  for (const m of moves) {
    if (!m.subjectUserId || latestMove.has(m.subjectUserId)) continue;
    try {
      const p = JSON.parse(m.payload) as { oldArrival?: string | null; newArrival?: string | null };
      latestMove.set(m.subjectUserId, { old: p.oldArrival ?? null, next: p.newArrival ?? null });
    } catch {
      // ignore
    }
  }
  const journeyOf = new Map(journeys.map((j) => [j.userId, j]));

  return members.map((m) => {
    const j = journeyOf.get(m.userId);
    const move = latestMove.get(m.userId);
    if (!j || !j.arriveLocal) return { userId: m.userId, name: m.user.name, status: "Journey not added yet", tone: "muted" as const };
    if (move?.old && move.next && move.next === j.arriveLocal && move.next > move.old) {
      return { userId: m.userId, name: m.user.name, status: `Running late · lands ${timeLabel(j.arriveLocal)}`, tone: "late" as const };
    }
    if (move?.old && move.next && move.next === j.arriveLocal && move.next < move.old) {
      return { userId: m.userId, name: m.user.name, status: `Early · lands ${timeLabel(j.arriveLocal)}`, tone: "early" as const };
    }
    return { userId: m.userId, name: m.user.name, status: `Lands ${timeLabel(j.arriveLocal)}`, tone: "ok" as const };
  });
}
