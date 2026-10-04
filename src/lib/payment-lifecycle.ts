// The payment state machine. A payment request is a Booking row
// (type PAYMENT_REQUEST) whose status is Pine Labs' own vocabulary. The rules
// this module enforces:
//   - a link existing is NOT a payment: CREATED/CLICKED/PAYMENT_INITIATED
//     never produce a "paid" anything;
//   - an organiser/member approving a proposal is NOT a payment;
//   - PAYMENT_CONFIRMED (and the group "confirmed" card) is emitted only from
//     here, only when a status that Clockwise itself fetched from Pine Labs'
//     API says PROCESSED. A webhook body is never trusted as proof — it only
//     triggers a re-fetch.
//   - PROCESSED is terminal; a later stale callback can't un-pay it.
import { revalidatePath } from "next/cache";
import { prisma } from "./prisma";
import { postActionCard } from "./action-cards";
import { notify, otherMemberIds } from "./notifications";
import { markPaidFromPayment } from "./budget/ledger";
import { syncObligationFromBooking } from "./payments/obligations";

export type StatusSource = "CREATE" | "RETURN_PAGE" | "WEBHOOK_TRIGGERED_REFETCH" | "POLL" | "CANCEL";

const TERMINAL = new Set(["PROCESSED", "CANCELLED", "EXPIRED"]);

function money(minor: number | null, currency: string | null) {
  if (minor == null) return "";
  return `${currency === "INR" ? "₹" : currency === "EUR" ? "€" : `${currency ?? ""} `}${(minor / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

export async function applyVerifiedPaymentStatus(bookingId: string, liveStatus: string, source: StatusSource) {
  const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
  if (!booking || booking.type !== "PAYMENT_REQUEST") return { changed: false as const };
  if (booking.status === liveStatus) return { changed: false as const };
  if (booking.status === "PROCESSED") return { changed: false as const }; // terminal, never regress
  if (TERMINAL.has(booking.status) && liveStatus !== "PROCESSED") return { changed: false as const };

  await prisma.booking.update({ where: { id: booking.id }, data: { status: liveStatus } });
  const statusEvent = await prisma.tripEvent.create({
    data: {
      tripId: booking.tripId,
      kind: "PAYMENT_LINK_STATUS",
      scope: "GROUP",
      sourceChannel: "PINELABS",
      confidence: "HIGH",
      payload: JSON.stringify({ bookingId: booking.id, from: booking.status, to: liveStatus, source, amountMinor: booking.amount, currency: booking.currency }),
      propagation: JSON.stringify(["payments", "chat"]),
    },
  });

  // A traveller's share of a group payment: that obligation (and only that one) moves, in its own
  // idempotent path, with its own Budget entry and notifications.
  if (await syncObligationFromBooking(booking.id, liveStatus)) {
    try {
      revalidatePath(`/trips/${booking.tripId}/room`);
      revalidatePath(`/trips/${booking.tripId}/budget`);
    } catch {
      // best-effort outside a request
    }
    return { changed: true as const, status: liveStatus };
  }

  const href = `/trips/${booking.tripId}/room`;
  const everyone = (await prisma.tripMember.findMany({ where: { tripId: booking.tripId }, select: { userId: true } })).map((m) => m.userId);

  if (liveStatus === "PROCESSED") {
    const confirmed = await prisma.tripEvent.create({
      data: {
        tripId: booking.tripId,
        kind: "PAYMENT_CONFIRMED",
        scope: "GROUP",
        sourceChannel: "PINELABS",
        confidence: "HIGH",
        payload: JSON.stringify({ bookingId: booking.id, amountMinor: booking.amount, currency: booking.currency, verifiedBy: "pinelabs_api_fetch", causedBy: statusEvent.id }),
        propagation: JSON.stringify(["payments", "chat", "notifications"]),
      },
    });
    // Verified money movement -> the Budget ledger (COMMITTED -> PAID).
    await markPaidFromPayment({
      tripId: booking.tripId,
      bookingId: booking.id,
      proposalId: booking.sourceProposalId,
      amountMinor: booking.amount ?? 0,
      currency: booking.currency ?? "INR",
      payerId: booking.payerId,
    }).catch((err) => console.error("[budget] mark paid failed:", err instanceof Error ? err.message : err));
    await postActionCard({
      tripId: booking.tripId,
      channel: "GROUP",
      type: "BOOKING",
      status: "CONFIRMED",
      data: { title: `Payment received — ${money(booking.amount, booking.currency)}`, values: [{ label: "Status", value: "Confirmed by Pine Labs" }] },
    });
    await notify({
      tripId: booking.tripId,
      recipientIds: everyone,
      severity: "HIGH",
      kind: "PAYMENT_CONFIRMED",
      title: "Payment confirmed",
      body: `Pine Labs confirmed a payment of ${money(booking.amount, booking.currency)}.`,
      href,
      eventId: confirmed.id,
    });
  } else if (liveStatus === "EXPIRED" || liveStatus === "CANCELLED") {
    await notify({
      tripId: booking.tripId,
      recipientIds: await otherMemberIds(booking.tripId, null),
      severity: "IMPORTANT",
      kind: "PAYMENT_LINK_STATUS",
      title: liveStatus === "EXPIRED" ? "A payment link expired" : "A payment link was cancelled",
      body: `The ${money(booking.amount, booking.currency)} payment request is no longer payable.`,
      href,
      eventId: statusEvent.id,
    });
  }

  // Close the "Pay securely" card(s) for this booking once the link is terminal.
  if (TERMINAL.has(liveStatus)) {
    const cards = await prisma.message.findMany({ where: { tripId: booking.tripId, cardType: "BOOKING", cardStatus: "PENDING", cardData: { contains: booking.id } }, select: { id: true, cardData: true } });
    for (const c of cards) {
      if (c.cardData?.includes('"payLink":true')) {
        await prisma.message.update({ where: { id: c.id }, data: { cardStatus: liveStatus === "PROCESSED" ? "CONFIRMED" : "DISMISSED" } });
      }
    }
  }

  try {
    revalidatePath(`/trips/${booking.tripId}/room`);
  } catch {
    // best-effort outside a request
  }
  return { changed: true as const, status: liveStatus };
}
