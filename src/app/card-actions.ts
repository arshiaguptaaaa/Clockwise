"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/session";
import { postActionCard, decodeCard } from "@/lib/action-cards";
import { createTripPaymentRequest } from "@/lib/trip-payments";
import { rupeesToPaise, PAYMENT_FAILED_TITLE, PAYMENT_FAILED_BODY } from "@/lib/payments/amount";

export async function dismissActionCard(messageId: string) {
  const message = await prisma.message.update({
    where: { id: messageId },
    data: { cardStatus: "DISMISSED" },
  });
  revalidatePath(`/trips/${message.tripId}/room`);
  revalidatePath(`/trips/${message.tripId}/agent`);
}

// Real fix, not a refactor: this used to call a mock payment provider
// that always "succeeds" instantly, write a CONFIRMED Booking regardless,
// and post a hardcoded "hotel confirmed ✓" group card no matter
// what the actual purpose was (a leftover from the original seeded demo).
// A Pine Labs Payment Link is inherently asynchronous — creating it only
// means the payer now HAS somewhere to pay, not that they have. The real
// CONFIRMED state is asserted only by the Pine Labs webhook
// (/api/integrations/pinelabs/webhook) once it reports PROCESSED.
export async function confirmPayment(
  privateMessageId: string
): Promise<{ error?: string; paymentLinkUrl?: string }> {
  const actorId = await getCurrentUserId();

  const privateMessage = await prisma.message.findUniqueOrThrow({
    where: { id: privateMessageId },
  });
  const tripId = privateMessage.tripId;
  const privateData = decodeCard(privateMessage.cardData!);
  const currency = privateData.currency ?? "INR";
  // The card's amount is checked, not trusted: a missing or malformed value never reaches Pine Labs.
  const amountMinor = rupeesToPaise(privateData.amount);
  if (amountMinor == null) {
    return { error: `${PAYMENT_FAILED_TITLE}. ${PAYMENT_FAILED_BODY}` };
  }
  const amount = amountMinor / 100;

  const result = await createTripPaymentRequest({
    tripId,
    purpose: privateData.title,
    amountMinorUnits: amountMinor,
    currency,
  });

  if (!result.ok) {
    // The provider's own message is in Developer Evidence; the traveller gets a plain sentence.
    console.error("[payments] card payment failed:", result.reason.slice(0, 200));
    return { error: `${PAYMENT_FAILED_TITLE}. ${PAYMENT_FAILED_BODY}` };
  }

  await prisma.auditLog.create({
    data: {
      tripId,
      actorId: actorId ?? "unknown",
      actionType: "PAYMENT_LINK_CREATED",
      payloadSummary: `Payment link created for "${privateData.title}" (${currency}${amount}), booking ${result.bookingId}, status ${result.status}.`,
    },
  });

  // Deliberately NOT marking CONFIRMED here — the payer has a real link to
  // pay, nothing has actually happened yet. Both cards stay PENDING until
  // the webhook reports PROCESSED.
  let groupValues = privateData.values;
  if (privateData.linkedMessageId) {
    const groupMessage = await prisma.message.findUnique({
      where: { id: privateData.linkedMessageId },
    });
    if (groupMessage?.cardData) {
      groupValues = decodeCard(groupMessage.cardData).values;
    }
  }

  await postActionCard({
    tripId,
    channel: "GROUP",
    type: "BOOKING",
    status: "PENDING",
    data: {
      title: `${privateData.title} — payment link sent`,
      values: groupValues,
    },
  });

  revalidatePath(`/trips/${tripId}/agent`);
  revalidatePath(`/trips/${tripId}/room`);

  return { paymentLinkUrl: result.paymentLinkUrl };
}
