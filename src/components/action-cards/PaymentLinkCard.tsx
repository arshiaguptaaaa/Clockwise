"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { CardStatus } from "@prisma/client";
import { ClockwiseActionCard } from "./ClockwiseActionCard";
import { getCheckoutUrl, checkPaymentStatus } from "@/app/payment-actions";

// "Pay securely" for a Pine Labs payment link. Opening checkout or coming back
// proves nothing: the card only turns CONFIRMED after Clockwise fetches
// PROCESSED from Pine Labs' API.
export function PaymentLinkCard({ bookingId, status, title, context }: { bookingId: string; status: CardStatus; title: string; context?: string }) {
  const router = useRouter();
  const [note, setNote] = useState<string | null>(null);
  return (
    <ClockwiseActionCard
      type="PAYMENT"
      title={title}
      context={status === "CONFIRMED" ? "Payment confirmed." : status === "DISMISSED" ? "This payment link is no longer payable." : (note ?? context)}
      status={status}
      primaryAction={
        status === "PENDING"
          ? {
              label: "Pay securely",
              pendingLabel: "Opening checkout…",
              run: async () => {
                const r = await getCheckoutUrl(bookingId);
                if (r.url) window.open(r.url, "_blank", "noopener,noreferrer");
                return r.error ? { error: r.error } : undefined;
              },
            }
          : undefined
      }
      secondaryAction={
        status === "PENDING"
          ? {
              label: "I've paid — check status",
              pendingLabel: "Checking…",
              run: async () => {
                const r = await checkPaymentStatus(bookingId);
                if (r.error) return { error: r.error };
                setNote(r.status === "PROCESSED" ? "Paid ✓" : r.status === "CANCELLED" || r.status === "EXPIRED" ? "That payment link has expired." : "Not paid yet.");
                router.refresh();
              },
            }
          : undefined
      }
    />
  );
}
