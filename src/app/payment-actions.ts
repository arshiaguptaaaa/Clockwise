"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/session";
import { refreshTripPaymentStatus } from "@/lib/trip-payments";

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
  return r.ok ? { status: r.status } : { error: r.reason };
}
