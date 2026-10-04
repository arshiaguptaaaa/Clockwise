import { providerLabel } from "@/lib/travel/provider-label";
import { Plane, TrainFront, Bus, Car, BedDouble, CalendarClock, Utensils } from "lucide-react";
import { timeLabel } from "@/lib/traveller/journey";
import { HUMAN } from "@/lib/copy";
import { ARRIVAL_BUFFER_MIN, type RendezvousView } from "@/lib/rendezvous";
import type { PendingMove } from "./RendezvousSection";

type Kind = "arrive" | "reach" | "together" | "commitment";
type Item = {
  key: string;
  local: string;
  kind: Kind;
  icon?: React.ReactNode;
  title: React.ReactNode;
  // the travel leg that leads INTO this event ("↓ 39 min to the stay")
  leg?: string;
  note?: React.ReactNode;
  commitmentName?: string;
  risk?: boolean;
  pending?: PendingMove;
};

const modeIcon = (mode: string) => {
  const c = "size-[17px]";
  if (mode === "TRAIN") return <TrainFront className={c} strokeWidth={1.6} />;
  if (mode === "BUS") return <Bus className={c} strokeWidth={1.6} />;
  if (mode === "DRIVE") return <Car className={c} strokeWidth={1.6} />;
  return <Plane className={c} strokeWidth={1.6} />;
};
const foodish = /dinner|lunch|breakfast|brunch|cafe|café|meal|supper/i;
const basisName = (p: string | null, fell?: string | null) => providerLabel(p, fell);

const dayHead = (local: string) => {
  const d = new Date(`${local.slice(0, 10)}T00:00:00Z`);
  const wd = d.toLocaleDateString("en-GB", { weekday: "long", timeZone: "UTC" });
  const dm = d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
  return `${wd} · ${dm}`;
};

