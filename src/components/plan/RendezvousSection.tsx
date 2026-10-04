import { MODE_ICON, timeLabel } from "@/lib/traveller/journey";
import type { RendezvousView } from "@/lib/rendezvous";
import { BengaluruArt } from "@/components/art/BengaluruArt";

const hhmm = (local: string) => timeLabel(local);
const day = (l: string) => new Date(`${l.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

const basis = (p: string | null) => (p === "delhivery" ? "Delhivery · traffic-aware estimate" : p === "geoapify" ? "Geoapify · driving route" : "Provider route");

// ONE TRIP, MANY CLOCKS: each person's own arrival, what it means for the stay, and what that means
// for the plan everyone agreed. Group-safe: arrival facts only, no ticket details.
export type PendingMove = { to: string; proposalId: string; stage: string };

// The detail behind the timeline: each person's route and the provider that measured it.
export function RendezvousSection({ view }: { view: RendezvousView }) {
  if (view.clocks.length === 0) return null;
  return (
    <>
      {view.clocks.length > 0 && (
        <details className="section group" data-rendezvous>
          <summary className="flex cursor-pointer list-none items-start justify-between gap-4 [&::-webkit-details-marker]:hidden">
            <div>
              <p className="eyebrow">Individual clocks · Arrivals</p>
              <h2 className="headline headline-md mt-2 max-w-[15rem]">Everyone lands on their own time.</h2>
            </div>
            {view.clocks.length > 1 && <BengaluruArt scene="converge" className="w-24 shrink-0 -rotate-2 shadow-[0_10px_24px_-14px_rgba(20,24,26,0.5)]" />}
          </summary>

          <ol className="row-rule mt-5">
            {view.clocks.map((c) => (
              <li key={c.userId} className="grid grid-cols-[4.75rem_1fr] gap-x-3 py-3.5" data-clock={c.name}>
                <p className="font-display text-[19px] leading-[1.15] tracking-[-0.01em]">{c.arriveLocal ? hhmm(c.arriveLocal) : "—"}</p>
                <div className="min-w-0">
                  <p className="text-[14px] leading-snug">
                    <span className="font-semibold">{c.name}</span> <span className="text-muted-foreground">{MODE_ICON[c.mode] ?? "→"} arrives {c.arriveLocal ? day(c.arriveLocal) : ""}{c.arrivalPlace ? ` · ${c.arrivalPlace}` : ""}</span>
                  </p>
                  {c.status === "KNOWN" ? (
                    <p className="mt-1 text-[12.5px] leading-snug text-muted-foreground">
                      {c.routeKm} km · ~{c.routeMinutes} min to {view.stayName}. At the stay by about <span className="font-semibold text-foreground">{hhmm(c.hotelBy!)}</span>
                      <span className="mt-0.5 block text-[10.5px] uppercase tracking-[0.12em]">{basis(c.routeProvider)}</span>
                    </p>
                  ) : (
                    <p className="mt-1 text-[12.5px] text-muted-foreground">
                      {c.status === "NO_STAY" ? "Waiting for the group's confirmed stay." : c.status === "NO_ARRIVAL_POINT" ? "I couldn't pin down where they arrive." : c.status === "NO_ARRIVAL_TIME" ? "No arrival time." : "No provider route yet."}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ol>
          {view.noJourney.length > 0 && <p className="mt-1 text-xs text-muted-foreground">No journey yet: {view.noJourney.join(", ")}.</p>}

          {view.meetAt && (
            <p className="mt-4 font-display text-[20px] leading-snug tracking-[-0.01em]" data-meet>
              ◷ {view.meetComplete ? "Everyone can be at the stay by" : "Those with journeys can be at the stay by"} {day(view.meetAt)} · {hhmm(view.meetAt)}.
              {!view.meetComplete && <span className="mt-1 block font-sans text-xs tracking-normal text-muted-foreground">Not everyone has added a journey or a measurable route yet.</span>}
            </p>
          )}
          <p className="mt-4 text-[10.5px] leading-relaxed text-muted-foreground">Arrival → stay is measured by a routing provider (Delhivery in India, Geoapify elsewhere), plus 15 minutes for bags and exits. These are estimates, not live traffic. No ticket details are shown.</p>
        </details>
      )}

    </>
  );
}
