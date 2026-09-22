"use client";

import type { CardStatus } from "@prisma/client";
import { ClockwiseActionCard } from "./ClockwiseActionCard";
import { confirmPayment } from "@/app/card-actions";

type Props = {
  messageId: string;
  status: CardStatus;
  title: string;
  context?: string;
  values?: { label: string; value: string }[];
  amount?: number;
  currency?: string;
};

export function PaymentCard({
  messageId,
  status,
  title,
  context,
  values,
  amount,
  currency,
}: Props) {
  const amountLabel = amount ? `${currency === "EUR" ? "€" : (currency ?? "")}${amount}` : "";

  return (
    <ClockwiseActionCard
      type="PAYMENT"
      title={title}
      context={context}
      values={values}
      status={status}
      primaryAction={
        status === "PENDING"
          ? {
              label: `Confirm ${amountLabel}`,
              pendingLabel: "Processing…",
              run: async () => {
                await confirmPayment(messageId);
              },
            }
          : undefined
      }
    />
  );
}