// THE TRIP AS A STORY: who lands when, how long each takes to reach the stay, and what that does to the plan.
// Events are connected by their travel legs, so cause and effect read top to bottom. A pending move shows beside
// the original time (dashed, "not in the Plan yet"); when the Plan moves, the row replays its entrance.
export function DayTimeline({ view, pending = {}, organiserName = "the organiser" }: { view: RendezvousView; pending?: Record<string, PendingMove>; organiserName?: string }) {
  const items: Item[] = [];

  for (const c of view.clocks) {
    if (!c.arriveLocal) continue;
    const first = c.name.split(" ")[0];
    items.push({
      key: `arr-${c.userId}`,
      local: c.arriveLocal,
      kind: "arrive",
      icon: modeIcon(c.mode),
      title: (
        <>
          <span className="font-semibold">{first}</span> lands{c.arrivalPlace ? <span className="text-muted-foreground"> · {c.arrivalPlace.replace(/ International Airport$/, "")}</span> : null}
          {c.scheduledArrive && <span className="ml-1.5 rounded-full bg-danger-tint px-2 py-0.5 text-[10px] font-semibold tracking-[0.12em] text-danger" data-delayed>DELAYED · was {timeLabel(c.scheduledArrive)}</span>}
        </>
      ),
    });
    if (c.status === "KNOWN" && c.hotelBy) {
      items.push({
        key: `reach-${c.userId}`,
        local: c.hotelBy,
        kind: "reach",
        title: (
          <>
            {first} is realistically {view.anchorKind === "stay" || !view.anchorKind ? "at the stay" : `at ${view.stayName}`}
          </>
        ),
        leg: `${ARRIVAL_BUFFER_MIN} min bags & exits + ${c.routeMinutes} min to ${view.anchorKind === "stay" || !view.anchorKind ? "the stay" : view.stayName} · ${basisName(c.routeProvider, c.routeFellBackFrom)}`,
      });
    }
  }

  if (view.meetAt) {
    items.push({
      key: "together",
      local: view.meetAt,
      kind: "together",
      icon: <BedDouble className="size-[17px]" strokeWidth={1.6} />,
      title: <span className="font-semibold">{view.meetComplete ? "Everyone at the stay" : "Everyone with a journey, at the stay"}</span>,
      note: view.stayName ?? undefined,
    });
  }

  for (const c of view.commitments) {
    const late = c.late.length > 0;
    items.push({
      key: `c-${c.id}-${c.target}`,
      local: c.target,
      kind: "commitment",
      commitmentName: c.name,
      risk: late,
      pending: pending[c.id],
      icon: foodish.test(c.name) ? <Utensils className="size-[17px]" strokeWidth={1.6} /> : <CalendarClock className="size-[17px]" strokeWidth={1.6} />,
      title: <span className="font-semibold">{c.name.toUpperCase()} {!late && c.allAtHotelBy ? <span className="text-accent-strong">✦</span> : null}</span>,
      note: late ? (
        <span className="text-danger">
          <span className="mr-1.5 rounded-full bg-danger-tint px-2 py-0.5 text-[10px] font-semibold tracking-[0.14em]">AT RISK</span>
          {c.late.map((l) => `${l.name.split(" ")[0]} can't be at the stay before ${timeLabel(l.hotelBy)}`).join("; ")}
        </span>
      ) : c.allAtHotelBy ? (
        "Everyone can make it ✓"
      ) : (
        "Someone's clock is still unknown"
      ),
    });
  }

  if (items.length === 0) return null;
  const order: Record<Kind, number> = { arrive: 0, reach: 1, together: 2, commitment: 3 };
  items.sort((a, b) => (a.local < b.local ? -1 : a.local > b.local ? 1 : order[a.kind] - order[b.kind]));
  const days = [...new Set(items.map((i) => i.local.slice(0, 10)))];
  const allClear = view.commitments.length > 0 && view.commitments.every((c) => c.allAtHotelBy) && view.clocks.every((c) => c.status === "KNOWN");

  return (
    <section className="section" data-day-timeline data-shared-plan>
      <p className="eyebrow">Confirmed plan</p>
      {days.map((day) => (
        <div key={day} className="mt-6">
          <h2 className="t-display text-[26px]">{dayHead(`${day}T00:00`)}</h2>
          <ol className="relative mt-4">
            {/* the spine that connects the day */}
            <span aria-hidden className="absolute bottom-3 left-[6.6rem] top-3 w-px bg-border" />
            {items
              .filter((i) => i.local.startsWith(day))
              .map((i) => (
                <li key={i.key} className={`relative grid grid-cols-[6rem_1fr] gap-x-[1.1rem] ${i.kind === "reach" ? "py-1.5" : i.kind === "commitment" ? "tile-in py-5" : "py-3"}`} {...(i.commitmentName ? { "data-commitment": i.commitmentName } : {})}>
                  <p className={`t-number whitespace-nowrap text-right ${i.kind === "commitment" ? "text-[24px]" : i.kind === "reach" ? "text-[14px] text-muted-foreground" : "text-[19px]"} ${i.risk ? "text-danger" : ""}`}>{timeLabel(i.local)}</p>
                  <span aria-hidden className={`absolute left-[6.6rem] top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full ${i.kind === "commitment" ? `size-3 ${i.risk ? "bg-danger" : "bg-accent"}` : i.kind === "reach" ? "size-1.5 bg-border" : "size-2 bg-foreground"}`} />
                  <div className="min-w-0 pl-1">
                    {i.leg && (
                      <p className="mb-0.5 text-[11.5px] text-muted-foreground" data-leg>
                        ↓ {i.leg}
                      </p>
                    )}
                    <p className={`flex items-center gap-2 leading-snug ${i.kind === "commitment" ? "font-display text-[22px] tracking-[-0.01em]" : i.kind === "reach" ? "text-[13px] text-muted-foreground" : "text-[15px]"}`}>
                      {i.kind !== "reach" && i.icon && <span className="shrink-0 text-muted-foreground">{i.icon}</span>}
                      <span>{i.title}</span>
                    </p>
                    {i.note && <p className="mt-0.5 text-[12.5px] leading-snug text-muted-foreground">{i.note}</p>}
                    {i.pending && (
                      <p className="mt-2 text-[13px] leading-snug" data-pending-move>
                        <span className="rounded-full border border-dashed border-foreground/40 px-2 py-0.5 text-[10px] font-semibold tracking-[0.14em]">{i.pending.stage === "AGREED" ? "AGREED" : "PROPOSED"}</span>{" "}
                        <span className="t-number text-[20px]">{timeLabel(i.pending.to)} ?</span>
                        <span className="mt-1 block text-[12px] text-muted-foreground">
                          {i.pending.stage === "AGREED" ? `Everyone accepted · the Plan changes when ${organiserName.split(" ")[0]} confirms.` : "Not in the Plan yet · waiting for the group."}
                        </span>
                      </p>
                    )}
                  </div>
                </li>
              ))}
          </ol>
        </div>
      ))}
      {allClear && <p className="t-voice mt-4 text-[18px]" data-clocks-agree>{HUMAN.clocksAgree}</p>}
    </section>
  );
}
