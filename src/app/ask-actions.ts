"use server";

import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/session";
import { getClockwiseUserId } from "@/lib/clockwise";
import { postPrivateMessage, runPrivateAgentTurn } from "@/app/actions";

// Ask Clockwise = the traveller's PRIVATE agent conversation, opened from the
// Trip Room as a sheet. Nothing here touches the group thread: the question
// and the answer live in My Clockwise, and anything that needs the group goes
// through the same propose_* tools (and approvals) as before.
export type AskResult = { ok: true; reply: string | null; hasCard: boolean } | { ok: false; error: string };

export async function askClockwise(tripId: string, text: string): Promise<AskResult> {
  const userId = await getCurrentUserId();
  if (!userId) return { ok: false, error: "Sign in first." };
  const member = await prisma.tripMember.findFirst({ where: { tripId, userId }, select: { id: true } });
  if (!member) return { ok: false, error: "You're not on this trip." };
  const content = text.trim().slice(0, 1000);
  if (!content) return { ok: false, error: "Ask me something." };

  const form = new FormData();
  form.set("content", content);
  const posted = await postPrivateMessage(tripId, form);
  if (!posted) return { ok: false, error: "Couldn't send that." };
  const since = new Date(Date.now() - 2000);
  await runPrivateAgentTurn(tripId, userId);

  const clockwiseId = await getClockwiseUserId();
  const latest = await prisma.message.findFirst({
    where: { tripId, channel: "PRIVATE", recipientId: userId, senderId: clockwiseId, timestamp: { gte: since } },
    orderBy: { timestamp: "desc" },
  });
  if (!latest || latest.failed) return { ok: false, error: "Couldn't get an answer. Try again?" };
  return { ok: true, reply: latest.content || null, hasCard: Boolean(latest.cardType) };
}
