import { getCurrentUserId } from "@/lib/session";
import { myJourneys } from "@/lib/traveller/journey";
import { JourneyCard } from "@/components/journey/JourneyCard";
import { JourneyPanel } from "@/components/journey/JourneyPanel";

export const dynamic = "force-dynamic";

export default async function JourneyPage({ params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params;
  const userId = await getCurrentUserId();
  if (!userId) return null;
  const { pending, confirmed } = await myJourneys(tripId, userId);
  return (
    <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5">
      <header>
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">My journey</p>
        <h1 className="mt-1 font-display text-[28px] leading-[1.05]">YOUR CLOCK.</h1>
        <p className="mt-1 text-xs text-muted-foreground">Your ticket stays private. Once you confirm, the group sees only when and where you arrive.</p>
      </header>
      {confirmed ? <JourneyCard j={confirmed} badge="✓ CONFIRMED" /> : <p className="text-sm text-muted-foreground">No confirmed journey yet.</p>}
      <JourneyPanel tripId={tripId} pending={pending} hasConfirmed={Boolean(confirmed)} />
    </div>
  );
}
