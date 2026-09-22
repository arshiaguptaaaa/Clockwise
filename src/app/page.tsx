import { MapPinned, Ticket } from "lucide-react";
import { ClockwiseWordmark } from "@/components/ClockwiseWordmark";
import { TrackedLink } from "@/components/home/TrackedLink";
import { TrackLandingView } from "@/components/home/TrackLandingView";

// Three real funnels, kept visually and conceptually distinct so traffic
// analysis isn't contaminated by people accidentally landing in the demo:
// PLAN A TRIP / JOIN A TRIP create or join a real Clockwise trip (Onboard);
// Join the early-access list expresses interest before launch (Acquire);
// Explore demo trip is the ONLY path into the seeded showcase (Demonstrate).
export default function ClockwiseHomePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-page px-6 py-16">
      <TrackLandingView />
      <div className="w-full max-w-sm text-center">
        <ClockwiseWordmark className="justify-center" />
        <p className="mt-1 text-xs font-medium uppercase tracking-[0.25em] text-muted-foreground">
          One trip. Many clocks.
        </p>

        <div className="mt-10 flex flex-col gap-3">
          <TrackedLink
            href="/new"
            event="plan_trip_clicked"
            className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-accent px-4 py-3.5 text-sm font-medium text-accent-foreground transition-colors hover:bg-accent-strong"
          >
            <MapPinned className="size-4" />
            Plan a Trip
          </TrackedLink>
          <TrackedLink
            href="/join"
            event="join_trip_clicked"
            className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl border border-border bg-surface px-4 py-3.5 text-sm font-medium text-foreground transition-colors hover:border-accent hover:text-accent"
          >
            <Ticket className="size-4" />
            Join a Trip
          </TrackedLink>
        </div>

        <TrackedLink
          href="/waitlist"
          event="waitlist_clicked"
          className="mt-6 inline-block cursor-pointer text-sm font-medium text-accent underline-offset-4 hover:underline"
        >
          Join the early-access list →
        </TrackedLink>

        <div>
          <TrackedLink
            href="/demo"
            event="demo_clicked"
            className="mt-3 inline-block cursor-pointer text-sm text-muted-foreground underline-offset-4 hover:text-accent hover:underline"
          >
            Explore demo trip →
          </TrackedLink>
        </div>
      </div>
    </main>
  );
}
