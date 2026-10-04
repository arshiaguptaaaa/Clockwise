"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/session";
import { refreshTripPaymentStatus } from "@/lib/trip-payments";
import { payObligation } from "@/lib/payments/obligations";

async function memberBooking(bookingId: string) {
  const userId = await getCurrentUserId();
  if (!userId) return null;
  const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
  if (!booking || booking.type !== "PAYMENT_REQUEST") return null;
  const member = await prisma.tripMember.findUnique({ where: { tripId_userId: { tripId: booking.tripId, userId } } });
  return member ? booking : null;
}

// The hosted Pine Labs checkout for a payment request on one of the viewer's trips.
export async function getCheckoutUrl(bookingId: string): Promise<{ url?: string; error?: string }> {
  const booking = await memberBooking(bookingId);
  if (!booking) return { error: "Payment request not found." };
  if (!booking.paymentUrl) return { error: "This payment request has no checkout link." };
  if (["PROCESSED", "CANCELLED", "EXPIRED"].includes(booking.status)) return { error: `This link is ${booking.status.toLowerCase()}.` };
  return { url: booking.paymentUrl };
}

// Asks Pine Labs (STATUS API) for the real status and applies it. Returns what
// Pine Labs said — never what the page hopes.
export async function checkPaymentStatus(bookingId: string): Promise<{ status?: string; error?: string }> {
  const booking = await memberBooking(bookingId);
  if (!booking) return { error: "Payment request not found." };
  const r = await refreshTripPaymentStatus(bookingId);
  revalidatePath(`/trips/${booking.tripId}/room`);
  revalidatePath(`/trips/${booking.tripId}/budget`);
  if (!r.ok) console.error("[payments] status check failed:", r.reason.slice(0, 200));
  return r.ok ? { status: r.status } : { error: "Couldn't check that payment just now. Try again in a moment." };
}

// PAY MY SHARE: opens the signed-in traveller's OWN link. Only the owner of an obligation can open it.
export async function payObligationAction(obligationId: string): Promise<{ ok: true; url: string; already?: boolean } | { ok: false; title: string; body: string }> {
  const userId = await getCurrentUserId();
  if (!userId) return { ok: false, title: "Sign in first", body: "Then try again." };
  const r = await payObligation(obligationId, userId);
  if (r.ok) {
    const o = await prisma.paymentObligation.findUnique({ where: { id: obligationId }, select: { tripId: true } });
    if (o) {
      revalidatePath(`/trips/${o.tripId}/room`);
      revalidatePath(`/trips/${o.tripId}/budget`);
    }
  }
  return r;
}

// Re-reads the real Pine Labs status of the caller's own share (after they come back from checkout).
export async function checkObligationAction(obligationId: string): Promise<{ status: "PAID" | "PAYING" | "DUE" | "UNKNOWN" }> {
  const userId = await getCurrentUserId();
  if (!userId) return { status: "UNKNOWN" };
  const o = await prisma.paymentObligation.findUnique({ where: { id: obligationId } });
  if (!o || o.userId !== userId) return { status: "UNKNOWN" };
  if (o.bookingId && o.status !== "PAID") await refreshTripPaymentStatus(o.bookingId);
  const fresh = await prisma.paymentObligation.findUnique({ where: { id: obligationId }, select: { status: true, tripId: true } });
  if (fresh) {
    revalidatePath(`/trips/${fresh.tripId}/room`);
    revalidatePath(`/trips/${fresh.tripId}/budget`);
  }
  return { status: (fresh?.status as "PAID" | "PAYING" | "DUE") ?? "UNKNOWN" };
}
