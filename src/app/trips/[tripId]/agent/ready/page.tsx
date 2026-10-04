import { getCurrentUserId } from "@/lib/session";
import { getTripById } from "@/lib/trip";
import { formatDateRange } from "@/lib/format";
import { buildReady } from "@/lib/traveller/ready";
import { ReadyList } from "@/components/journey/ReadyList";
import { BengaluruArt } from "@/components/art/BengaluruArt";

export const dynamic = "force-dynamic";

export default async function ReadyPage({ params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params;
  const userId = await getCurrentUserId();
  if (!userId) return null;
  const [trip, r] = await Promise.all([getTripById(tripId), buildReady(tripId, userId)]);
  const place = trip.destinations[0]?.city ?? trip.destinations[0]?.name ?? trip.name;
  const dates = trip.coreStartDate && trip.coreEndDate ? formatDateRange(trip.coreStartDate, trip.coreEndDate, "short").toUpperCase() : null;
  const allSorted = r.total > 0 && r.sorted === r.total;
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-12 pt-6">
      <header>
        <p className="eyebrow">Before you go</p>
        <h1 className="t-display mt-2 text-[clamp(38px,12vw,52px)] break-words">{place}</h1>
        {dates && <p className="mt-2 text-[12px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">{dates}</p>}
        {r.weather && (
          <div className="mt-5 flex items-end gap-3" data-weather>
            <span className="t-number text-[64px]">{r.weather.maxC}°</span>
            <p className="pb-2 text-[13px] leading-snug text-muted-foreground">
              Lows of {r.weather.minC}°C{r.weather.rainPct >= 30 ? `, rain chance up to ${r.weather.rainPct}%` : ""}.
              <span className="block text-[11px]">Forecast for your dates (Open-Meteo)</span>
            </p>
          </div>
        )}
        {!r.weather && r.weatherNote && <p className="mt-4 text-[13px] text-muted-foreground">{r.weatherNote}</p>}
      </header>
      {allSorted && (
        <section className="section flex items-center gap-4" data-ready-moment>
          <BengaluruArt scene="ready" className="tile-in w-28 shrink-0 rotate-2 shadow-[0_12px_26px_-16px_rgba(20,24,26,0.55)]" />
          <p className="font-display text-[22px] leading-snug tracking-[-0.01em]">You&apos;re ready to go.</p>
        </section>
      )}
      <ReadyList tripId={tripId} items={r.items} />
      <p className="mt-6 text-[11.5px] text-muted-foreground">Only you see this. {r.sorted} of {r.total} sorted.</p>
    </div>
  );
}
