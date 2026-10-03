"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId, setCurrentUserId, clearCurrentUser } from "@/lib/session";
import { getTripById } from "@/lib/trip";
import { getClockwiseUserId } from "@/lib/clockwise";
import { respondToGroupMessage, respondToPrivateMessage } from "@/lib/agent/clockwise-agent";
import { withAgentLock, conversationLockKey } from "@/lib/agent-lock";

export async function joinAsUser(tripId: string, userId: string) {
  const trip = await getTripById(tripId);
  const isMember = trip.members.some((m) => m.userId === userId);
  if (!isMember) {
    throw new Error("That traveller is not part of this trip.");
  }
  await setCurrentUserId(userId);
  redirect(`/trips/${tripId}/room`);
}

export async function switchTraveller() {
  await clearCurrentUser();
  redirect("/");
}

// Fast path — just persists the human's own message and returns. Kept
// separate from the agent turn so the composer can re-enable the instant
// this (quick) write completes, instead of waiting for the (slow) Gemini
// call too. Returns the senderId so the caller can immediately kick off
// runGroupAgentTurn without a second getCurrentUserId() round trip.
// A message that came from a voice note carries the id of its Gnani evidence row;
// link them so the evidence view can show which decisions that message caused.
async function linkVoiceCall(senderId: string, formData: FormData, messageId: string) {
  const id = String(formData.get("voiceRailCallId") ?? "").trim();
  if (!id) return;
  await prisma.railCall
    .updateMany({ where: { id, userId: senderId, partner: "GNANI", relatedKind: null }, data: { relatedKind: "MESSAGE", relatedId: messageId } })
    .catch(() => undefined);
}

export async function postGroupMessage(tripId: string, formData: FormData): Promise<{ senderId: string } | void> {
  const content = String(formData.get("content") ?? "").trim();
  const attachmentId = String(formData.get("attachmentId") ?? "").trim() || null;

  const senderId = await getCurrentUserId();
  if (!senderId) {
    redirect("/");
  }

  // Re-verified here, not just trusted from the form: the attachment must
  // genuinely be this sender's own unlinked GROUP upload to this trip —
  // uploadAttachment already enforced this at upload time, but a formData
  // value is still client-controlled, so it's checked again before linking.
  const attachment = attachmentId
    ? await prisma.attachment.findFirst({
        where: { id: attachmentId, tripId, channel: "GROUP", uploaderId: senderId, messageId: null },
      })
    : null;

  if (!content && !attachment) return;

  const message = await prisma.message.create({
    data: { tripId, senderId, channel: "GROUP", content: content || `📎 ${attachment!.filename}` },
  });
  await linkVoiceCall(senderId, formData, message.id);

  if (attachment) {
    await prisma.attachment.update({ where: { id: attachment.id }, data: { messageId: message.id } });
  }

  revalidatePath(`/trips/${tripId}/room`);
  revalidatePath(`/trips/${tripId}/room/files`);
  return { senderId };
}

// Slow path — the actual agent turn. Deliberately a separate server
// action so the UI's "Clockwise is thinking" state is independent of the
// composer's own (fast) pending state. Serialized per-trip: if a second
// message arrives while this is still running, that turn waits for this
// one to fully finish (see agent-lock.ts) rather than racing it, so it
// always reasons over the complete, up-to-date conversation.
// An unexpected exception inside an agent turn (a lock timeout, a hung model
// call, a crashed tool) used to surface as a raw error page with nothing left
// behind. Now it is recorded as a trace event (error NAME and a short,
// secret-free message) and answered with a plain note. It is deliberately NOT
// posted as a retryable `failed` message: retrying re-runs the turn, and if the
// exception happened after a tool had already acted, a retry could repeat it.
async function recordTurnFailure(tripId: string, channel: "GROUP" | "PRIVATE", userId: string, err: unknown) {
  const name = err instanceof Error ? err.name : "Error";
  const message = (err instanceof Error ? err.message : String(err)).replace(/(key|token|secret)[=:]\s*\S+/gi, "$1=[redacted]").slice(0, 200);
  console.error(`[agent-turn] failed trip=${tripId} channel=${channel}: ${name}`);
  await prisma.tripEvent
    .create({
      data: {
        tripId,
        kind: "AGENT_TURN_FAILED",
        scope: channel === "PRIVATE" ? "PERSONAL" : "GROUP",
        actorUserId: userId,
        subjectUserId: channel === "PRIVATE" ? userId : null,
        sourceChannel: channel,
        payload: JSON.stringify({ name, message }),
        propagation: "[]",
      },
    })
    .catch(() => undefined);
  const clockwiseUserId = await getClockwiseUserId();
  await prisma.message
    .create({
      data: {
        tripId,
        senderId: clockwiseUserId,
        channel,
        recipientId: channel === "PRIVATE" ? userId : null,
        content: "I hit a problem on my side handling that, so I haven't acted on it. Nothing was changed — please send it again.",
      },
    })
    .catch(() => undefined);
}

export async function runGroupAgentTurn(tripId: string, actingUserId: string): Promise<void> {
  try {
    await runGroupAgentTurnInner(tripId, actingUserId);
  } catch (err) {
    await recordTurnFailure(tripId, "GROUP", actingUserId, err);
  }
  revalidatePath(`/trips/${tripId}/room`);
}

