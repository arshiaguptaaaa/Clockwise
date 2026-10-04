"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/session";
import { recomputeRendezvous } from "@/lib/rendezvous";

// The organiser adds a shared plan item (e.g. dinner) with an EXACT date and time chosen in the calendar. The
// moment is stored exactly as picked (the Commitment wall-clock convention) and shown back in full in the UI.
export async function addCommitmentAction(tripId: string, input: { name: string; local: string; location: string }): Promise<{ ok: true } | { ok: false; error: string }> {
  const userId = await getCurrentUserId();
  if (!userId) return { ok: false, error: "Sign in first." };
  const trip = await prisma.trip.findUnique({ where: { id: tripId }, select: { createdBy: true } });
  if (!trip) return { ok: false, error: "Trip not found." };
  if (trip.createdBy !== userId) return { ok: false, error: "Only the organiser adds shared plans. Anyone can suggest one in the Trip Room." };
  const name = input.name.trim().slice(0, 80);
  if (!name) return { ok: false, error: "What is it? Add a short name." };
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(input.local)) return { ok: false, error: "Pick the day and time." };
  const when = new Date(`${input.local}:00.000Z`);
  if (Number.isNaN(when.getTime())) return { ok: false, error: "That date and time isn't valid." };
  const c = await prisma.commitment.create({ data: { tripId, name, targetTime: when, location: input.location.trim().slice(0, 120), participantIds: "[]" } });
  await prisma.tripEvent.create({
    data: { tripId, kind: "COMMITMENT_ADDED", scope: "GROUP", actorUserId: userId, sourceChannel: "HUMAN", confidence: "HIGH", payload: JSON.stringify({ commitmentId: c.id, name, at: input.local, location: input.location.trim() || null, picked: "calendar" }), propagation: JSON.stringify(["plan", "rendezvous"]) },
  });
  await recomputeRendezvous(tripId).catch(() => undefined);
  revalidatePath(`/trips/${tripId}/plan`);
  revalidatePath(`/trips/${tripId}/room`);
  return { ok: true };
}
