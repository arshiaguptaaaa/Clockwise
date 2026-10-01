// Trip-level payment abstraction over the existing Booking model —
// deliberately not a new Prisma model/migration, since Booking already
// has exactly the fields a payment request needs (amount, currency,
// provider, confirmationId, status, payerId). A payment request IS a
// Booking row: type "PAYMENT_REQUEST", provider "pinelabs",
// confirmationId holding Pine Labs' payment_link_id, status holding
// Pine Labs' own vocabulary (CREATED/CLICKED/.../PROCESSED/...) verbatim
// so there's exactly one source of truth for what a status means.
//
// PAYMENT and BOOKING are kept as separate concepts, per the product
// requirement: this module only ever creates/reads/cancels a payment
// request. It never claims an activity/booking itself is confirmed —
// that's the caller's job, conditioned on this module reporting
// status "PROCESSED".
import { prisma } from "./prisma";
import { getAppBaseUrl } from "./site-url";
import {
  createPaymentLink,
  getPaymentLinkStatus,
  cancelPaymentLink,
  isPineLabsConfigured,
  type PineLabsPaymentLinkStatus,
} from "./payments/pine-labs-provider";

export type CreateTripPaymentRequestInput = {
  tripId: string;
  purpose: string;
  amountMinorUnits: number;
  currency: string;
  payerName?: string;
  payerContact?: string;
  sourceProposalId?: string;
};

export type TripPaymentRequestResult =
  | { ok: true; bookingId: string; paymentLinkUrl: string; status: PineLabsPaymentLinkStatus }
  | { ok: false; reason: string; bookingId?: string };

// Idempotency: merchantReference is derived from the Booking id itself,
// generated up front, so a retried create() always carries the same
// reference Pine Labs would deduplicate on — never a fresh random value
// per attempt.
export async function createTripPaymentRequest(input: CreateTripPaymentRequestInput): Promise<TripPaymentRequestResult> {
  if (!isPineLabsConfigured()) {
    return { ok: false, reason: "Pine Labs isn't configured for this environment yet." };
  }

  const booking = await prisma.booking.create({
    data: {
      tripId: input.tripId,
      type: "PAYMENT_REQUEST",
      status: "CREATED",
      participantIds: JSON.stringify([]),
      provider: "pinelabs",
      amount: input.amountMinorUnits,
      currency: input.currency,
      sourceProposalId: input.sourceProposalId,
    },
  });

  const result = await createPaymentLink({
    merchantReference: booking.id,
    amountMinorUnits: input.amountMinorUnits,
    currency: input.currency,
    purpose: input.purpose,
    customerName: input.payerName,
    customerContact: input.payerContact,
    callbackUrl: `${getAppBaseUrl()}/api/integrations/pinelabs/webhook`,
  });

  if (!result.ok) {
    await prisma.booking.update({ where: { id: booking.id }, data: { status: "FAILED" } });
    return { ok: false, reason: result.reason, bookingId: booking.id };
  }

  await prisma.booking.update({
    where: { id: booking.id },
    data: { status: result.status, confirmationId: result.paymentLinkId },
  });

  return { ok: true, bookingId: booking.id, paymentLinkUrl: result.paymentLinkUrl, status: result.status };
}

export type TripPaymentStatusResult =
  | { ok: true; status: string; amount: number | null; currency: string | null }
  | { ok: false; reason: string };

// Reads the LOCAL persisted status by default (set by the webhook) rather
// than always round-tripping to Pine Labs — callers that need the
// absolute live truth should call refreshTripPaymentStatus instead.
export async function getTripPaymentStatus(bookingId: string): Promise<TripPaymentStatusResult> {
  const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
  if (!booking) return { ok: false, reason: "No payment request found for that id." };
  return { ok: true, status: booking.status, amount: booking.amount, currency: booking.currency };
}

// Polls Pine Labs directly and persists whatever it says — used when the
// webhook may not have fired yet (e.g. right after the user returns from
// the hosted payment page) rather than trusting a possibly-stale local row.
export async function refreshTripPaymentStatus(bookingId: string): Promise<TripPaymentStatusResult> {
  const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
  if (!booking) return { ok: false, reason: "No payment request found for that id." };
  if (!booking.confirmationId) return { ok: false, reason: "This payment request has no Pine Labs reference yet." };

  const live = await getPaymentLinkStatus(booking.confirmationId);
  if (!live.ok) return { ok: false, reason: live.reason };

  await prisma.booking.update({ where: { id: booking.id }, data: { status: live.status } });
  return { ok: true, status: live.status, amount: booking.amount, currency: booking.currency };
}

export async function cancelTripPaymentRequest(bookingId: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
  if (!booking) return { ok: false, reason: "No payment request found for that id." };
  if (!booking.confirmationId) return { ok: false, reason: "This payment request has no Pine Labs reference yet." };

  const result = await cancelPaymentLink(booking.confirmationId);
  if (!result.ok) return result;

  await prisma.booking.update({ where: { id: booking.id }, data: { status: "CANCELLED" } });
  return { ok: true };
}
