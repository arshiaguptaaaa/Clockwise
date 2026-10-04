"use server";

// Buttons on a private note from another traveller: GOT IT, ASK <SENDER>, and the "delivered" report when the
// toast has actually been shown. Every action is scoped to the signed-in recipient inside private-notes.ts.
import { revalidatePath } from "next/cache";
import { getCurrentUserId } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { acknowledge, askSender, markDelivered } from "@/lib/private-notes";

async function member(tripId: string) {
  const userId = await getCurrentUserId();
  if (!userId) return null;
  const m = await prisma.tripMember.findUnique({ where: { tripId_userId: { tripId, userId } }, select: { id: true } });
  return m ? userId : null;
}

export async function ackNoteAction(tripId: string, noteId: string): Promise<void> {
  const userId = await member(tripId);
  if (!userId) return;
  await acknowledge(tripId, userId, noteId);
  revalidatePath(`/trips/${tripId}/agent`);
}

export async function askSenderAction(tripId: string, noteId: string): Promise<void> {
  const userId = await member(tripId);
  if (!userId) return;
  await askSender(tripId, userId, noteId);
  revalidatePath(`/trips/${tripId}/agent`);
}

export async function noteShownAction(tripId: string, ids: string[]): Promise<void> {
  const userId = await member(tripId);
  if (!userId || ids.length === 0) return;
  await markDelivered(tripId, userId, ids.slice(0, 10));
}
