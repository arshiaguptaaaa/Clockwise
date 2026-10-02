// The ONE place a finished call turns into trip state. The real Gnani
// webhook and the demo simulator both end here, so a call's outcome moves
// the same canonical state in the same order regardless of how it arrived:
//
//   call result -> EscalationEvent row -> TripEvent (VOICE_CALL_OUTCOME)
//     -> TravellerReadiness recompute -> READINESS_CHANGED + notifications
//     -> Travellers page / bell / Agent Trace
//
// The group only ever sees the derived effect (a readiness line). The call
// transcript stays on the EscalationEvent row and is never copied into an
// event or notification.
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { parseDelayMinutes, recalculateCommitmentReadiness } from "@/lib/readiness";
import { recomputeTravellerReadiness } from "@/lib/readiness-engine";
import { notify, otherMemberIds } from "@/lib/notifications";

export type CallOutcomeInput = {
  eventId: string;
  callStatus: string;
  disposition: string | null;
  // Pre-parsed delay (demo path); parsed from the disposition otherwise.
  estimatedDelayMinutes?: number | null;
  transcript?: string | null;
  source: "GNANI_WEBHOOK" | "DEMO_SIMULATION";
};

const CANNOT_MAKE_IT = /cannot|can't|cant|not\s+coming|won'?t\s+make/i;

export async function applyCallOutcome(input: CallOutcomeInput) {
  const event = await prisma.escalationEvent.findUniqueOrThrow({
    where: { id: input.eventId },
    include: { commitment: true, traveller: { select: { name: true } } },
  });
  const delay =
    input.estimatedDelayMinutes !== undefined ? input.estimatedDelayMinutes : parseDelayMinutes(input.disposition);
  const cannotMakeIt = Boolean(input.disposition && CANNOT_MAKE_IT.test(input.disposition));

  await prisma.escalationEvent.update({
    where: { id: event.id },
    data: {
      status: "RESOLVED",
      callStatus: input.callStatus,
      callDisposition: input.disposition,
      ...(input.transcript !== undefined ? { callTranscript: input.transcript } : {}),
      estimatedDelayMinutes: delay,
      resolvedAt: new Date(),
    },
  });
  // Legacy per-commitment status the Travellers "needs attention" list reads.
  await recalculateCommitmentReadiness(event.commitmentId, delay);

  const outcome = cannotMakeIt ? "CANNOT_MAKE_IT" : delay != null ? (delay === 0 ? "ON_THE_WAY" : "DELAYED") : "NO_USABLE_RESPONSE";
  const tripEvent = await prisma.tripEvent.create({
    data: {
      tripId: event.tripId,
      kind: "VOICE_CALL_OUTCOME",
      scope: "GROUP",
      subjectUserId: event.travellerId,
      sourceChannel: "GNANI_CALL",
      confidence: outcome === "NO_USABLE_RESPONSE" ? "LOW" : "MEDIUM",
      // Structured outcome only — no transcript, no free text from the call.
      payload: JSON.stringify({
        commitment: event.commitment.name,
        outcome,
        estimatedDelayMinutes: delay,
        callStatus: input.callStatus,
        mode: input.source === "DEMO_SIMULATION" ? "DEMO" : "REAL",
        escalationEventId: event.id,
      }),
      propagation: JSON.stringify(["readiness", "travellers", "notifications"]),
    },
  });

  if (outcome === "NO_USABLE_RESPONSE") {
    // Nothing to feed the readiness engine — say so rather than guess, and
    // make sure a human hears that the call did not resolve anything.
    await notify({
      tripId: event.tripId,
      recipientIds: await otherMemberIds(event.tripId, event.travellerId),
      severity: "HIGH",
      kind: "VOICE_CALL_OUTCOME",
      title: `Couldn't confirm ${event.traveller.name}'s status`,
      body: `Clockwise called ${event.traveller.name} about ${event.commitment.name} but didn't get a usable answer.`,
      href: `/trips/${event.tripId}/plan/travellers`,
      eventId: tripEvent.id,
    });
  } else {
    await recomputeTravellerReadiness(event.tripId, event.travellerId, {
      sourceChannel: "GNANI_CALL",
      actorUserId: event.travellerId,
      onlyCommitmentId: event.commitmentId,
      ...(cannotMakeIt
        ? { statedLateMinutes: 24 * 60 }
        : { reportedReadyAt: new Date(Date.now() + (delay ?? 0) * 60_000) }),
    });
  }

  revalidatePath(`/trips/${event.tripId}/plan/travellers`);
}
