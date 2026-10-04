"use client";

import { useRouter } from "next/navigation";
import type { CardStatus } from "@prisma/client";
import { ClockwiseActionCard } from "./ClockwiseActionCard";
import { confirmExpenseAction, voidExpenseAction } from "@/app/budget-actions";

// "Clockwise caught that ✦" — a money statement understood from chat. Nothing
// is recorded until the person who said it (or the payer) confirms here.
export function ExpenseCard({
  tripId,
  messageId,
  expenseId,
  status,
  title,
  context,
  values,
  canAct,
  debt,
}: {
  tripId: string;
  messageId: string;
  expenseId: string;
  status: CardStatus;
  title: string;
  context?: string;
  values?: { label: string; value: string }[];
  canAct: boolean;
  debt?: boolean;
}) {
  const router = useRouter();
  return (
    <ClockwiseActionCard
      type="DECISION"
      title={title}
      context={status === "CONFIRMED" ? (debt ? "Recorded as a single debt in Budget." : "Added to Budget.") : status === "DISMISSED" ? (debt ? "Not recorded." : "Not added.") : (context ?? "Nothing is recorded until it's confirmed.")}
      values={values}
      status={status}
      primaryAction={
        canAct && status === "PENDING"
          ? {
              label: debt ? "Record this debt" : "Add expense",
              pendingLabel: "Adding…",
              run: async () => {
                const r = await confirmExpenseAction(expenseId, messageId);
                if (!r.ok) return { error: r.error };
              },
            }
          : undefined
      }
      secondaryAction={
        canAct && status === "PENDING"
          ? {
              label: "Edit",
              run: async () => {
                router.push(`/trips/${tripId}/budget?edit=${expenseId}`);
              },
            }
          : undefined
      }
    >
      {canAct && status === "PENDING" && (
        <button
          type="button"
          onClick={async () => {
            await voidExpenseAction(expenseId, messageId);
            router.refresh();
          }}
          className="mt-2 cursor-pointer text-[11px] text-muted-foreground underline-offset-2 hover:underline"
        >
          {debt ? "Not owed" : "Not an expense"}
        </button>
      )}
    </ClockwiseActionCard>
  );
}
