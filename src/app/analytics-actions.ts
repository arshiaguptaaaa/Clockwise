"use server";

import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/session";
import { trackEvent } from "@/lib/analytics";
import { variantFor } from "@/lib/experiments";

// The clash card was shown to this viewer. The variant is recomputed here from the session, never taken from
// the client, and a (clash, user) pair is counted once however often the page re-renders or polls.
export async function trackClashExposureAction(clashId: string): Promise<void> {
  const userId = await getCurrentUserId();
  if (!userId) return;
  const c = await prisma.tripClash.findUnique({ where: { id: clashId }, select: { tripId: true } });
  if (!c) return;
  const member = await prisma.tripMember.findUnique({ where: { tripId_userId: { tripId: c.tripId, userId } }, select: { id: true } });
  if (!member) return;
  await trackEvent("experiment_exposure", { userId, tripId: c.tripId, experiment: "clash_cta", variant: variantFor("clash_cta", userId), dedupeKey: `${clashId}:${userId}` });
}

const MAX_NOTE = 1000;

export async function submitFeedbackAction(input: { tripId?: string | null; page: string; rating?: number | null; message?: string }): Promise<{ ok: boolean }> {
  const userId = await getCurrentUserId();
  const rating = typeof input.rating === "number" && input.rating >= 1 && input.rating <= 5 ? Math.round(input.rating) : null;
  const message = (input.message ?? "").trim().slice(0, MAX_NOTE);
  if (rating === null && !message) return { ok: false };
  try {
    await prisma.feedback.create({ data: { userId, tripId: input.tripId ?? null, page: input.page.slice(0, 120), rating, message } });
    return { ok: true };
  } catch (err) {
    console.error("feedback failed:", err);
    return { ok: false };
  }
}

// Client-side events with a fixed allow-list, so the browser can't write arbitrary event names.
const CLIENT_EVENTS = new Set(["pwa_install_prompted", "pwa_install_accepted", "pwa_installed", "feedback_opened"]);

export async function trackClientEventAction(name: string, tripId?: string | null): Promise<void> {
  if (!CLIENT_EVENTS.has(name)) return;
  const userId = await getCurrentUserId();
  await trackEvent(name, { userId, tripId: tripId ?? null });
}
