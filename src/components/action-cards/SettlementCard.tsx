"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { CardStatus } from "@prisma/client";
import { ClockwiseActionCard } from "./ClockwiseActionCard";
import { confirmChatSettlementAction, dismissChatSettlementAction, authorisePineSettlementAction, checkPineSettlementAction } from "@/app/settlement-actions";

type Pine = { bookingId: string; status: string; url: string | null };

// Pine Labs' own status words, said plainly. A link existing is never "paid".
const PINE_WORDS: Record<string, string> = {
  CREATED: "PINE LABS UAT LINK CREATED · NOT PAID",
  CLICKED: "PINE LINK OPENED · NOT PAID",
  PAYMENT_INITIATED: "PAYMENT STARTED AT PINE LABS · NOT PAID YET",
  PROCESSED: "PAID · CONFIRMED BY PINE LABS",
  EXPIRED: "LINK EXPIRED · NOT PAID",
  CANCELLED: "LINK CANCELLED · NOT PAID",
};

// "@Clockwise pay Ridhima ₹1,000" -> the payer authorises ONE payment. Authorise creates a Pine Labs UAT link; the card then follows
// what Pine Labs reports. "I've already paid" only records a payment made outside Clockwise (and only when the confirmed ledger agrees).
export function SettlementCard({
  messageId,
  status,
  title,
  context,
  values,
  canAct,
  toName,
  pine,
}: {
  messageId: string;
  status: CardStatus;
  title: string;
  context?: string;
  values?: { label: string; value: string }[];
  canAct: boolean;
  toName: string;
  pine?: Pine;
}) {
  const router = useRouter();
  const [note, setNote] = useState<string | null>(null);
  const live = pine && ["CREATED", "CLICKED", "PAYMENT_INITIATED"].includes(pine.status);
  const word = pine ? PINE_WORDS[pine.status] ?? `PINE LABS STATUS: ${pine.status}` : null;
  const paidByPine = pine?.status === "PROCESSED";

  return (
    <ClockwiseActionCard
      type="PAYMENT"
      title={title}
      context={
        status === "CONFIRMED"
          ? paidByPine
            ? `Paid. Pine Labs confirmed it, and ${toName} has been told.`
            : `Recorded: you paid ${toName}. They've been told.`
          : status === "DISMISSED"
            ? "Nothing was recorded."
            : (note ?? (word ? `${word}. ${live ? "The payment has not been made until Pine Labs says so." : "Authorise again to get a fresh link."}` : context))
      }
      values={values}
      status={status}
      primaryAction={
        canAct && status === "PENDING"
          ? live
            ? {
                label: "Open Pine payment",
                pendingLabel: "Opening…",
                run: async () => {
                  if (pine?.url) window.open(pine.url, "_blank", "noopener,noreferrer");
                },
              }
            : {
                label: "Authorise payment",
                pendingLabel: "Creating Pine link…",
                run: async () => {
                  const r = await authorisePineSettlementAction(messageId);
                  if (!r.ok) return { error: r.error };
                  router.refresh();
                },
              }
          : undefined
      }
      secondaryAction={
        canAct && status === "PENDING"
          ? live
            ? {
                label: "Check status",
                pendingLabel: "Asking Pine Labs…",
                run: async () => {
                  const r = await checkPineSettlementAction(messageId);
                  if (!r.ok) return { error: r.error };
                  setNote(r.status === "PROCESSED" ? null : `${PINE_WORDS[r.status] ?? r.status}. Not paid until Pine Labs confirms.`);
                  router.refresh();
                },
              }
            : {
                label: "I've already paid",
                pendingLabel: "Recording…",
                run: async () => {
                  const r = await confirmChatSettlementAction(messageId);
                  if (!r.ok) return { error: r.error };
                },
              }
          : undefined
      }
    >
      {canAct && status === "PENDING" && !live && (
        <button
          type="button"
          onClick={async () => {
            await dismissChatSettlementAction(messageId);
            router.refresh();
          }}
          className="mt-2 cursor-pointer text-[11px] text-muted-foreground underline-offset-2 hover:underline"
        >
          Not now
        </button>
      )}
      {word && status !== "DISMISSED" && (
        <p className={`mt-2 inline-block rounded-full px-2.5 py-1 text-[10.5px] font-semibold tracking-[0.1em] ${paidByPine ? "bg-success/15 text-success" : "bg-tint-honey text-foreground"}`} data-pine-status={pine?.status}>
          {word}
        </p>
      )}
    </ClockwiseActionCard>
  );
}
