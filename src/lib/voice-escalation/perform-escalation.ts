// The one place a real outbound call is actually placed — shared by the
// human-triggered path (src/app/escalation-actions.ts, a "use server"
// file) and the agent-triggered path (src/lib/agent/tools.ts), so there
// is exactly one implementation of "what happens when a call is placed,"
// never two slightly-different copies of logic that makes a real phone
// ring.
import { prisma } from "@/lib/prisma";
import { gnaniVoiceProvider, isGnaniConfigured } from "./gnani-provider";
import { demoVoiceEscalationProvider } from "./demo-provider";

export type PerformEscalationResult = { ok: true; mode: string } | { ok: false; error: string };

function splitPhone(phone: string): [string, string] {
  const match = phone.match(/^(\+\d{1,3})(\d+)$/);
  if (match) return [match[1], match[2]];
  return ["+91", phone.replace(/\D/g, "")];
}

export async function performEscalation(
  commitmentId: string,
  travellerId: string,
  triggeredBy: { actorId: string; source: "HUMAN" | "AGENT"; reason?: string }
): Promise<PerformEscalationResult> {
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
    await prisma.auditLog.create({
      data: {
        tripId: commitment.tripId,
        actorId: triggeredBy.actorId,
        actionType: triggeredBy.source === "AGENT" ? "VOICE_ESCALATION_AUTO_FAILED" : "VOICE_ESCALATION_TRIGGERED",
        payloadSummary: `${mode} escalation call to ${traveller.name} for commitment "${commitment.name}" failed: ${result.reason}`,
      },
    });
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
      actorId: triggeredBy.actorId,
      actionType: triggeredBy.source === "AGENT" ? "VOICE_ESCALATION_AUTO_TRIGGERED" : "VOICE_ESCALATION_TRIGGERED",
      payloadSummary: `${mode} escalation call to ${traveller.name} for commitment "${commitment.name}"${
        triggeredBy.reason ? ` — reason: ${triggeredBy.reason}` : ""
      }.`,
    },
  });

  return { ok: true, mode };
}
