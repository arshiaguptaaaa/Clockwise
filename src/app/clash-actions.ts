"use server";

// Buttons on CLOCKWISE CAUGHT A CLASH. Each is the same function the chat answers ("Yeah", "inform them",
// "cancel it", "leave it") call, so a tap and a sentence can never behave differently. Authority is enforced
// inside: only the organiser's own word cancels a shared commitment; a vote decides a move.
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/session";
import { getClockwiseUserId } from "@/lib/clockwise";
import { proposeClash, informClash, cancelClash, leaveClash, laterClash } from "@/lib/disruption";

export async function clashAction(clashId: string, action: "PROPOSE" | "INFORM" | "CANCEL" | "LEAVE" | "LATER", local?: string | null): Promise<{ ok: boolean; reply: string }> {
  const userId = await getCurrentUserId();
  if (!userId) return { ok: false, reply: "Sign in first." };
  const c = await prisma.tripClash.findUnique({ where: { id: clashId } });
  if (!c) return { ok: false, reply: "That clash isn't there any more." };
  const member = await prisma.tripMember.findUnique({ where: { tripId_userId: { tripId: c.tripId, userId } }, select: { id: true } });
  if (!member) return { ok: false, reply: "You're not on this trip." };
  const r = action === "PROPOSE" ? await proposeClash(clashId, userId, local) : action === "INFORM" ? await informClash(clashId, userId) : action === "CANCEL" ? await cancelClash(clashId, userId) : action === "LATER" ? await laterClash(clashId) : await leaveClash(clashId, userId);
  const clockwiseId = await getClockwiseUserId();
  // The outcome is said in the group room too, so everyone sees what happened and why.
  await prisma.message.create({ data: { tripId: c.tripId, senderId: clockwiseId, channel: "GROUP", content: r.reply } });
  for (const p of ["room", "plan", "agent"]) revalidatePath(`/trips/${c.tripId}/${p}`);
  return r;
}
