type Agreed = { id: string; placeName: string | null; formattedAddress: string | null; provider: string };

// Places the GROUP agreed on. Agreement is not a booking and not a scheduled activity.
export function AgreedPlacesSection({ places }: { places: Agreed[] }) {
  if (places.length === 0) return null;
  return (
    <section className="section" data-plan-agreed-places>
      <p className="eyebrow">Group · Agreed places</p>
      <ul className="row-rule mt-3">
        {places.map((p) => (
          <li key={p.id} className="py-3.5" data-agreed-place={p.placeName}>
            <p className="font-display text-[20px] leading-tight tracking-[-0.01em]">{p.placeName}</p>
            {p.formattedAddress && <p className="mt-0.5 text-[12.5px] text-muted-foreground">{p.formattedAddress}</p>}
          </li>
        ))}
      </ul>
      <p className="mt-1 text-[12px] text-muted-foreground">Agreed by the group. Not booked, not scheduled.</p>
    </section>
  );
}
