// "My arrival changed": one traveller updates THEIR OWN confirmed journey from a
// real new input. The journey is the individual clock; this recomputes what that
// does to the shared commitments (rendezvous) and says which are now at risk,
// with a deterministic suggested time. Nothing here moves a shared commitment —
// that only ever happens through an approved group proposal.
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { notify } from "@/lib/notifications";
import { recomputeRendezvous, buildRendezvousView } from "@/lib/rendezvous";
import { resolveNewArrival, ceilToQuarter } from "./arrival-rules";
import { timeLabel } from "./journey";

export type AtRisk = { commitmentId: string; name: string; oldTime: string; suggestedTime: string; blocking: { name: string; hotelBy: string }[] };
export type ArrivalResult =
  | { ok: true; name: string; oldArrival: string | null; newArrival: string; atRisk: AtRisk[]; unknownRoute: boolean }
  | { ok: false; error: string };

export async function updateMyArrival(p: { tripId: string; userId: string; arrivalTime?: string; arrivalDate?: string; sourceMessageId: string | null; sourceChannel: "GROUP" | "PRIVATE" }): Promise<ArrivalResult> {
  const member = await prisma.tripMember.findFirst({ where: { tripId: p.tripId, userId: p.userId }, include: { user: { select: { name: true } } } });
  if (!member) return { ok: false, error: "You're not on this trip." };
  // Strictly the speaker's OWN journey: the query is keyed by the acting user id, never by a name.
  const journey = await prisma.travellerJourney.findFirst({ where: { tripId: p.tripId, userId: p.userId, status: "CONFIRMED" }, orderBy: { createdAt: "desc" } });
  if (!journey) return { ok: false, error: "They don't have a confirmed journey yet, so there is nothing to update. Tell them to add or confirm their journey first (My Clockwise → Journey)." };

  const decision = resolveNewArrival(journey.arriveLocal, { arrivalTime: p.arrivalTime, arrivalDate: p.arrivalDate });
  if (!decision.ok) return { ok: false, error: decision.ask };

  const old = journey.arriveLocal;
  await prisma.travellerJourney.update({
    where: { id: journey.id },
    // Old route numbers belong to the old arrival time; recomputed below.
    data: { arriveLocal: decision.newLocal, scheduledArriveLocal: journey.scheduledArriveLocal ?? old, notOutBeforeLocal: null, routeToStayMeters: null, routeToStaySeconds: null, routeComputedAt: null },
  });

  await recomputeRendezvous(p.tripId);
  const view = await buildRendezvousView(p.tripId);
  const atRisk: AtRisk[] = view.commitments
    .filter((c) => c.late.some((l) => l.name === member.user.name))
    .map((c) => {
      const latest = c.late.map((l) => l.hotelBy).sort().at(-1)!;
      return { commitmentId: c.id, name: c.name, oldTime: c.target, suggestedTime: ceilToQuarter(latest), blocking: c.late };
    });
  const mine = view.clocks.find((c) => c.userId === p.userId);

  // Trace: old/new arrival, source, traveller, affected commitments. No transcript, no reason.
  await prisma.tripEvent.create({
    data: {
      tripId: p.tripId,
      kind: "TRAVELLER_ARRIVAL_UPDATED",
      scope: "GROUP",
      actorUserId: p.userId,
      subjectUserId: p.userId,
      sourceChannel: p.sourceChannel,
      sourceMessageId: p.sourceMessageId,
      confidence: "HIGH",
      payload: JSON.stringify({
        traveller: member.user.name,
        journeyId: journey.id,
        oldArrival: old,
        newArrival: decision.newLocal,
        movedMinutes: decision.movedMinutes,
        affectedCommitments: atRisk.map((a) => ({ name: a.name, at: a.oldTime, suggested: a.suggestedTime })),
        routeKnown: mine?.status === "KNOWN",
      }),
      propagation: JSON.stringify(["my-clockwise-journey", "plan-arrivals", "ready", "rendezvous", "commitment-risk"]),
    },
  });

  const others = (await prisma.tripMember.findMany({ where: { tripId: p.tripId }, select: { userId: true } })).map((m) => m.userId).filter((id) => id !== p.userId);
  await notify({
    tripId: p.tripId,
    recipientIds: others,
    severity: "INFO",
    kind: "ARRIVAL_UPDATED",
    title: `${member.user.name}'s arrival changed`,
    body: `Now arriving ${timeLabel(decision.newLocal)}${old ? ` (was ${timeLabel(old)})` : ""}.`,
    href: `/trips/${p.tripId}/plan`,
  });
  for (const path of ["plan", "room", "agent", "agent/journey", "agent/ready"]) revalidatePath(`/trips/${p.tripId}/${path}`);
  return { ok: true, name: member.user.name, oldArrival: old, newArrival: decision.newLocal, atRisk, unknownRoute: mine?.status !== "KNOWN" };
}