// A turn leaves a marker the moment it starts and flips it to COMPLETED (with
// duration) when it ends. A marker still saying STARTED means the turn never
// finished — killed by a time limit, or still running — which is otherwise
// indistinguishable from "the agent chose not to answer".
async function runGroupAgentTurnInner(tripId: string, actingUserId: string): Promise<void> {
  const t0 = Date.now();
  const marker = await prisma.tripEvent
    .create({ data: { tripId, kind: "AGENT_TURN_STARTED", scope: "GROUP", actorUserId: actingUserId, sourceChannel: "GROUP", payload: "{}", propagation: "[]" } })
    .catch(() => null);
  await withAgentLock(conversationLockKey(tripId, "GROUP"), async () => {
    // Every group message reaches this call; respondToGroupMessage itself
    // applies a narrow deterministic pre-filter (intervention-gate.ts) for
    // obvious filler before the real agent ever runs — everything else
    // still goes to Gemini, which decides for itself whether to reply via
    // the stay_silent tool rather than being keyword-gated on "@Clockwise".
    await respondToGroupMessage(tripId, actingUserId);
  });
  if (marker) {
    await prisma.tripEvent
      .update({ where: { id: marker.id }, data: { kind: "AGENT_TURN_COMPLETED", payload: JSON.stringify({ totalMs: Date.now() - t0 }) } })
      .catch(() => undefined);
  }
}

export async function postPrivateMessage(tripId: string, formData: FormData): Promise<{ senderId: string } | void> {
  const content = String(formData.get("content") ?? "").trim();
  const attachmentId = String(formData.get("attachmentId") ?? "").trim() || null;

  const senderId = await getCurrentUserId();
  if (!senderId) {
    redirect("/");
  }

  // Re-verified here too — must be this user's own PRIVATE upload
  // (uploaderId AND recipientId both equal senderId, matching the same
  // isolation rule PRIVATE messages already enforce), not already linked.
  const attachment = attachmentId
    ? await prisma.attachment.findFirst({
        where: { id: attachmentId, tripId, channel: "PRIVATE", uploaderId: senderId, recipientId: senderId, messageId: null },
      })
    : null;

  if (!content && !attachment) return;

  const message = await prisma.message.create({
    data: { tripId, senderId, channel: "PRIVATE", recipientId: senderId, content: content || `📎 ${attachment!.filename}` },
  });
  await linkVoiceCall(senderId, formData, message.id);

  if (attachment) {
    await prisma.attachment.update({ where: { id: attachment.id }, data: { messageId: message.id } });
  }

  revalidatePath(`/trips/${tripId}/agent`);
  revalidatePath(`/trips/${tripId}/room/files`);
  return { senderId };
}

export async function runPrivateAgentTurn(tripId: string, actingUserId: string): Promise<void> {
  try {
    await withAgentLock(conversationLockKey(tripId, "PRIVATE", actingUserId), async () => {
      // My Clockwise is a direct 1:1 conversation — the agent always replies
      // here (stay_silent isn't offered as a tool in private context).
      await respondToPrivateMessage(tripId, actingUserId);
    });
  } catch (err) {
    await recordTurnFailure(tripId, "PRIVATE", actingUserId, err);
  }
  revalidatePath(`/trips/${tripId}/agent`);
}

// Retries a failed Clockwise reply in place. Safe by construction: `failed`
// is only ever set when the provider call itself failed (see
// clockwise-agent.ts), which happens before any tool in that turn could
// have executed — so deleting the failed message and re-running the same
// agent turn from fresh DB state can never duplicate a tool execution or a
// booking/payment/commitment. The triggering human message is untouched
// and never resent. Also serialized through the same lock as normal
// turns, so a retry can never race a fresh message on the same conversation.
export async function retryAgentResponse(messageId: string) {
  const failedMessage = await prisma.message.findUnique({ where: { id: messageId } });
  if (!failedMessage || !failedMessage.failed) return;

  const tripId = failedMessage.tripId;

  if (failedMessage.channel === "PRIVATE") {
    if (!failedMessage.recipientId) return;
    await prisma.message.delete({ where: { id: messageId } });
    await withAgentLock(conversationLockKey(tripId, "PRIVATE", failedMessage.recipientId), async () => {
      await respondToPrivateMessage(tripId, failedMessage.recipientId!);
    });
    revalidatePath(`/trips/${tripId}/agent`);
    return;
  }

  // GROUP: find the human message this failed reply was responding to —
  // the most recent non-Clockwise message before it.
  const clockwiseUserId = await getClockwiseUserId();
  const priorHumanMessage = await prisma.message.findFirst({
    where: {
      tripId,
      channel: "GROUP",
      timestamp: { lt: failedMessage.timestamp },
      senderId: { not: clockwiseUserId },
    },
    orderBy: { timestamp: "desc" },
  });

  await prisma.message.delete({ where: { id: messageId } });

  if (priorHumanMessage) {
    await withAgentLock(conversationLockKey(tripId, "GROUP"), async () => {
      await respondToGroupMessage(tripId, priorHumanMessage.senderId);
    });
  }

  revalidatePath(`/trips/${tripId}/room`);
}
