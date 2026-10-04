type Stay = { status: string; placeName: string | null; formattedAddress: string | null; checkIn: Date | null; checkOut: Date | null; provider: string };

const fmt = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

// The stay as the Plan sees it. Only a CONFIRMED stay is "the plan"; an approved one is shown
// honestly as "approved, not booked yet".
export function StaySection({ stay }: { stay: Stay }) {
  const confirmed = stay.status === "CONFIRMED";
  return (
    <section className="section" data-plan-stay>
      <p className="eyebrow">Group · Stay</p>
      <h2 className="headline headline-lg mt-2">{stay.placeName}</h2>
      {stay.formattedAddress && <p className="lede mt-2">{stay.formattedAddress}</p>}
      <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13.5px]">
        {stay.checkIn && stay.checkOut && (
          <span>
            {fmt(stay.checkIn)} – {fmt(stay.checkOut)}
          </span>
        )}
        <span className={`font-semibold ${confirmed ? "text-success" : "text-foreground"}`}>{confirmed ? "Booked ✓" : "Approved · not booked yet"}</span>
      </p>
    </section>
  );
}
