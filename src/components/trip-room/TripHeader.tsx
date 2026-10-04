"use client";

import { useState } from "react";
import { InviteTravellersPanel } from "./InviteTravellersPanel";
import { PersonFace, firstName, FaceStack } from "@/components/decisions/People";
import type { HerePerson } from "@/lib/whos-here";

// The top of the Trip Room: where, when, who - and a line of Clockwise's own voice.
export function TripHeader({
  tripId,
  place,
  dates,
  tripName,
  tagline,
  people,
  isOrganiser,
  viewerId,
}: {
  tripId: string;
  place: string;
  dates: string;
  tripName: string;
  tagline: string;
  people: HerePerson[];
  isOrganiser: boolean;
  viewerId: string | null;
}) {
  const [inviteOpen, setInviteOpen] = useState(false);
  const tone = (t: HerePerson["tone"]) => (t === "late" ? "text-danger" : t === "early" ? "text-success" : "text-muted-foreground");
  return (
    <header className="shrink-0 border-b border-border px-5 pb-5 pt-5" data-trip-header>
      <p className="eyebrow">{dates}{tripName.toLowerCase() !== place.toLowerCase() ? ` · ${tripName}` : ""}</p>
      <h1 className="headline headline-xl mt-2 uppercase">{place}</h1>
      <div className="mt-4 flex items-center gap-3">
        <FaceStack people={people} max={5} className="size-8" />
        <button type="button" onClick={() => setInviteOpen(true)} className="cursor-pointer rounded-full border border-foreground/25 px-3.5 py-1 text-[11px] font-semibold tracking-[0.14em] hover:border-foreground">+ INVITE</button>
      </div>
      <p className="mt-4 font-display text-[16px] italic leading-snug text-muted-foreground">&ldquo;{tagline}&rdquo;</p>

      <ul className="mt-5 flex gap-5 overflow-x-auto pb-1 [scrollbar-width:none]" data-whos-here>
        {people.map((p) => (
          <li key={p.userId} className="flex shrink-0 items-center gap-2">
            <PersonFace userId={p.userId} name={p.name} className="size-8" />
            <span className="leading-tight">
              <span className="block text-[13px] font-semibold text-foreground">{firstName(p.name)}{p.userId === viewerId ? " (you)" : ""}</span>
              <span className={`block text-[11.5px] ${tone(p.tone)}`}>{p.status}</span>
            </span>
          </li>
        ))}
      </ul>
      {inviteOpen && <InviteTravellersPanel tripId={tripId} isOrganiser={isOrganiser} onClose={() => setInviteOpen(false)} />}
    </header>
  );
}
