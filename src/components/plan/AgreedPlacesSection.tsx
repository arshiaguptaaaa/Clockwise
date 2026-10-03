import { MapPin } from "lucide-react";

type Agreed = { id: string; placeName: string | null; formattedAddress: string | null; provider: string };

// Places the GROUP agreed on. Agreement is not a booking and not a scheduled activity.
export function AgreedPlacesSection({ places }: { places: Agreed[] }) {
  if (places.length === 0) return null;
  return (
    <section className="mt-5 rounded-2xl border border-border bg-surface p-4" data-plan-agreed-places>
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        <MapPin className="size-3.5" /> Group · Agreed places
        <span className="ml-auto rounded-full bg-pop-yellow-tint px-2.5 py-0.5 text-foreground">Agreed · not booked</span>
      </div>
      <ul className="mt-2 space-y-2">
        {places.map((p) => (
          <li key={p.id} data-agreed-place={p.placeName}>
            <p className="font-display text-xl leading-tight text-foreground">{p.placeName}</p>
            {p.formattedAddress && <p className="text-xs text-muted-foreground">{p.formattedAddress}</p>}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[11px] text-muted-foreground">The group agreed on {places.length === 1 ? "this place" : "these places"}. Nothing is reserved or scheduled yet.</p>
    </section>
  );
}
