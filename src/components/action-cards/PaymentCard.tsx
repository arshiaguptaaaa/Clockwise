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
  const amountLabel = amount ? `${currency === "EUR" ? "€" : currency === "INR" || !currency ? "₹" : `${currency} `}${amount}` : "";

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
              label: `Pay securely ${amountLabel}`,
              pendingLabel: "Creating payment link…",
              run: async () => {
                const result = await confirmPayment(messageId);
                if (result.paymentLinkUrl) {
                  window.open(result.paymentLinkUrl, "_blank", "noopener,noreferrer");
                }
                return result;
              },
            }
          : undefined
      }
    />
  );
}
