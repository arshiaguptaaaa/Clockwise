import { MODE_ICON, timeLabel } from "@/lib/traveller/journey";
import type { RendezvousView } from "@/lib/rendezvous";

const hhmm = (local: string) => timeLabel(local);
const day = (l: string) => new Date(`${l.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

// ONE TRIP, MANY CLOCKS: each person's own arrival, and what it means for the stay
// and for shared commitments. Group-safe: arrival facts only.
export function RendezvousSection({ view }: { view: RendezvousView }) {
  if (view.clocks.length === 0 && view.commitments.length === 0) return null;
  return (
    <section className="mt-5 rounded-2xl border border-border bg-surface p-4" data-rendezvous>
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{view.clocks.length ? "Individual clocks · Arrivals" : "Shared commitments"}</p>
      <ul className="mt-3 space-y-3">
        {view.clocks.map((c) => (
          <li key={c.userId} className="flex items-start gap-3" data-clock={c.name}>
            <span className="mt-0.5 text-lg">{MODE_ICON[c.mode] ?? "→"}</span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">
                {c.name} <span className="font-normal text-muted-foreground">arrives {c.arriveLocal ? `${day(c.arriveLocal)} · ${hhmm(c.arriveLocal)}` : "(time unknown)"}{c.arrivalPlace ? ` · ${c.arrivalPlace}` : ""}</span>
              </p>
              {c.status === "KNOWN" ? (
                <p className="text-xs text-muted-foreground">
                  {c.routeKm} km · ~{c.routeMinutes} min to {view.stayName} ({c.routeProvider === "delhivery" ? "Delhivery, traffic-aware estimate" : c.routeProvider === "geoapify" ? "Geoapify driving route" : "provider route"}) → at the stay by about <span className="font-semibold text-foreground">{hhmm(c.hotelBy!)}</span>
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  {c.status === "NO_STAY" ? "Waiting for the group's confirmed stay." : c.status === "NO_ARRIVAL_POINT" ? "I couldn't pin down where they arrive." : c.status === "NO_ARRIVAL_TIME" ? "No arrival time." : "No provider route yet."}
                </p>
              )}
            </div>
          </li>
        ))}
      </ul>
      {view.noJourney.length > 0 && <p className="mt-2 text-xs text-muted-foreground">No journey yet: {view.noJourney.join(", ")}.</p>}

      {view.meetAt && (
        <p className="mt-3 rounded-xl bg-pop-yellow-tint px-3 py-2 text-sm">
          ◷ {view.meetComplete ? "Everyone can be at the stay by" : "Those with journeys can be at the stay by"} <span className="font-semibold">{day(view.meetAt)} · {hhmm(view.meetAt)}</span>.
          {!view.meetComplete && " (Not everyone has added a journey or a measurable route yet.)"}
        </p>
      )}

      {view.commitments.length > 0 && (
        <ul className="mt-3 space-y-1.5 text-xs">
          {view.commitments.map((c) => (
            <li key={c.id} className={c.late.length ? "text-danger" : "text-muted-foreground"}>
              {c.name} · {day(c.target)} {hhmm(c.target)} —{" "}
              {c.late.length ? `${c.late.map((l) => `${l.name} can't be at the stay before ${hhmm(l.hotelBy)}`).join("; ")}` : c.allAtHotelBy ? "everyone can be at the stay in time" : "can't tell yet — someone's clock is unknown"}
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-[10px] text-muted-foreground">Arrival → stay uses provider-measured driving routes (Delhivery in India, Geoapify elsewhere) plus a 15-minute allowance for bags and exits. Estimates, not live traffic. No ticket details are shown.</p>
    </section>
  );
}
