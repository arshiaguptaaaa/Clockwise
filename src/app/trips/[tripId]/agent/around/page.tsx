import { getCurrentUserId } from "@/lib/session";
import { anchorsFor, orderCategories } from "@/lib/travel/around";
import { AROUND_CATEGORIES } from "@/lib/travel/around-categories";
import { getPrefs } from "@/lib/traveller/vibe";
import { AroundYou } from "@/components/around/AroundYou";

export const dynamic = "force-dynamic";

export default async function AroundPage({ params, searchParams }: { params: Promise<{ tripId: string }>; searchParams: Promise<{ cat?: string; anchor?: string }> }) {
  const { tripId } = await params;
  const { cat, anchor } = await searchParams;
  const userId = await getCurrentUserId();
  if (!userId) return null;
  const [a, prefs] = await Promise.all([anchorsFor(tripId, userId), getPrefs(tripId, userId)]);
  // YOUR KIND OF PLACES first (from the vibe check), then the rest.
  const ordered = orderCategories(Object.keys(AROUND_CATEGORIES), prefs).filter((c) => c in AROUND_CATEGORIES);
  const status = {
    stay: { available: Boolean(a.stay), label: a.stay?.label },
    arrival: { available: Boolean(a.arrival), label: a.arrival?.label },
    destination: { available: Boolean(a.destination), label: a.destination?.label },
  };
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
      <AroundYou tripId={tripId} ordered={ordered} initialCategory={cat} anchors={status} wantsMe={anchor === "me"} defaultAnchor={status.stay.available ? "stay" : null} />
    </div>
  );
}
