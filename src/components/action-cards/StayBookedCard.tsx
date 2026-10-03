"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { CardStatus } from "@prisma/client";
import { ClockwiseActionCard } from "./ClockwiseActionCard";
import { markStayBookedAction } from "@/app/stay-actions";

// The step between "the group agreed" and "it's real". Only the organiser can
// press it; it does not book anything — it records that it was booked.
export function StayBookedCard({ bookingId, status, title, context, canMark }: { bookingId: string; status: CardStatus; title: string; context?: string; canMark: boolean }) {
  const router = useRouter();
  const [amount, setAmount] = useState("");
  return (
    <ClockwiseActionCard
      type="BOOKING"
      title={title}
      context={status === "CONFIRMED" ? "Booked — this stay is now in the Plan." : context}
      status={status}
      primaryAction={
        canMark && status === "PENDING"
          ? {
              label: "Mark booked",
              pendingLabel: "Saving…",
              run: async () => {
                const r = await markStayBookedAction(bookingId, amount, "INR");
                if (!r.ok) return { error: r.error };
                router.refresh();
              },
            }
          : undefined
      }
    >
      {canMark && status === "PENDING" && (
        <label className="mt-2 block text-xs text-muted-foreground">
          Total price, if you know it (optional, ₹)
          <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="adds a Committed stay to Budget" className="mt-1 w-full rounded-lg border border-border bg-page px-3 py-1.5 text-sm text-foreground" />
        </label>
      )}
    </ClockwiseActionCard>
  );
}
