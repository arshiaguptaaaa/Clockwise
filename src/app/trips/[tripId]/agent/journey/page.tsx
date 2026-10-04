import { getCurrentUserId } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { myJourneys } from "@/lib/traveller/journey";
import { buildRendezvousView } from "@/lib/rendezvous";
import { JourneyCard } from "@/components/journey/JourneyCard";
import { JourneyPanel } from "@/components/journey/JourneyPanel";
import { BengaluruArt } from "@/components/art/BengaluruArt";

export const dynamic = "force-dynamic";

export default async function JourneyPage({ params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params;
  const userId = await getCurrentUserId();
  if (!userId) return null;
  const [{ pending, confirmed }, view, me] = await Promise.all([myJourneys(tripId, userId), buildRendezvousView(tripId), prisma.user.findUnique({ where: { id: userId }, select: { name: true } })]);
  // Is anything the group agreed no longer workable for THIS traveller's clock?
  const atRisk = me ? view.commitments.filter((c) => c.late.some((l) => l.name === me.name)) : [];
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-10 pt-6">
      <header>
        <p className="eyebrow">My journey</p>
        <h1 className="headline headline-xl mt-2">Your clock.</h1>
        <p className="lede mt-2 max-w-[20rem]">Your ticket stays private. Once you confirm, the group sees only when and where you arrive.</p>
      </header>

      {confirmed ? (
        <section className="section">
          <JourneyCard j={confirmed} badge="✓ Confirmed" />
          <div className="mt-6 flex items-center gap-4" data-journey-moment={atRisk.length ? "delayed" : "arriving"}>
            <BengaluruArt scene={atRisk.length ? "waiting" : "arrive"} className="tile-in w-28 shrink-0 -rotate-2 shadow-[0_12px_26px_-16px_rgba(20,24,26,0.55)]" />
            <p className="font-display text-[19px] leading-snug tracking-[-0.01em]">
              {atRisk.length ? `Your clock moved. ${atRisk[0].name} at ${atRisk[0].target.slice(11)} no longer works until the group decides.` : "Your arrival is in the Plan. The group can see when, and where."}
            </p>
          </div>
        </section>
      ) : (
        <section className="section text-center">
          <BengaluruArt scene="arrive" className="tile-in mx-auto w-56 -rotate-2 shadow-[0_14px_30px_-16px_rgba(20,24,26,0.5)]" />
          <p className="headline headline-md mt-6">No journey yet.</p>
          <p className="lede mx-auto mt-2 max-w-[17rem]">Upload a ticket or add the details. Clockwise reads it privately.</p>
        </section>
      )}

      <section className="section">
        <JourneyPanel tripId={tripId} pending={pending} hasConfirmed={Boolean(confirmed)} />
      </section>
    </div>
  );
}
