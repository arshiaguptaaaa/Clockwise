import Image from "next/image";
import Link from "next/link";
import { PlaneTakeoff, PlaneLanding, MapPin, ArrowRight } from "lucide-react";
import { getTripById } from "@/lib/trip";
import { DESTINATION_PHOTOS } from "@/lib/photos";
import { formatDateRange } from "@/lib/format";
import { avatarColor } from "@/lib/avatar";

export default async function PlanOverviewPage({
  params,
}: {
  params: Promise<{ tripId: string }>;
}) {
  const { tripId } = await params;
  const trip = await getTripById(tripId);
  const stops = [...trip.destinations].sort((a, b) => a.order - b.order);
  const middleStops = stops.filter((s) => s.name !== "Delhi");

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5">
      {middleStops.length > 0 && (
        <>
          <div className="grid grid-cols-2 gap-2.5">
            {middleStops.map((stop) => {
              const photo = DESTINATION_PHOTOS[stop.name];
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
          {middleStops.some((s) => DESTINATION_PHOTOS[s.name]) && (
            <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">
              Photos: {Object.values(DESTINATION_PHOTOS).map((p) => p.credit.split(" /")[0]).join(", ")} — Wikimedia Commons, CC BY-SA
            </p>
          )}
        </>
      )}

      {stops.length === 0 ? (
        <p className="pt-8 text-center text-sm text-muted-foreground">
          No destinations added yet.
        </p>
      ) : (
        <div className="mt-6">
          <ol className="relative border-l border-border pl-5">
            {stops.map((stop, i) => {
              const isEndpoint = stop.name === "Delhi";
              return (
                <li key={stop.id} className="mb-5 last:mb-0">
                  <span className="absolute -left-[7px] flex size-3.5 items-center justify-center rounded-full border-2 border-surface bg-accent" />
                  <div className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                    {isEndpoint ? (
                      i === 0 ? (
                        <PlaneTakeoff className="size-3.5 text-muted-foreground" />
                      ) : (
                        <PlaneLanding className="size-3.5 text-muted-foreground" />
                      )
                    ) : (
                      <MapPin className="size-3.5 text-muted-foreground" />
                    )}
                    <span>
                      {stop.name}
                      {stop.country && stop.country !== "India" && (
                        <span className="font-normal text-muted-foreground">
                          , {stop.country}
                        </span>
                      )}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {stop.startDate && stop.endDate
                      ? isEndpoint
                        ? `${formatDateRange(
                            stop.startDate,
                            stop.startDate,
                            "short"
                          )} · ${i === 0 ? "Depart" : "Return"}`
                        : formatDateRange(stop.startDate, stop.endDate, "short")
                      : "Dates not set yet"}
                  </p>
                </li>
              );
            })}
          </ol>
        </div>
      )}

      <div className="mt-6 border-t border-border pt-5">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-sm font-medium text-foreground">
            Travellers ({trip.members.length})
          </p>
          <Link
            href={`/trips/${tripId}/plan/travellers`}
            className="inline-flex cursor-pointer items-center gap-1 text-xs font-medium text-accent"
          >
            View all <ArrowRight className="size-3.5" />
          </Link>
        </div>
        <div className="flex gap-4 overflow-x-auto pb-1">
          {trip.members.map((member) => {
            const color = avatarColor(member.user.name);
            return (
              <div key={member.userId} className="flex shrink-0 flex-col items-center gap-1.5">
                <span
                  className="flex size-11 items-center justify-center rounded-full text-sm font-medium"
                  style={{ backgroundColor: color.bg, color: color.text }}
                >
                  {member.user.name.slice(0, 1)}
                </span>
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
