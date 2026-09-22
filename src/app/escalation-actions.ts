"use server";

// The deterministic escalation flow — human-triggered only, never
// Gemini-callable. A call only ever happens when: the traveller opted in,
// a real Commitment/hardThreshold exists, and a human explicitly presses
// the trigger (this pass doesn't yet have an automatic readiness-engine
// cron — see architecture note; that's future work, not faked here).
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/session";
import { gnaniVoiceProvider, isGnaniConfigured } from "@/lib/voice-escalation/gnani-provider";
import { demoVoiceEscalationProvider } from "@/lib/voice-escalation/demo-provider";
import { recalculateCommitmentReadiness } from "@/lib/readiness";
import { SIMULATED_RESPONSES, type SimulatedResponseKey } from "@/lib/voice-escalation/simulated-responses";

export async function setVoiceEscalationOptIn(optIn: boolean, phone?: string) {
  const userId = await getCurrentUserId();
  if (!userId) return;
  await prisma.user.update({
    where: { id: userId },
    data: { voiceEscalationOptIn: optIn, ...(phone ? { phone } : {}) },
  });
}

function splitPhone(phone: string): [string, string] {
  const match = phone.match(/^(\+\d{1,3})(\d+)$/);
  if (match) return [match[1], match[2]];
  return ["+91", phone.replace(/\D/g, "")];
}

export async function triggerEscalation(
  commitmentId: string,
  travellerId: string
): Promise<{ ok: true; mode: string } | { ok: false; error: string }> {
  const actorId = await getCurrentUserId();
  const commitment = await prisma.commitment.findUniqueOrThrow({ where: { id: commitmentId } });
  const traveller = await prisma.user.findUniqueOrThrow({ where: { id: travellerId } });

  if (!traveller.voiceEscalationOptIn) {
    return { ok: false, error: `${traveller.name} hasn't opted into voice escalation.` };
  }
  if (!traveller.phone) {
    return { ok: false, error: `${traveller.name} has no phone number on file.` };
  }

  const mode = isGnaniConfigured() ? "REAL" : "DEMO";

  const event = await prisma.escalationEvent.create({
    data: {
      tripId: commitment.tripId,
      commitmentId,
      travellerId,
      expectedActionAt: commitment.targetTime,
      hardThresholdAt: commitment.hardThreshold,
      status: "ESCALATING",
      mode,
      triggeredAt: new Date(),
    },
  });

  const provider = mode === "REAL" ? gnaniVoiceProvider : demoVoiceEscalationProvider;
  const [countryCode, phone] = splitPhone(traveller.phone);

  const result = await provider.initiateCall({
    travellerName: traveller.name,
    phone,
    countryCode,
    clientReferenceId: event.id,
  });

  if (!result.placed) {
    await prisma.escalationEvent.update({
      where: { id: event.id },
      data: { status: "FAILED", failureReason: result.reason },
    });
    revalidatePath(`/trips/${commitment.tripId}/plan/travellers`);
    return { ok: false, error: result.reason };
  }

  await prisma.escalationEvent.update({
    where: { id: event.id },
    data: {
      status: "CALLED",
      providerConversationId: result.providerConversationId,
      provider: mode === "REAL" ? "gnani" : "demo",
    },
  });

  await prisma.auditLog.create({
    data: {
      tripId: commitment.tripId,
      actorId: actorId ?? "unknown",
      actionType: "VOICE_ESCALATION_TRIGGERED",
      payloadSummary: `${mode} escalation call to ${traveller.name} for commitment "${commitment.name}".`,
    },
  });

  revalidatePath(`/trips/${commitment.tripId}/plan/travellers`);
  return { ok: true, mode };
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
