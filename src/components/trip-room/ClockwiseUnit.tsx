import type { ReactNode } from "react";

// Clockwise speaking. Human messages stay plain and white; anything Clockwise says, and the cards that back it up
// (places, routes, weather), sit together in ONE softly tinted container, so "a person said this -> the agent did
// this" reads at a glance, even with the sound off. Presentation only.
export function ClockwiseUnit({ time, children }: { time?: string; children: ReactNode }) {
  return (
    <section className="cw-unit vote-in" data-cw-unit aria-label="Clockwise">
      <p className="cw-unit-label">
        <span aria-hidden>✦</span> Clockwise
        {time && <span className="font-normal normal-case tracking-normal text-muted-foreground">{time}</span>}
      </p>
      {children}
    </section>
  );
}

export function ClockwiseWords({ children }: { children: ReactNode }) {
  return <div className="cw-words">{children}</div>;
}
