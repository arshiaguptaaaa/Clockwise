import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { applyCallOutcome } from "@/lib/voice-escalation/apply-call-outcome";

// Gnani's docs (researched 2026-09-21) don't document a cryptographic
// webhook signature scheme — the only authenticity mechanism available is
// a custom header value you configure yourself in the agent's
// postCallTriggerAPIConfig. This checks that shared secret; if
// GNANI_WEBHOOK_SECRET isn't set, the webhook refuses all requests rather
// than trusting an unauthenticated POST.
const SECRET_HEADER = "x-clockwise-webhook-secret";

type GnaniWebhookPayload = {
  clientReferenceId?: string;
  conversationId?: string;
  conversation_id?: string;
  callStatus?: string;
  callSummary?: { disposition?: string };
};

export async function POST(request: NextRequest) {
  const configuredSecret = process.env.GNANI_WEBHOOK_SECRET;
  if (!configuredSecret) {
    return NextResponse.json({ error: "Webhook not configured" }, { status: 503 });
  }
  if (request.headers.get(SECRET_HEADER) !== configuredSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const payload: GnaniWebhookPayload = await request.json();
  const conversationId = payload.conversationId ?? payload.conversation_id;
  const clientReferenceId = payload.clientReferenceId;

  const event = clientReferenceId
    ? await prisma.escalationEvent.findUnique({ where: { id: clientReferenceId } })
    : conversationId
      ? await prisma.escalationEvent.findFirst({ where: { providerConversationId: conversationId } })
      : null;

  // An invitation-reminder call: our clientReferenceId is the ScheduledJob id.
  if (!event && clientReferenceId) {
    const job = await prisma.scheduledJob.findUnique({ where: { id: clientReferenceId } });
    if (job && job.channel === "VOICE") {
      await prisma.scheduledJob.update({ where: { id: job.id }, data: { status: "DELIVERED", resolvedAt: new Date() } });
      await prisma.tripEvent.create({
        data: {
          tripId: job.tripId,
          kind: "ESCALATION_CALL_RESULT",
          scope: "GROUP",
          sourceChannel: "GNANI_CALL",
          confidence: "MEDIUM",
          // Outcome only — no transcript, no phone number.
          payload: JSON.stringify({ jobId: job.id, callStatus: payload.callStatus ?? "COMPLETED", disposition: payload.callSummary?.disposition ?? null }),
          propagation: JSON.stringify(["travellers"]),
        },
      });
      return NextResponse.json({ ok: true });
    }
  }

  if (!event) {
    // Real failure, not silently accepted — an unmatched webhook means
    // something is misconfigured and should be visible, not swallowed.
    return NextResponse.json({ error: "No matching escalation event" }, { status: 404 });
  }

  await applyCallOutcome({
    eventId: event.id,
    callStatus: payload.callStatus ?? "COMPLETED",
    disposition: payload.callSummary?.disposition ?? null,
    source: "GNANI_WEBHOOK",
  });

  return NextResponse.json({ ok: true });
}
