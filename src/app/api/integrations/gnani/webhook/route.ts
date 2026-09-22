import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { recalculateCommitmentReadiness, parseDelayMinutes } from "@/lib/readiness";

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

  if (!event) {
    // Real failure, not silently accepted — an unmatched webhook means
    // something is misconfigured and should be visible, not swallowed.
    return NextResponse.json({ error: "No matching escalation event" }, { status: 404 });
  }

  const disposition = payload.callSummary?.disposition ?? null;
  const estimatedDelayMinutes = parseDelayMinutes(disposition);

  await prisma.escalationEvent.update({
    where: { id: event.id },
    data: {
      status: "RESOLVED",
      callStatus: payload.callStatus ?? "COMPLETED",
      callDisposition: disposition,
      estimatedDelayMinutes,
      resolvedAt: new Date(),
    },
  });

  await recalculateCommitmentReadiness(event.commitmentId, estimatedDelayMinutes);

  return NextResponse.json({ ok: true });
}
