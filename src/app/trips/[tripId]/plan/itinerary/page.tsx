import { getTripById } from "@/lib/trip";
import { prisma } from "@/lib/prisma";
import { RouteTimeline } from "@/components/plan/RouteTimeline";

// Derived, not maintained: this renders the same saved Destination rows the
// Plan tab and the map read, via the same component. There is no separate
// itinerary store to fall out of sync — adding, removing or re-ordering a
// stop anywhere changes this page automatically.
export default async function PlanItineraryPage({
  params,
}: {
  params: Promise<{ tripId: string }>;
}) {
  const { tripId } = await params;
  const [trip, transportPlans] = await Promise.all([
    getTripById(tripId),
    prisma.transportPlan.findMany({ where: { tripId }, select: { destination: true, status: true } }),
  ]);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Route</p>
      <h1 className="mt-1 font-serif text-xl font-medium text-foreground">
        {[...trip.destinations]
          .sort((a, b) => a.order - b.order)
          .map((d) => d.city ?? d.name)
          .join(" → ") || trip.name}
      </h1>
      <div className="mt-6">
        <RouteTimeline stops={trip.destinations} transportPlans={transportPlans} />
      </div>
    </div>
  );
}
