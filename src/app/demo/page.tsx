import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CalendarDays, MapPin, Users } from "lucide-react";
import { getDemoTrip, getCurrentMember } from "@/lib/trip";
import { HALLSTATT_HERO } from "@/lib/photos";
import { formatDateRange } from "@/lib/format";
import { ClockwiseWordmark } from "@/components/ClockwiseWordmark";

export default async function DemoHeroPage() {
  const trip = await getDemoTrip();

  const session = await getCurrentMember(trip.id);
  if (session) {
    redirect(`/trips/${trip.id}/room`);
  }

  const middleStops = trip.destinations
    .filter((d) => d.name !== "Delhi")
    .sort((a, b) => a.order - b.order)
    .map((d) => d.name);

  return (
    <main className="relative flex min-h-screen flex-col justify-end overflow-hidden">
      <Image
        src={HALLSTATT_HERO.src}
        alt={HALLSTATT_HERO.alt}
        fill
        priority
        className="object-cover"
        sizes="100vw"
      />
      <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/25 to-black/10" />
      <p className="absolute right-3 top-3 z-10 text-[10px] text-white/60">
        Photo: {HALLSTATT_HERO.credit}
      </p>

      <div className="relative z-10 mx-auto flex w-full max-w-md flex-1 flex-col justify-between px-6 pb-8 pt-12 text-white">
        <div>
          <ClockwiseWordmark />
          <p className="mt-1 text-xs font-medium uppercase tracking-[0.25em] text-white/80">
            One trip. Many clocks.
          </p>
        </div>

        <div className="mb-8">
          <h1 className="text-4xl font-semibold leading-tight">
            Travel together.
            <br />
            On your own clocks.
          </h1>
        </div>

        <div className="rounded-2xl bg-white p-5 text-foreground shadow-xl">
          <p className="text-lg font-semibold">{trip.name}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {middleStops.join(" · ")}
          </p>
          <div className="mt-3 flex items-center gap-4 text-sm text-muted-foreground">
            {trip.coreStartDate && trip.coreEndDate && (
              <span className="inline-flex items-center gap-1.5">
                <CalendarDays className="size-4" />
                {formatDateRange(trip.coreStartDate, trip.coreEndDate)}
              </span>
            )}
            <span className="inline-flex items-center gap-1.5">
              <Users className="size-4" />
              {trip.members.length} travellers
            </span>
          </div>
          <Link
            href="/demo/join"
            className="mt-4 flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-accent px-4 py-3 text-sm font-medium text-accent-foreground transition-colors hover:bg-accent-strong"
          >
            <MapPin className="size-4" />
            Join Trip
          </Link>
        </div>

        <p className="mt-6 text-center text-xs text-white/70">
          Friends. Journeys. Made easier.
        </p>
      </div>
    </main>
  );
}
