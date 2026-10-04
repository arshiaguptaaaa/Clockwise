import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyPineLabsSignature } from "@/lib/payments/webhook-signature";
import { bookingIdForReference } from "@/lib/payments/obligations";
import { refreshTripPaymentStatus } from "@/lib/trip-payments";

// Pine Labs webhook receiver. Authenticity: the documented signature scheme
// (webhook-id / webhook-timestamp / webhook-signature, HMAC-SHA256 over
// id.timestamp.body, secret = dashboard secret) via PINELABS_WEBHOOK_SECRET.
// Refuses everything if that secret isn't set.
//
// A webhook is a TRIGGER, never evidence: the body's status is ignored.
// Event names / payload fields aren't relied on either — we look for our
// own identifiers anywhere in the payload, then ask Pine Labs' API for the
// authoritative status, and only that re-fetched status moves state
// (see payment-lifecycle.ts).
function findKey(node: unknown, key: string): string | null {
  if (!node || typeof node !== "object") return null;
  const obj = node as Record<string, unknown>;
  if (typeof obj[key] === "string") return obj[key] as string;
  for (const v of Object.values(obj)) {
    const hit = findKey(v, key);
    if (hit) return hit;
  }
  return null;
}

export async function POST(request: NextRequest) {
  const secret = process.env.PINELABS_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: "Webhook not configured" }, { status: 503 });

  const rawBody = await request.text();
  const valid = verifyPineLabsSignature({
    secret,
    id: request.headers.get("webhook-id"),
    timestamp: request.headers.get("webhook-timestamp"),
    signatureHeader: request.headers.get("webhook-signature"),
    rawBody,
  });
  if (!valid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const linkId = findKey(payload, "payment_link_id");
  const reference = findKey(payload, "merchant_payment_link_reference");
  const viaObligation = reference ? await bookingIdForReference(reference) : null;
  const booking = viaObligation
    ? await prisma.booking.findUnique({ where: { id: viaObligation } })
    : reference
      ? ((await prisma.booking.findUnique({ where: { id: reference } })) ?? (linkId ? await prisma.booking.findFirst({ where: { confirmationId: linkId } }) : null))
      : linkId
        ? await prisma.booking.findFirst({ where: { confirmationId: linkId } })
        : null;

  if (!booking) {
    // Valid signature but nothing of ours in it (an event type we don't
    // track). Acknowledge so Pine Labs doesn't retry, and leave a log line.
    console.warn("[pinelabs-webhook] verified event with no matching payment request");
    return NextResponse.json({ ok: true, matched: false }, { status: 202 });
  }

  const refreshed = await refreshTripPaymentStatus(booking.id);
  // Re-fetch failed (Pine Labs unreachable) -> 502 so Pine Labs retries.
  if (!refreshed.ok) return NextResponse.json({ error: "Couldn't verify status with Pine Labs" }, { status: 502 });
  return NextResponse.json({ ok: true, matched: true });
}
