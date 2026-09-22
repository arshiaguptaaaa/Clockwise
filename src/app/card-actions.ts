"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/session";
import { updateCardStatus, postActionCard, decodeCard } from "@/lib/action-cards";
import { paymentProvider } from "@/lib/providers/payments";

export async function dismissActionCard(messageId: string) {
  const message = await prisma.message.update({
    where: { id: messageId },
    data: { cardStatus: "DISMISSED" },
  });
  revalidatePath(`/trips/${message.tripId}/room`);
  revalidatePath(`/trips/${message.tripId}/agent`);
}

export async function confirmPayment(privateMessageId: string) {
  const actorId = await getCurrentUserId();

  const privateMessage = await prisma.message.findUniqueOrThrow({
    where: { id: privateMessageId },
  });
  const tripId = privateMessage.tripId;
  const privateData = decodeCard(privateMessage.cardData!);
  const currency = privateData.currency ?? "EUR";

  const result = await paymentProvider.charge({
    payerId: privateData.payerId!,
    amount: privateData.amount!,
    currency,
    purpose: privateData.title,
  });

  await prisma.booking.create({
    data: {
      tripId,
      type: "PAYMENT",
      status: "CONFIRMED",
      participantIds: "[]",
      payerId: privateData.payerId,
      amount: privateData.amount,
      currency,
      provider: "mock-payment",
      confirmationId: result.confirmationId,
    },
  });

  await prisma.auditLog.create({
    data: {
      tripId,
      actorId: actorId ?? "unknown",
      actionType: "PAYMENT_CONFIRMED",
      payloadSummary: `${currency}${privateData.amount} charged to ${privateData.payerId} for "${privateData.title}" (${result.confirmationId})`,
    },
  });

  await updateCardStatus(privateMessageId, "CONFIRMED");

  let groupValues = privateData.values;
  if (privateData.linkedMessageId) {
    const groupMessage = await prisma.message.findUnique({
      where: { id: privateData.linkedMessageId },
    });
    if (groupMessage?.cardData) {
      groupValues = decodeCard(groupMessage.cardData).values;
    }
    await updateCardStatus(privateData.linkedMessageId, "CONFIRMED");
  }

  await postActionCard({
    tripId,
    channel: "GROUP",
    type: "BOOKING",
    status: "CONFIRMED",
    data: {
      title: "Vienna hotel confirmed ✓",
      values: groupValues,
    },
  });

  revalidatePath(`/trips/${tripId}/agent`);
  revalidatePath(`/trips/${tripId}/room`);
}
