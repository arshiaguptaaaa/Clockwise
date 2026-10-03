import { prisma } from "@/lib/prisma";

// Voice trace events. PERSONAL scope: only the person who spoke sees them in
// Agent Trace, and the payload carries metadata only (provider, request id,
// language, latency, lengths) — never the audio, the transcript or any key.
export async function recordVoiceTrace(
  who: { tripId: string; userId: string },
  kind: "VOICE_CAPTURED" | "GNANI_STT_STARTED" | "GNANI_STT_COMPLETED",
  payload: Record<string, unknown>
) {
  try {
    const member = await prisma.tripMember.findFirst({ where: { tripId: who.tripId, userId: who.userId }, select: { id: true } });
    if (!member) return;
    await prisma.tripEvent.create({
      data: {
        tripId: who.tripId,
        kind,
        scope: "PERSONAL",
        actorUserId: who.userId,
        subjectUserId: who.userId,
        sourceChannel: "SYSTEM",
        confidence: "HIGH",
        payload: JSON.stringify(payload),
        propagation: JSON.stringify(["composer"]),
      },
    });
  } catch (err) {
    console.error("[voice-trace] failed:", err instanceof Error ? err.message : "unknown");
  }
}
