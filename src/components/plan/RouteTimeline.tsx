import { PlaneTakeoff, PlaneLanding, MapPin, ArrowDown } from "lucide-react";
import { formatDateRange, hasTimeOfDay, formatTimeOfDay } from "@/lib/format";
import { matchStop } from "@/lib/trip-route";

type Stop = {
  id: string;
  name: string;
  displayName: string | null;
  city: string | null;
  country: string | null;
  order: number;
  startDate: Date | null;
  endDate: Date | null;
};

type TransportPlanLike = { destination: string; status: string };

function dateLine(stop: Stop, endpoint: "depart" | "return" | null): string {
  if (!stop.startDate) return "Dates not decided yet";
  if (endpoint) return `${formatDateRange(stop.startDate, stop.startDate, "short")} · ${endpoint === "depart" ? "Depart" : "Return"}`;
  const range = formatDateRange(stop.startDate, stop.endDate ?? stop.startDate, "short");
  return hasTimeOfDay(stop.startDate) ? `${range} · ${formatTimeOfDay(stop.startDate)}` : range;
}

// One component for every place the route is shown as a list (Plan,
// Itinerary) — they cannot drift apart because there is only this. It is
// rendered purely from the saved Destination rows (plus any real
// TransportPlan for a leg). Anything unknown stays visibly unknown: no
// invented dates, hotels or transport.
export function RouteTimeline({
  stops,
  transportPlans = [],
}: {
  stops: Stop[];
  transportPlans?: TransportPlanLike[];
}) {
  const ordered = [...stops].sort((a, b) => a.order - b.order);
  if (ordered.length === 0) {
    return <p className="pt-8 text-center text-sm text-muted-foreground">No destinations added yet.</p>;
  }

  // A round-trip's start/end (the same place first and last, e.g. the demo
  // trip's Delhi) reads as depart/return rather than as a stay.
  const first = ordered[0];
  const last = ordered[ordered.length - 1];
  const roundTrip = ordered.length > 1 && first.name === last.name;

  return (
    <ol className="relative border-l border-border pl-5">
      {ordered.map((stop, i) => {
        const endpoint = roundTrip && i === 0 ? "depart" : roundTrip && i === ordered.length - 1 ? "return" : null;
        const prev = i > 0 ? ordered[i - 1] : null;
        const plan = prev
          ? transportPlans.find((p) => matchStop([{ name: stop.name, displayName: stop.displayName, city: stop.city }], p.destination))
          : undefined;

        return (
          <li key={stop.id} className="mb-5 last:mb-0">
            {prev && (
              <div className="-mt-1 mb-4 flex items-center gap-1.5 text-xs text-muted-foreground">
                <ArrowDown className="size-3" />
                <span className="font-medium uppercase tracking-wide">
                  Travel to {stop.city ?? stop.name}
                </span>
                <span>· {plan ? `Ride ${plan.status.toLowerCase().replace("_", " ")}` : "Transport not decided"}</span>
              </div>
            )}
            <span className="absolute -left-[7px] flex size-3.5 items-center justify-center rounded-full border-2 border-surface bg-accent" />
            <div className="flex items-center gap-1.5 text-sm font-medium text-foreground">
              {endpoint === "depart" ? (
                <PlaneTakeoff className="size-3.5 text-muted-foreground" />
              ) : endpoint === "return" ? (
                <PlaneLanding className="size-3.5 text-muted-foreground" />
              ) : (
                <MapPin className="size-3.5 text-muted-foreground" />
              )}
              <span>
                {stop.name}
                {stop.country && stop.country !== "India" && (
                  <span className="font-normal text-muted-foreground">, {stop.country}</span>
                )}
              </span>
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">{dateLine(stop, endpoint)}</p>
            {!endpoint && !stop.startDate && (
              <p className="text-xs text-muted-foreground">Nothing planned yet</p>
            )}
          </li>
        );
      })}
    </ol>
  );
}
