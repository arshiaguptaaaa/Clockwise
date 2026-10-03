import { getCurrentUserId } from "@/lib/session";
import { buildReady } from "@/lib/traveller/ready";
import { ReadyList } from "@/components/journey/ReadyList";

export const dynamic = "force-dynamic";

export default async function ReadyPage({ params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params;
  const userId = await getCurrentUserId();
  if (!userId) return null;
  const r = await buildReady(tripId, userId);
  return (
    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-5">
      <header>
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Ready?</p>
        <h1 className="mt-1 font-display text-[28px] leading-[1.05]">
          {r.sorted} / {r.total} SORTED.
        </h1>
        <p className="mt-1 text-xs text-muted-foreground">Only you see this. Items say whether they&apos;re confirmed, likely needed or optional — and why.</p>
      </header>
      <ReadyList tripId={tripId} items={r.items} />
      {r.weatherNote && <p className="text-[11px] text-muted-foreground">{r.weatherNote}</p>}
    </div>
  );
}
