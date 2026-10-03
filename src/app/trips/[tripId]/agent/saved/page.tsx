import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/session";
import { savedOverlaps } from "@/lib/travel/saved-overlap";
import { countWord } from "@/lib/travel/around-categories";

export const dynamic = "force-dynamic";

export default async function SavedPage({ params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params;
  const userId = await getCurrentUserId();
  if (!userId) return null;
  const [rows, overlaps] = await Promise.all([prisma.savedPlace.findMany({ where: { tripId, userId }, orderBy: { createdAt: "desc" } }), savedOverlaps(tripId, userId)]);
  return (
    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-5">
      <header>
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Saved</p>
        <h1 className="mt-1 font-display text-[28px] leading-[1.05]">♡ YOURS ONLY.</h1>
        <p className="mt-1 text-xs text-muted-foreground">Private. Saving never tells the group or changes the Plan.</p>
      </header>
      {overlaps.map((o) => (
        <div key={o.providerPlaceId} className="rounded-xl border border-accent bg-pop-pink-tint p-3" data-overlap={o.name}>
          <p className="font-display text-xl leading-tight">◷ WAIT. {countWord(o.count)} OF YOU SAVED THIS.</p>
          <p className="mt-1 text-sm font-semibold uppercase">{o.name}</p>
          <p className="text-xs text-muted-foreground">Nobody is told who saved what. Proposing it to the group isn&apos;t available yet.</p>
        </div>
      ))}
      {rows.length === 0 && <p className="text-sm text-muted-foreground">Nothing saved yet. Tap SAVE on a place in Around You or on a stay.</p>}
      <ul className="space-y-2">
        {rows.map((r) => (
          <li key={r.id} className="rounded-xl border border-border p-3" data-saved={r.name}>
            <p className="text-sm font-semibold">{r.name}</p>
            <p className="text-xs text-muted-foreground">
              {r.kind.toLowerCase()} · {r.address ?? ""} · {r.provider}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}
