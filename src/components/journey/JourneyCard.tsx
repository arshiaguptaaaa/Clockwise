import { MODE_ICON, MODE_LABEL, timeLabel } from "@/lib/traveller/journey";

type J = { mode: string; carrier: string | null; originName: string | null; destinationName: string | null; departLocal: string | null; arriveLocal: string | null; arrivalPlaceName?: string | null };

const day = (l: string | null) => (l ? new Date(`${l.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }) : "");
const code = (n: string | null) => (n ? n.split(",")[0].trim() : "—");

// The visual journey card: real transport icon, from → to, times. Never a file icon.
export function JourneyCard({ j, badge }: { j: J; badge?: string }) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-4" data-journey-card>
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        <span className="text-base">{MODE_ICON[j.mode] ?? "→"}</span> {MODE_LABEL[j.mode] ?? "Journey"}
        {badge && <span className="ml-auto rounded-full bg-success-tint px-2.5 py-0.5 text-success">{badge}</span>}
      </div>
      <div className="mt-3 flex items-center gap-3 font-display text-2xl leading-tight">
        <span>{code(j.originName)}</span>
        <span className="h-px flex-1 bg-border" />
        <span>{code(j.destinationName)}</span>
      </div>
      <div className="mt-1 flex justify-between text-sm text-foreground">
        <span>{timeLabel(j.departLocal)}</span>
        <span>{timeLabel(j.arriveLocal)}</span>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        {[j.carrier, day(j.departLocal || j.arriveLocal), j.arrivalPlaceName ? `arrives ${j.arrivalPlaceName}` : null].filter(Boolean).join(" · ")}
      </p>
    </div>
  );
}
