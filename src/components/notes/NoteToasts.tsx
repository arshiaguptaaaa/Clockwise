"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { ackNoteAction, askSenderAction, noteShownAction } from "@/app/note-actions";
import type { NoteForViewer } from "@/lib/private-notes";

// A note another traveller asked Clockwise to pass to you. It arrives through the same live sync as everything
// else, shows once as a toast, and stays in the Notification Centre and under You until you tap GOT IT.
export function NoteToasts({ tripId, notes }: { tripId: string; notes: NoteForViewer[] }) {
  const [hidden, setHidden] = useState<string[]>([]);
  const [pending, start] = useTransition();
  const reported = useRef<Set<string>>(new Set());
  const shown = notes.filter((n) => !hidden.includes(n.id));

  useEffect(() => {
    const fresh = shown.filter((n) => !reported.current.has(n.id)).map((n) => n.id);
    if (!fresh.length) return;
    fresh.forEach((id) => reported.current.add(id));
    void noteShownAction(tripId, fresh).catch(() => undefined);
  }, [shown, tripId]);

  if (shown.length === 0) return null;
  const done = (id: string) => setHidden((h) => [...h, id]);

  return (
    <div className="pointer-events-none fixed inset-x-0 top-[68px] z-50 mx-auto flex w-full max-w-lg flex-col gap-2 px-3" data-note-toasts aria-live="polite">
      {shown.map((n) => {
        const money = n.kind.startsWith("MONEY") && n.amountLabel;
        return (
          <section key={n.id} className="cw-unit vote-in pointer-events-auto shadow-sm" data-note-toast data-note-kind={n.kind}>
            <p className="cw-unit-label">
              <span aria-hidden>✦</span> Clockwise <span className="font-normal normal-case tracking-normal text-muted-foreground">· just now</span>
            </p>
            {money ? (
              <p className="t-display text-[22px] leading-tight">
                {n.amountLabel} <span className="eyebrow">{n.kind === "MONEY_TO_SENDER" ? `to ${n.fromName}` : `from ${n.fromName}`}</span>
              </p>
            ) : (
              <p className="text-[15px] font-semibold">{n.fromName} left you a note</p>
            )}
            <p className="text-[14px] leading-snug">{n.headline}</p>
            {money && <p className="text-[12px] text-muted-foreground">{n.linked ? "Matches a shared expense in Budget." : `This is ${n.fromName}'s own note, not a recorded expense.`}</p>}
            <div className="flex flex-wrap gap-2 pt-1">
              <button type="button" disabled={pending} className="min-h-11 cursor-pointer rounded-full bg-accent px-5 text-[12px] font-semibold uppercase tracking-[0.12em] text-white" onClick={() => { done(n.id); start(() => ackNoteAction(tripId, n.id)); }}>
                Got it
              </button>
              {money ? (
                <button type="button" disabled={pending} className="min-h-11 cursor-pointer rounded-full border border-border px-5 text-[12px] font-semibold uppercase tracking-[0.12em]" onClick={() => { done(n.id); start(() => askSenderAction(tripId, n.id)); }}>
                  Ask {n.fromName}
                </button>
              ) : (
                <Link href={`/trips/${tripId}/agent#notes`} className="flex min-h-11 items-center rounded-full border border-border px-5 text-[12px] font-semibold uppercase tracking-[0.12em]" onClick={() => done(n.id)}>
                  View
                </Link>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}
