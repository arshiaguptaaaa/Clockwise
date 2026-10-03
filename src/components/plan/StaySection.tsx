import { Home } from "lucide-react";

type Stay = { status: string; placeName: string | null; formattedAddress: string | null; checkIn: Date | null; checkOut: Date | null; provider: string };

const fmt = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

// The stay as the Plan sees it. Only a CONFIRMED stay is "the plan"; an
// approved one is shown honestly as "approved, not booked yet".
export function StaySection({ stay }: { stay: Stay }) {
  const confirmed = stay.status === "CONFIRMED";
  return (
    <section className="mt-5 rounded-2xl border border-border bg-surface p-4" data-plan-stay>
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        <Home className="size-3.5" /> Group · Stay
        <span className={`ml-auto rounded-full px-2.5 py-0.5 ${confirmed ? "bg-success-tint text-success" : "bg-pop-yellow-tint text-foreground"}`}>{confirmed ? "Booked ✓" : "Approved · not booked yet"}</span>
      </div>
      <p className="mt-2 font-display text-xl leading-tight text-foreground">{stay.placeName}</p>
      {stay.formattedAddress && <p className="text-xs text-muted-foreground">{stay.formattedAddress}</p>}
      {stay.checkIn && stay.checkOut && (
        <p className="mt-1 text-sm text-foreground">
          {fmt(stay.checkIn)} – {fmt(stay.checkOut)}
        </p>
      )}
    </section>
  );
}
