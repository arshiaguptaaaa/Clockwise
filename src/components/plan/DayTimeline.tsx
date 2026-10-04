import { Plane, TrainFront, Bus, Car, BedDouble, CalendarClock, Utensils, ArrowRight } from "lucide-react";
import { timeLabel } from "@/lib/traveller/journey";
import { HUMAN } from "@/lib/copy";
import type { RendezvousView } from "@/lib/rendezvous";
import type { PendingMove } from "./RendezvousSection";

type Item = {
  key: string;
  local: string;
  kind: "arrive" | "stay" | "commitment";
  icon: React.ReactNode;
  title: React.ReactNode;
  note?: React.ReactNode;
  commitmentName?: string;
  risk?: boolean;
  pending?: PendingMove;
};

const modeIcon = (mode: string) => {
  const c = "size-[18px]";
  if (mode === "TRAIN") return <TrainFront className={c} strokeWidth={1.6} />;
  if (mode === "BUS") return <Bus className={c} strokeWidth={1.6} />;
  if (mode === "DRIVE") return <Car className={c} strokeWidth={1.6} />;
  return <Plane className={c} strokeWidth={1.6} />;
};
const foodish = /dinner|lunch|breakfast|brunch|cafe|café|meal|supper/i;

const dayHead = (local: string) => {
  const d = new Date(`${local.slice(0, 10)}T00:00:00Z`);
  const wd = d.toLocaleDateString("en-GB", { weekday: "long", timeZone: "UTC" });
  const dm = d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
  return `${wd} · ${dm}`;
};

// THE TRIP'S MEMORY, in order: who lands when, when everyone is together, and what the
// group agreed. A change doesn't produce a new panel: the row itself shows the proposed
// time (struck-through original, dashed "not in the Plan yet"), and when the Plan moves the
// row replays its entrance with the new time.
export function DayTimeline({ view, pending = {}, organiserName = "the organiser" }: { view: RendezvousView; pending?: Record<string, PendingMove>; organiserName?: string }) {
  const items: Item[] = [];

  for (const c of view.clocks) {
    if (!c.arriveLocal) continue;
    items.push({
      key: `arr-${c.userId}`,
      local: c.arriveLocal,
      kind: "arrive",
      icon: modeIcon(c.mode),
      title: (
        <>
          <span className="font-semibold">{c.name.split(" ")[0]}</span> lands{c.arrivalPlace ? <span className="text-muted-foreground"> · {c.arrivalPlace}</span> : null}
        </>
      ),
      note: c.status === "KNOWN" ? <>~{c.routeMinutes} min to {view.stayName}, at the stay by about <span className="font-semibold text-foreground">{timeLabel(c.hotelBy!)}</span></> : undefined,
    });
  }

  if (view.meetAt) {
    items.push({
      key: "together",
      local: view.meetAt,
      kind: "stay",
      icon: <BedDouble className="size-[18px]" strokeWidth={1.6} />,
      title: <span className="font-semibold">{view.meetComplete ? "Everyone at the stay" : "Those with journeys at the stay"}</span>,
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
      icon: foodish.test(c.name) ? <Utensils className="size-[18px]" strokeWidth={1.6} /> : <CalendarClock className="size-[18px]" strokeWidth={1.6} />,
      title: <span className="font-semibold">{c.name}</span>,
      note: late ? (
        <span className="font-semibold text-danger">
          <span className="mr-1.5 rounded-full bg-danger-tint px-2 py-0.5 text-[10px] tracking-[0.14em]">AT RISK</span>
          {c.late.map((l) => `${l.name} can't be at the stay before ${timeLabel(l.hotelBy)}`).join("; ")}
        </span>
      ) : c.allAtHotelBy ? (
        "Everyone can be at the stay in time ✓"
      ) : (
        "Can't tell yet: someone's clock is unknown"
      ),
    });
  }

  if (items.length === 0) return null;
  items.sort((a, b) => (a.local < b.local ? -1 : a.local > b.local ? 1 : a.kind === "arrive" ? -1 : 1));
  const days = [...new Set(items.map((i) => i.local.slice(0, 10)))];
  const allClear = view.commitments.length > 0 && view.commitments.every((c) => c.allAtHotelBy) && view.clocks.every((c) => c.status === "KNOWN");

  return (
    <section className="section" data-day-timeline data-shared-plan>
      <p className="eyebrow">The plan so far</p>
      {days.map((day) => (
        <div key={day} className="mt-5">
          <p className="font-display text-[15px] uppercase tracking-[0.08em] text-muted-foreground">{dayHead(`${day}T00:00`)}</p>
          <ol className="mt-1 border-l border-border">
            {items
              .filter((i) => i.local.startsWith(day))
              .map((i) => (
                <li key={i.key} className={`relative py-3.5 pl-7 ${i.kind === "commitment" ? "tile-in" : ""}`} {...(i.commitmentName ? { "data-commitment": i.commitmentName } : {})}>
                  <span className={`absolute -left-[9px] top-[1.15rem] flex size-[18px] items-center justify-center rounded-full bg-page ${i.risk ? "text-danger" : "text-foreground"}`}>{i.icon}</span>
                  <div className="grid grid-cols-[4.4rem_1fr] gap-x-3">
                    <p className={`font-display text-[20px] leading-[1.1] tracking-[-0.01em] ${i.risk ? "text-danger" : ""}`}>{timeLabel(i.local)}</p>
                    <div className="min-w-0">
                      <p className="text-[15px] leading-snug">{i.title}</p>
                      {i.note && <p className="mt-0.5 text-[12.5px] leading-snug text-muted-foreground">{i.note}</p>}
                      {i.pending && (
                        <p className="mt-1.5 flex flex-wrap items-center gap-x-2 text-[12.5px] leading-snug" data-pending-move>
                          <span className="rounded-full border border-dashed border-foreground/40 px-2 py-0.5 text-[10px] tracking-[0.14em]">{i.pending.stage === "AGREED" ? "AGREED" : "PROPOSED"}</span>
                          <ArrowRight className="size-3 text-muted-foreground" />
                          <span className="font-display text-[16px]">{timeLabel(i.pending.to)} ?</span>
                          <span className="text-muted-foreground">
                            {i.pending.stage === "AGREED" ? `Everyone accepted · the Plan changes when ${organiserName.split(" ")[0]} confirms.` : "Not in the Plan yet · waiting for the group."}
                          </span>
                        </p>
                      )}
                    </div>
                  </div>
                </li>
              ))}
          </ol>
        </div>
      ))}
      {allClear && <p className="mt-3 font-display text-[18px] italic text-muted-foreground" data-clocks-agree>{HUMAN.clocksAgree}</p>}
    </section>
  );
}
