import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/session";
import { refreshTripPaymentStatus } from "@/lib/trip-payments";

// Where Pine Labs sends the payer after the hosted page. Landing here proves
// nothing about payment — so this re-fetches the real status from Pine Labs
// (which is what moves state) and then drops the traveller back in the room.
export async function GET(request: NextRequest) {
  const bookingId = request.nextUrl.searchParams.get("booking");
  const booking = bookingId ? await prisma.booking.findUnique({ where: { id: bookingId } }) : null;
  const userId = await getCurrentUserId();
  if (!booking || booking.type !== "PAYMENT_REQUEST" || !userId) return NextResponse.redirect(new URL("/", request.url));

  const member = await prisma.tripMember.findUnique({ where: { tripId_userId: { tripId: booking.tripId, userId } } });
  if (!member) return NextResponse.redirect(new URL("/", request.url));

  await refreshTripPaymentStatus(booking.id);
  return NextResponse.redirect(new URL(`/trips/${booking.tripId}/room`, request.url));
}
