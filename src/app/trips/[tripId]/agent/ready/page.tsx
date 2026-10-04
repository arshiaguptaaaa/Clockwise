import { getCurrentUserId } from "@/lib/session";
import { buildReady } from "@/lib/traveller/ready";
import { ReadyList } from "@/components/journey/ReadyList";
import { BengaluruArt } from "@/components/art/BengaluruArt";

export const dynamic = "force-dynamic";

export default async function ReadyPage({ params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params;
  const userId = await getCurrentUserId();
  if (!userId) return null;
  const r = await buildReady(tripId, userId);
  const allSorted = r.total > 0 && r.sorted === r.total;
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-10 pt-6">
      <header>
        <p className="eyebrow">Ready?</p>
        <h1 className="headline headline-xl mt-2">
          {r.sorted} / {r.total} sorted.
        </h1>
        <p className="lede mt-2 max-w-[20rem]">Only you see this. Items say whether they&apos;re confirmed, likely needed or optional, and why.</p>
      </header>
      {allSorted && (
        <section className="section flex items-center gap-4" data-ready-moment>
          <BengaluruArt scene="ready" className="tile-in w-28 shrink-0 rotate-2 shadow-[0_12px_26px_-16px_rgba(20,24,26,0.55)]" />
          <p className="font-display text-[22px] leading-snug tracking-[-0.01em]">You&apos;re ready to go.</p>
        </section>
      )}
      <section className="section">
        <ReadyList tripId={tripId} items={r.items} />
        {r.weatherNote && <p className="mt-4 text-[11px] text-muted-foreground">{r.weatherNote}</p>}
      </section>
    </div>
  );
}
