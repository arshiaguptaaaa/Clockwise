"use client";

import Link from "next/link";
import { useState } from "react";
import { InviteTravellersPanel } from "./InviteTravellersPanel";
import { PersonFace, firstName, FaceStack } from "@/components/decisions/People";
import type { HerePerson } from "@/lib/whos-here";

// The Trip Room's hero. Not a dashboard: where, when, who, and one living line of Clockwise's voice.
export function TripHeader({
  tripId,
  place,
  dates,
  tagline,
  voice,
  people,
  isOrganiser,
  viewerId,
}: {
  tripId: string;
  place: string;
  dates: string;
  tagline: string;
  voice: string;
  people: HerePerson[];
  isOrganiser: boolean;
  viewerId: string | null;
}) {
  const [inviteOpen, setInviteOpen] = useState(false);
  const tone = (t: HerePerson["tone"]) => (t === "late" ? "text-danger" : t === "early" ? "text-success" : "text-muted-foreground");
  const names = people.map((p) => firstName(p.name)).join(" · ");
  return (
    <header className="shrink-0 px-5 pb-2 pt-4" data-trip-header>
      <p className="eyebrow">{dates}</p>
      <h1 className="t-display mt-2 text-[clamp(44px,15vw,64px)] break-words">{place}</h1>
      <p className="t-voice mt-3 text-[15px]">{tagline}</p>

      <div className="mt-4 flex items-center gap-3">
        <FaceStack people={people} max={5} className="size-9" />
        <button type="button" onClick={() => setInviteOpen(true)} className="btn btn-ghost ml-auto !px-4 !text-[11px]">
          + Invite
        </button>
      </div>
      <p className="mt-2 text-[13px] leading-snug text-muted-foreground" data-names>{names}</p>

      <p className="mt-5 flex items-start gap-2 font-display text-[19px] leading-snug tracking-[-0.01em]" data-voice>
        <span className="cw-mark mt-0.5">◷</span>
        <span>{voice}</span>
      </p>

      <ul className="hscroll mt-5 !gap-6" data-whos-here>
        {people.map((p) => (
          <li key={p.userId} className="flex items-center gap-2">
            <PersonFace userId={p.userId} name={p.name} className="size-8" />
            <span className="leading-tight">
              <span className="block text-[13px] font-semibold text-foreground">
                {firstName(p.name)}
                {p.userId === viewerId ? " · you" : ""}
              </span>
              <span className={`block whitespace-nowrap text-[11.5px] ${tone(p.tone)}`}>{p.status}</span>
            </span>
          </li>
        ))}
      </ul>
      <Link href={`/trips/${tripId}/room/files`} className="mt-2 inline-block min-h-8 text-[11.5px] uppercase tracking-[0.14em] text-muted-foreground hover:text-foreground">
        Files →
      </Link>
      {inviteOpen && <InviteTravellersPanel tripId={tripId} isOrganiser={isOrganiser} onClose={() => setInviteOpen(false)} />}
    </header>
  );
}
