"use server";

// The human-pressed escalation path (Travellers tab "Escalate" button).
// Gemini has its own separate path to the same real call (see
// escalate_via_voice_call in src/lib/agent/tools.ts) — both share the one
// real implementation (performEscalation) so there's never two slightly-
// different versions of "what happens when a call is placed." Either way,
// a call only ever happens when: the traveller opted in, a real
// Commitment/hardThreshold exists, and (for the agent path specifically)
// an unacknowledged reminder is genuinely on record — see
// checkEscalationReadiness in readiness.ts.
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/session";
import { recalculateCommitmentReadiness } from "@/lib/readiness";
import { performEscalation, type PerformEscalationResult } from "@/lib/voice-escalation/perform-escalation";
import { SIMULATED_RESPONSES, type SimulatedResponseKey } from "@/lib/voice-escalation/simulated-responses";

export async function setVoiceEscalationOptIn(optIn: boolean, phone?: string) {
  const userId = await getCurrentUserId();
  if (!userId) return;
  await prisma.user.update({
    where: { id: userId },
    data: { voiceEscalationOptIn: optIn, ...(phone ? { phone } : {}) },
  });
}

// Human-pressed "Escalate" button in the Travellers tab — thin wrapper
// around the shared performEscalation (src/lib/voice-escalation/
// perform-escalation.ts), which also backs the agent-triggered path.
export async function triggerEscalation(
  commitmentId: string,
  travellerId: string
): Promise<PerformEscalationResult> {
  const actorId = await getCurrentUserId();
  const result = await performEscalation(commitmentId, travellerId, {
    actorId: actorId ?? "unknown",
    source: "HUMAN",
  });

  const commitment = await prisma.commitment.findUnique({ where: { id: commitmentId } });
  if (commitment) revalidatePath(`/trips/${commitment.tripId}/plan/travellers`);
  return result;
}

// DEMO mode only — real Gnani outcomes arrive via the webhook, never via
// operator button-press. Enforced below, not just by UI hiding.
export async function simulateEscalationResponse(eventId: string, key: SimulatedResponseKey) {
  const event = await prisma.escalationEvent.findUniqueOrThrow({ where: { id: eventId } });
  if (event.mode !== "DEMO") {
    throw new Error("simulateEscalationResponse is only valid for DEMO-mode escalations.");
  }

  const sim = SIMULATED_RESPONSES[key];
  await prisma.escalationEvent.update({
    where: { id: eventId },
    data: {
      status: "RESOLVED",
      callStatus: "COMPLETED",
      callDisposition: sim.disposition,
      callTranscript: sim.transcript,
      estimatedDelayMinutes: sim.estimatedDelayMinutes,
      resolvedAt: new Date(),
    },
  });

  await recalculateCommitmentReadiness(event.commitmentId, sim.estimatedDelayMinutes);
  revalidatePath(`/trips/${event.tripId}/plan/travellers`);
}
