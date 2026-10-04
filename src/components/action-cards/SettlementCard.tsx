"use client";

import type { CardStatus } from "@prisma/client";
import { ClockwiseActionCard } from "./ClockwiseActionCard";
import { confirmChatSettlementAction, dismissChatSettlementAction } from "@/app/settlement-actions";

// "Pay her the remaining amount" -> the confirmed balance, shown for confirmation. Clockwise does not move money: the
// button records that YOU have paid, outside Clockwise, and tells the other person. Nothing is created until it is pressed.
export function SettlementCard({
  messageId,
  status,
  title,
  context,
  values,
  canAct,
  toName,
}: {
  messageId: string;
  status: CardStatus;
  title: string;
  context?: string;
  values?: { label: string; value: string }[];
  canAct: boolean;
  toName: string;
}) {
  return (
    <ClockwiseActionCard
      type="PAYMENT"
      title={title}
      context={status === "CONFIRMED" ? `Recorded: you paid ${toName}. They've been told.` : status === "DISMISSED" ? "Nothing was recorded." : context}
      values={values}
      status={status}
      primaryAction={
        canAct && status === "PENDING"
          ? {
              label: "Yes, I've paid",
              pendingLabel: "Recording…",
              run: async () => {
                const r = await confirmChatSettlementAction(messageId);
                if (!r.ok) return { error: r.error };
              },
            }
          : undefined
      }
      secondaryAction={
        canAct && status === "PENDING"
          ? {
              label: "Not yet",
              run: async () => {
                await dismissChatSettlementAction(messageId);
              },
            }
          : undefined
      }
    />
  );
}
