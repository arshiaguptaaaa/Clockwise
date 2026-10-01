import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { PineLabsPaymentLinkStatus } from "@/lib/payments/pine-labs-provider";

// Mirrors the Gnani webhook's authenticity pattern exactly
// (src/app/api/integrations/gnani/webhook/route.ts): Pine Labs' callback
// mechanism has no documented cryptographic signature in what's available
// to us, so authenticity rests on a shared secret we configure ourselves
// in the callback URL/Pine Labs dashboard. Refuses all requests rather
// than trusting an unauthenticated POST if the secret isn't set.
const SECRET_HEADER = "x-clockwise-webhook-secret";

type PineLabsWebhookPayload = {
  payment_link_id?: string;
  merchant_order_reference?: string;
  status?: PineLabsPaymentLinkStatus;
};

export async function POST(request: NextRequest) {
  const configuredSecret = process.env.PINELABS_WEBHOOK_SECRET;
  if (!configuredSecret) {
    return NextResponse.json({ error: "Webhook not configured" }, { status: 503 });
  }
  if (request.headers.get(SECRET_HEADER) !== configuredSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const payload: PineLabsWebhookPayload = await request.json();
  if (!payload.status) {
    return NextResponse.json({ error: "Missing status" }, { status: 400 });
  }

  // merchant_order_reference is the Booking id itself (see
  // createTripPaymentRequest) — preferred match since it's ours and
  // unambiguous; payment_link_id as a fallback for a callback shape that
  // only echoes Pine Labs' own id.
  const booking = payload.merchant_order_reference
    ? await prisma.booking.findUnique({ where: { id: payload.merchant_order_reference } })
    : payload.payment_link_id
      ? await prisma.booking.findFirst({ where: { confirmationId: payload.payment_link_id } })
      : null;

  if (!booking) {
    // Real failure, not silently accepted — an unmatched webhook means
    // something is misconfigured and should be visible.
    return NextResponse.json({ error: "No matching payment request" }, { status: 404 });
  }

  // Booking.status stores Pine Labs' own vocabulary verbatim (see
  // trip-payments.ts) — this is the ONLY place a payment request ever
  // reaches PROCESSED, i.e. the only place "money actually moved" is
  // asserted, and it's driven entirely by Pine Labs' own report, never by
  // the organiser confirming the proposal.
  await prisma.booking.update({ where: { id: booking.id }, data: { status: payload.status } });

  return NextResponse.json({ ok: true });
}
