import Image from "next/image";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { getTripById } from "@/lib/trip";
import { DESTINATION_PHOTOS } from "@/lib/photos";
import { curatedPhotoFor } from "@/lib/destination-photos";
import { fetchWikipediaPhoto, type WikipediaPhoto } from "@/lib/travel/wikipedia-photo";
import { formatDateRange } from "@/lib/format";
import { Face } from "@/components/art/CharacterScene";
import { faceIndexForId } from "@/lib/characters";
import { TripMapLoader } from "@/components/map/TripMapLoader";
import { buildDestinationMarkers, buildJourneyLine, destinationsWithoutCoordinates } from "@/components/map/buildTripMarkers";
import { RouteTimeline } from "@/components/plan/RouteTimeline";
import { prisma } from "@/lib/prisma";
import { getTripStay } from "@/lib/stays";
import { StaySection } from "@/components/plan/StaySection";
import { RendezvousSection } from "@/components/plan/RendezvousSection";
import { buildRendezvousView } from "@/lib/rendezvous";

export default async function PlanOverviewPage({
  params,
}: {
  params: Promise<{ tripId: string }>;
}) {
  const { tripId } = await params;
  const trip = await getTripById(tripId);
  const stops = [...trip.destinations].sort((a, b) => a.order - b.order);
  // The seeded demo route starts at Delhi, which its photo grid skips. Real
  // trips show every stop — a real Delhi stop must not vanish.
  const middleStops = trip.isDemo ? stops.filter((s) => s.name !== "Delhi") : stops;
  const [stay, rendezvous] = await Promise.all([getTripStay(tripId), buildRendezvousView(tripId)]);
  const mapMarkers = [
    ...buildDestinationMarkers(stops),
    ...(stay?.status === "CONFIRMED" && stay.latitude != null && stay.longitude != null
      ? [{ id: `stay-${stay.id}`, kind: "hotel" as const, position: { lat: stay.latitude, lng: stay.longitude }, label: stay.placeName ?? "Stay", sublabel: stay.formattedAddress ?? undefined }]
      : []),
  ];
  const journeyLine = buildJourneyLine(stops);
  const transportPlans = await prisma.transportPlan.findMany({
    where: { tripId },
    select: { destination: true, status: true },
  });
  const unmapped = destinationsWithoutCoordinates(stops);

  // Hand-curated Commons photos exist only for the demo trip's fixed
  // route; any other destination falls back to a live Wikipedia lookup
  // (never a fabricated/generic image — see wikipedia-photo.ts). Next.js
  // dedupes/caches this fetch() by default, so it isn't re-hit on every
  // render for the same title.
  const fallbackPhotos = new Map<string, WikipediaPhoto | null>(
    await Promise.all(
      middleStops
        .filter((s) => !DESTINATION_PHOTOS[s.name] && !curatedPhotoFor(s.name))
        .map(async (s) => [s.name, await fetchWikipediaPhoto(s.name)] as const)
    )
  );
  // Only credit photos actually shown for THIS trip's stops, and
  // attribute live Wikipedia lookups separately from the hand-curated
  // Commons set — they're different sources with different attribution
  // shapes (a named photographer credit vs a link back to the article).
  const shownCommonsCredits = middleStops
    .map((s) => {
      const c = curatedPhotoFor(s.name);
      if (c) return `${c.credit.split(" /")[0]} (${c.license})`;
      return DESTINATION_PHOTOS[s.name] ? DESTINATION_PHOTOS[s.name].credit.split(" /")[0] : null;
    })
    .filter((x): x is string => Boolean(x));
  const shownWikipediaStops = middleStops
    .filter((s) => !DESTINATION_PHOTOS[s.name] && !curatedPhotoFor(s.name) && fallbackPhotos.get(s.name))
    .map((s) => ({ id: s.id, name: s.name, photo: fallbackPhotos.get(s.name)! }));

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5">
      <TripMapLoader
        markers={mapMarkers}
        journeyLine={journeyLine}
        heightClassName="h-72"
        emptyStateMessage="No mapped locations yet — add destinations with a place search to see them here."
      />
      {unmapped.length > 0 && mapMarkers.length > 0 && (
        <p className="mt-2 text-[11px] text-muted-foreground">
          Not shown on the map (no stored location yet): {unmapped.map((d) => d.name).join(", ")}.
        </p>
      )}

      {stay && <StaySection stay={stay} />}
      <RendezvousSection view={rendezvous} />

      {middleStops.length > 0 && (
        <>
          <div className="mt-6 grid grid-cols-2 gap-2.5">
            {middleStops.map((stop) => {
              const curated = curatedPhotoFor(stop.name);
              const photo =
                (curated ? { src: curated.src, alt: curated.alt } : null) ??
                DESTINATION_PHOTOS[stop.name] ??
                fallbackPhotos.get(stop.name) ??
                undefined;
              return (
                <div
                  key={stop.id}
                  className="relative aspect-[4/3] overflow-hidden rounded-xl bg-surface-muted"
                >
                  {photo && (
                    <Image
                      src={photo.src}
                      alt={photo.alt}
                      fill
                      className="object-cover"
                      sizes="(max-width: 512px) 50vw, 240px"
                    />
                  )}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/0 to-black/0" />
                  <div className="absolute bottom-2 left-2.5 right-2.5 text-white">
                    <p className="text-sm font-medium">{stop.name}</p>
                    <p className="text-[11px] text-white/85">
                      {stop.startDate && stop.endDate
                        ? formatDateRange(stop.startDate, stop.endDate, "short")
                        : null}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
          {(shownCommonsCredits.length > 0 || shownWikipediaStops.length > 0) && (
            <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">
              {shownCommonsCredits.length > 0 &&
                `Photos: ${shownCommonsCredits.join(", ")} — Wikimedia Commons.`}
              {shownWikipediaStops.length > 0 && (
                <>
                  {" "}
                  Photo{shownWikipediaStops.length > 1 ? "s" : ""} via Wikipedia:{" "}
                  {shownWikipediaStops.map((s, i) => (
                    <span key={s.id}>
                      {i > 0 && ", "}
                      <a
                        href={s.photo.articleUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline"
                      >
                        {s.name}
                      </a>
                    </span>
                  ))}
                  .
                </>
              )}
            </p>
          )}
        </>
      )}

      <div className="mt-6">
        <RouteTimeline stops={stops} transportPlans={transportPlans} />
      </div>

      <div className="mt-6 border-t border-border pt-5">
        <div className="mb-3 flex items-center justify-between">
          <p className="font-display text-lg font-medium text-foreground">
            Travellers ({trip.members.length})
          </p>
          <div className="flex items-center gap-3">
            <Link
              href={`/trips/${tripId}/agent/trace`}
              className="inline-flex cursor-pointer items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              Agent trace
            </Link>
            <Link
              href={`/trips/${tripId}/plan/travellers`}
              className="inline-flex cursor-pointer items-center gap-1 text-xs font-medium text-accent"
            >
              View all <ArrowRight className="size-3.5" />
            </Link>
          </div>
        </div>
        <div className="flex gap-4 overflow-x-auto pb-1">
          {trip.members.map((member) => {
            return (
              <div key={member.userId} className="flex shrink-0 flex-col items-center gap-1.5">
                <Face index={faceIndexForId(member.userId)} className="size-12" />
                <span className="text-xs font-medium text-foreground">
                  {member.user.name}
                </span>
                <span className="text-[10px] text-muted-foreground">
                  {member.participationStart && member.participationEnd
                    ? `${member.participationStart.toLocaleDateString("en-GB", {
                        day: "numeric",
                        timeZone: "UTC",
                      })}–${member.participationEnd.toLocaleDateString("en-GB", {
                        day: "numeric",
                        timeZone: "UTC",
                      })}`
                    : "No dates yet"}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
