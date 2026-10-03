import { getCurrentUserId } from "@/lib/session";
import { getAroundAnchor } from "@/lib/travel/around";
import { AROUND_CATEGORIES } from "@/lib/travel/around-categories";
import { getPrefs } from "@/lib/traveller/vibe";
import { AroundYou } from "@/components/around/AroundYou";

export const dynamic = "force-dynamic";

export default async function AroundPage({ params, searchParams }: { params: Promise<{ tripId: string }>; searchParams: Promise<{ cat?: string }> }) {
  const { tripId } = await params;
  const { cat } = await searchParams;
  const userId = await getCurrentUserId();
  if (!userId) return null;
  const [anchor, prefs] = await Promise.all([getAroundAnchor(tripId), getPrefs(tripId, userId)]);
  if (!anchor) return <p className="px-5 py-8 text-sm text-muted-foreground">Add a destination first — Around You centres on it, and on your stay once it&apos;s confirmed.</p>;
  // YOUR KIND OF PLACES first (from the vibe check), then the rest — not every category equally.
  const all = Object.keys(AROUND_CATEGORIES);
  const mine = (prefs.nearby ?? []).filter((c) => all.includes(c));
  const ordered = [...mine, ...all.filter((c) => !mine.includes(c))];
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
      <AroundYou tripId={tripId} anchorKind={anchor.kind} anchorLabel={anchor.label} ordered={ordered} initialCategory={cat} />
    </div>
  );
}
