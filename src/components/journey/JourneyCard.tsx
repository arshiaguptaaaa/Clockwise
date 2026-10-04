import { MODE_ICON, MODE_LABEL, timeLabel } from "@/lib/traveller/journey";

type J = { mode: string; carrier: string | null; originName: string | null; destinationName: string | null; departLocal: string | null; arriveLocal: string | null; arrivalPlaceName?: string | null };

const day = (l: string | null) => (l ? new Date(`${l.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }) : "");
const code = (n: string | null) => (n ? n.split(",")[0].trim() : "—");

// The journey as a travel-document moment: real transport icon, from → to, times. Never a file icon.
export function JourneyCard({ j, badge }: { j: J; badge?: string }) {
  return (
    <div data-journey-card>
      <div className="flex items-center gap-2 eyebrow">
        <span className="text-base normal-case tracking-normal">{MODE_ICON[j.mode] ?? "→"}</span> {MODE_LABEL[j.mode] ?? "Journey"}
        {badge && <span className="ml-auto text-success">{badge}</span>}
      </div>
      <div className="mt-4 flex items-center gap-3 font-display text-[32px] leading-none tracking-[-0.02em]">
        <span>{code(j.originName)}</span>
        <span className="h-px flex-1 bg-foreground/25" />
        <span>{code(j.destinationName)}</span>
      </div>
      <div className="mt-2 flex justify-between text-[15px] font-semibold">
        <span>{timeLabel(j.departLocal)}</span>
        <span>{timeLabel(j.arriveLocal)}</span>
      </div>
      <p className="mt-3 text-[12.5px] text-muted-foreground">
        {[j.carrier, day(j.departLocal || j.arriveLocal), j.arrivalPlaceName ? `arrives ${j.arrivalPlaceName}` : null].filter(Boolean).join(" · ")}
      </p>
    </div>
  );
}
