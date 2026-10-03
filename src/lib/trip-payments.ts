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
import { applyVerifiedPaymentStatus } from "./payment-lifecycle";
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
  // The traveller who will settle this link (the organiser who confirmed it).
  // Used as the Budget payer once Pine Labs reports PROCESSED.
  payerId?: string;
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
      payerId: input.payerId,
    },
  });

  // Pine Labs rejects a link with no customer (400 "Customer Information is
  // required"). Real travellers' own email/phone are used; only against the UAT
  // host, where no real payment can happen, a clearly fake test customer stands in.
  const isUat = /uat/i.test(process.env.PINELABS_API_BASE_URL || process.env.PINELABS_BASE_URL || "");
  const contact = input.payerContact || (isUat ? "uat-test@example.com" : undefined);
  if (!contact) {
    await prisma.booking.update({ where: { id: booking.id }, data: { status: "FAILED" } });
    return { ok: false, reason: "The payer has no email or phone on file, which Pine Labs requires.", bookingId: booking.id };
  }

  const result = await createPaymentLink({
    merchantReference: booking.id,
    amountMinorUnits: input.amountMinorUnits,
    currency: input.currency,
    purpose: input.purpose,
    customerName: input.payerName ?? (isUat ? "Clockwise UAT Test" : undefined),
    ...(contact.includes("@") ? { customerEmail: contact } : { customerMobile: contact }),
    // Where the payer is sent after the hosted page: our own landing route,
    // which re-fetches the real status. Not the webhook endpoint.
    callbackUrl: `${getAppBaseUrl()}/api/payments/return?booking=${booking.id}`,
  });

  if (!result.ok) {
    await prisma.booking.update({ where: { id: booking.id }, data: { status: "FAILED" } });
    return { ok: false, reason: result.reason, bookingId: booking.id };
  }

  await prisma.booking.update({
    where: { id: booking.id },
    data: { status: result.status, confirmationId: result.paymentLinkId, paymentUrl: result.paymentLinkUrl },
  });
  // Creating the link is recorded as exactly that — a link, not a payment.
  await prisma.tripEvent.create({
    data: {
      tripId: input.tripId,
      kind: "PAYMENT_LINK_CREATED",
      scope: "GROUP",
      sourceChannel: "PINELABS",
      confidence: "HIGH",
      payload: JSON.stringify({ bookingId: booking.id, amountMinor: input.amountMinorUnits, currency: input.currency, status: result.status, paid: false }),
      propagation: JSON.stringify(["payments", "chat"]),
    },
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

  await applyVerifiedPaymentStatus(booking.id, live.status, "RETURN_PAGE");
  return { ok: true, status: live.status, amount: booking.amount, currency: booking.currency };
}

export async function cancelTripPaymentRequest(bookingId: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
  if (!booking) return { ok: false, reason: "No payment request found for that id." };
  if (!booking.confirmationId) return { ok: false, reason: "This payment request has no Pine Labs reference yet." };

  // Pine Labs only allows cancelling CREATED or CLICKED links.
  if (booking.status !== "CREATED" && booking.status !== "CLICKED") {
    return { ok: false, reason: `A payment request that is ${booking.status} can't be cancelled.` };
  }
  const result = await cancelPaymentLink(booking.confirmationId);
  if (!result.ok) return result;

  await applyVerifiedPaymentStatus(booking.id, "CANCELLED", "CANCEL");
  return { ok: true };
}
