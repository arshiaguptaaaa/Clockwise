import { getCurrentUserId } from "@/lib/session";
import { anchorsFor } from "@/lib/travel/around";
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
  // YOUR KIND OF PLACES first (from the vibe check: Nearby picks, then travel-energy matches), then the rest.
  const all = Object.keys(AROUND_CATEGORIES);
  const fromEnergy: Record<string, string> = { CAFES: "cafe", SLOW_MORNINGS: "cafe", FOOD: "restaurant", SHOPPING: "shopping", PRETTY: "attraction", CLASSICS: "attraction", HIDDEN_GEMS: "attraction", NATURE: "park", NIGHTLIFE: "nightlife" };
  const mine = [...(prefs.nearby ?? []), ...(prefs.energy ?? []).map((e) => fromEnergy[e]).filter(Boolean)].filter((c, i, arr) => all.includes(c) && arr.indexOf(c) === i);
  const ordered = [...mine, ...all.filter((c) => !mine.includes(c))];
  const status = {
    stay: { available: Boolean(a.stay), label: a.stay?.label },
    arrival: { available: Boolean(a.arrival), label: a.arrival?.label },
    destination: { available: Boolean(a.destination), label: a.destination?.label },
  };
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
      <AroundYou tripId={tripId} ordered={ordered} initialCategory={cat} anchors={status} wantsMe={anchor === "me"} />
    </div>
  );
}
