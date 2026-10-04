import Image from "next/image";
import { redirect } from "next/navigation";
import { ClockwiseWordmark } from "@/components/ClockwiseWordmark";
import { BengaluruArt } from "@/components/art/BengaluruArt";
import { joinByCode } from "@/app/invite-actions";
import { publicTripByJoinCode, normaliseJoinCode } from "@/lib/join-link";
import { getCurrentUserId } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { curatedPhotoFor } from "@/lib/destination-photos";
import { formatDateRange } from "@/lib/format";

export const dynamic = "force-dynamic";

// The public face of a trip: what a friend sees before they've joined. Only the trip's name,
// destination, dates and a head-count - never who is on it or anything they've shared.
export default async function JoinTripPage({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<{ error?: string }> }) {
  const { code } = await params;
  const { error } = await searchParams;
  const trip = await publicTripByJoinCode(code);

  if (!trip) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-page px-6 text-center">
        <ClockwiseWordmark className="justify-center" />
        <p className="headline headline-lg mt-8 max-w-xs">This link has lost its way.</p>
        <p className="lede mt-3 max-w-xs">It may have been replaced with a fresh one. Ask whoever sent it for the latest.</p>
      </main>
    );
  }

  // Already on this trip from this device: straight in, nothing to ask.
  const me = await getCurrentUserId();
  if (me && (await prisma.tripMember.findUnique({ where: { tripId_userId: { tripId: trip.id, userId: me } }, select: { id: true } }))) {
    redirect(`/trips/${trip.id}/room`);
  }

  const where = trip.destinations[0] ?? null;
  const photo = curatedPhotoFor(where);
  const dates = trip.start && trip.end ? formatDateRange(trip.start, trip.end, "short") : "Dates still to decide";
  const code8 = normaliseJoinCode(code);
  const others = trip.friendsHere;

  return (
    <main className="min-h-screen bg-page">
      <div className="mx-auto flex min-h-screen w-full max-w-md flex-col px-6 pb-12 pt-8">
        <ClockwiseWordmark className="!text-lg" iconClassName="size-5" />

        <div className="mt-10">
          <p className="eyebrow">{trip.organiserFirstName ? `${trip.organiserFirstName} is bringing the group` : "You're invited"}</p>
          <h1 className="headline headline-xl mt-3">{where ? `${where}, with friends.` : trip.name}</h1>
          <p className="mt-3 text-[13px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">{dates}</p>
        </div>

        {photo ? (
          <figure className="mt-8">
            <div className="relative aspect-[4/3] overflow-hidden rounded-[22px] bg-surface-muted">
              <Image src={photo.src} alt={photo.alt} fill priority className="object-cover" style={{ objectPosition: photo.objectPosition }} sizes="448px" />
            </div>
            <p className="mt-1.5 text-[10px] text-muted-foreground">
              Photo: {photo.credit}, <a href={photo.licenseUrl} target="_blank" rel="noopener noreferrer" className="underline">{photo.license}</a>
            </p>
          </figure>
        ) : (
          <BengaluruArt scene="converge" className="tile-in mt-8 w-40 -rotate-2" />
        )}

        <p className="lede mt-7 max-w-sm">
          {others > 0 ? `${others} ${others === 1 ? "friend is" : "friends are"} already in.` : "You're first in."} Clockwise keeps everyone&apos;s clock in step, so nobody has to chase a flight time. What you tell it privately stays private.
        </p>

        <form action={joinByCode.bind(null, code8)} className="mt-8">
          <label className="block">
            <span className="eyebrow">What should we call you?</span>
            <input
              name="name"
              required
              maxLength={40}
              autoComplete="given-name"
              placeholder="Your first name"
              className="mt-2 w-full border-b border-foreground/30 bg-transparent py-2.5 font-display text-[26px] tracking-[-0.01em] outline-none placeholder:text-muted-foreground/50 focus:border-accent"
            />
          </label>
          {error === "name" && <p className="mt-2 text-[12px] text-danger">A name first, so your friends know it&apos;s you.</p>}
          {error === "full" && <p className="mt-2 text-[12px] text-danger">This trip is full. Ask the organiser to make a new link.</p>}
          <button type="submit" className="mt-6 w-full cursor-pointer rounded-full bg-accent px-6 py-3.5 text-[13px] font-semibold tracking-[0.16em] text-accent-foreground transition-opacity hover:opacity-90">
            JOIN THE TRIP
          </button>
          <p className="mt-3 text-[11.5px] text-muted-foreground">No account, no email.</p>
        </form>
      </div>
    </main>
  );
}
