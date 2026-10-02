import { MapPinned, Ticket } from "lucide-react";
import { ClockwiseWordmark } from "@/components/ClockwiseWordmark";
import { TrackedLink } from "@/components/home/TrackedLink";
import { TrackLandingView } from "@/components/home/TrackLandingView";
import { HeroPhotoStage } from "@/components/home/HeroPhotoStage";
import { CHARACTER_CREDIT } from "@/lib/characters";

// Three real funnels, kept visually and conceptually distinct so traffic
// analysis isn't contaminated by people accidentally landing in the demo:
// PLAN A TRIP / JOIN A TRIP create or join a real Clockwise trip (Onboard);
// Join the early-access list expresses interest before launch (Acquire);
// Explore demo trip is the ONLY path into the seeded showcase (Demonstrate).
//
// Composition: a white canvas, a large editorial statement, and one floating
// photograph of a real place. The human layer (CharacterSlot) stays empty
// until licensed character art is registered — see src/lib/characters.ts.
export default function ClockwiseHomePage() {
  return (
    <main className="relative min-h-screen shrink-0 overflow-x-clip bg-white">
      <TrackLandingView />

      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 pb-2 pt-6 sm:px-10 sm:pt-8">
        <ClockwiseWordmark />
        <TrackedLink
          href="/join"
          event="join_trip_clicked"
          className="cursor-pointer text-sm font-medium text-foreground underline-offset-4 hover:text-accent hover:underline"
        >
          Join a trip
        </TrackedLink>
      </header>

      <div className="mx-auto grid w-full max-w-6xl gap-x-16 gap-y-8 px-6 pb-16 pt-4 sm:px-10 lg:min-h-[calc(100vh-96px)] lg:grid-cols-[1.15fr_1fr] lg:content-center lg:pt-0">
        <section className="lg:col-start-1 lg:row-start-1 lg:self-end">
          <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-muted-foreground">
            Group travel, kept on time
          </p>
          <h1 className="mt-4 font-display text-[clamp(2.75rem,9vw,6.25rem)] font-medium leading-[0.95] tracking-tight text-foreground">
            One trip.
            <br />
            <span className="italic text-accent">Many clocks.</span>
          </h1>
          <p className="mt-5 max-w-md text-[15px] leading-relaxed text-muted-foreground">
            Everyone can arrive differently. Clockwise keeps the trip together.
          </p>

          <div className="mt-7 flex flex-col gap-3 sm:flex-row">
            <TrackedLink
              href="/new"
              event="plan_trip_clicked"
              className="flex cursor-pointer items-center justify-center gap-2 rounded-full bg-accent px-7 py-3.5 text-sm font-medium text-accent-foreground transition-colors hover:bg-accent-strong"
            >
              <MapPinned className="size-4" />
              Plan a trip
            </TrackedLink>
            <TrackedLink
              href="/join"
              event="join_trip_clicked"
              className="hidden cursor-pointer items-center justify-center gap-2 rounded-full border border-border bg-white px-7 py-3.5 text-sm font-medium text-foreground transition-colors hover:border-accent hover:text-accent sm:flex"
            >
              <Ticket className="size-4" />
              Join a trip
            </TrackedLink>
          </div>
        </section>

        <div className="lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:self-center">
          <HeroPhotoStage />
        </div>

        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm lg:col-start-1 lg:row-start-2 lg:self-start">
          <TrackedLink
            href="/waitlist"
            event="waitlist_clicked"
            className="cursor-pointer font-medium text-accent underline-offset-4 hover:underline"
          >
            Join the early-access list →
          </TrackedLink>
          <TrackedLink
            href="/demo"
            event="demo_clicked"
            className="cursor-pointer text-muted-foreground underline-offset-4 hover:text-accent hover:underline"
          >
            Explore demo trip →
          </TrackedLink>
        </div>
      </div>

      <footer className="mx-auto w-full max-w-6xl px-6 pb-8 text-[10px] leading-relaxed text-muted-foreground sm:px-10">
        Illustrations: {CHARACTER_CREDIT.creators},{" "}
        <a href={CHARACTER_CREDIT.portraitsSourceUrl} target="_blank" rel="noopener noreferrer" className="underline-offset-2 hover:underline">
          {CHARACTER_CREDIT.set}
        </a>
        , <a href={CHARACTER_CREDIT.licenseUrl} target="_blank" rel="noopener noreferrer" className="underline-offset-2 hover:underline">{CHARACTER_CREDIT.license}</a>.
        Photography credited beside each image.
      </footer>
    </main>
  );
}
