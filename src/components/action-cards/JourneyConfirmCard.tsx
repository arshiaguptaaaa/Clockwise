"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { CardStatus } from "@prisma/client";
import { ClockwiseActionCard } from "./ClockwiseActionCard";
import { confirmJourneyAction, discardJourneyAction } from "@/app/traveller-actions";

// Private card in My Clockwise: nothing is saved or shared until "Yes".
export function JourneyConfirmCard({ tripId, journeyId, status, title, context }: { tripId: string; journeyId: string; status: CardStatus; title: string; context?: string }) {
  const router = useRouter();
  return (
    <ClockwiseActionCard
      type="DOCUMENT"
      title={title}
      context={status === "CONFIRMED" ? "Saved — your arrival is now in the Plan." : status === "DISMISSED" ? "Discarded." : context}
      status={status}
      primaryAction={
        status === "PENDING"
          ? {
              label: "Yes, save journey",
              pendingLabel: "Saving…",
              run: async () => {
                const r = await confirmJourneyAction(tripId, journeyId);
                if (!r.ok) return { error: r.error };
                router.refresh();
              },
            }
          : undefined
      }
      secondaryAction={
        status === "PENDING"
          ? {
              label: "Edit",
              run: async () => {
                router.push(`/trips/${tripId}/agent/journey`);
              },
            }
          : undefined
      }
    >
      {status === "PENDING" && (
        <div className="mt-2 flex items-center gap-3 text-xs">
          <Link href={`/trips/${tripId}/agent/journey`} className="font-semibold text-accent underline-offset-2 hover:underline">
            See what I read
          </Link>
          <button type="button" className="cursor-pointer text-muted-foreground" onClick={async () => { await discardJourneyAction(tripId, journeyId); router.refresh(); }}>
            Not mine
          </button>
        </div>
      )}
    </ClockwiseActionCard>
  );
}
