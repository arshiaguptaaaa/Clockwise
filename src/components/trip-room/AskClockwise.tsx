"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { ArrowUp, X } from "lucide-react";
import { ClockwiseMark } from "@/components/ClockwiseMark";
import { askClockwise } from "@/app/ask-actions";
import { findStaysAction } from "@/app/stay-actions";
import { StayList } from "@/components/stays/StayList";
import type { HotelListing } from "@/lib/travel/hotel-provider";

const STAY_WANTS = ["Central", "Pool", "Breakfast", "Pretty", "Budget", "Flexible"];

const TOPICS: { label: string; icon: string; prompt: string }[] = [
  { label: "Get there", icon: "✈", prompt: "Help me figure out how to get there." },
  { label: "Find a stay", icon: "⌂", prompt: "Help me think about where we should stay." },
  { label: "Things to do", icon: "✦", prompt: "What should we do on this trip?" },
  { label: "Food", icon: "🍜", prompt: "Where should we eat?" },
  { label: "Get around", icon: "→", prompt: "How do we get around once we're there?" },
  { label: "Weather", icon: "☀", prompt: "What's the weather going to be like?" },
  { label: "Our plan", icon: "✓", prompt: "Walk me through our plan so far." },
];

// The AI-first surface. Group chat stays human; this is where Clockwise can
// ask, search and guide, and where a working state is allowed (the clock hands
// sweep — no "thinking" text).
export function AskClockwise({ tripId }: { tripId: string }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, start] = useTransition();
  const [answer, setAnswer] = useState<{ q: string; reply: string | null; hasCard: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  // "Find a stay" is a deterministic flow, not a chat: the trip already knows
  // where/when/how many, so it asks only what matters, then lists provider results.
  const [stayStep, setStayStep] = useState<null | "wants" | "results">(null);
  const [wants, setWants] = useState<string[]>([]);
  const [stays, setStays] = useState<{ listings: HotelListing[]; context: { destination: string; dates: string | null; nights: number | null; travellers: number }; notes: string[]; saved: string[] } | null>(null);

  function searchStays() {
    setError(null);
    start(async () => {
      const r = await findStaysAction(tripId, wants);
      if (r.ok) {
        setStays({ listings: r.listings, context: { destination: r.destination, dates: r.dates, nights: r.nights, travellers: r.travellers }, notes: r.notes, saved: r.saved ?? [] });
        setStayStep("results");
      } else setError(r.error);
    });
  }

  function ask(q: string) {
    if (!q.trim() || busy) return;
    setError(null);
    setAnswer(null);
    start(async () => {
      const r = await askClockwise(tripId, q);
      if (r.ok) {
        setAnswer({ q, reply: r.reply, hasCard: r.hasCard });
        setText("");
      } else setError(r.error);
    });
  }

  return (
    <>
      <div className="flex shrink-0 justify-center border-t border-border bg-surface px-4 pt-2">
        <button
          type="button"
          onClick={() => setOpen(true)}
          data-ask-clockwise
          className="flex cursor-pointer items-center gap-1.5 rounded-full bg-pop-pink-tint px-3.5 py-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-accent-strong"
        >
          <ClockwiseMark size={16} /> Ask Clockwise
        </button>
      </div>

      {open && (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/40" onClick={() => setOpen(false)}>
          <div
            role="dialog"
            aria-label="Ask Clockwise"
            className="flex max-h-[88vh] w-full max-w-lg flex-col rounded-t-3xl bg-surface pb-[env(safe-area-inset-bottom)] lg:max-w-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-border" />
            <button aria-label="Close" onClick={() => setOpen(false)} className="absolute right-4 top-4 cursor-pointer rounded-full p-1 text-muted-foreground">
              <X className="size-5" />
            </button>

            <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4 pt-4">
              <div className="flex flex-col items-center text-center text-accent-strong">
                <ClockwiseMark size={44} working={busy} />
                {!busy && !answer && !stayStep && (
                  <h2 className="mt-3 font-display text-[28px] leading-[1.05] tracking-tight text-foreground">
                    WHAT ARE WE
                    <br />
                    FIGURING OUT?
                  </h2>
                )}
              </div>

              {stayStep === "wants" && !busy && (
                <div className="mt-5 text-center">
                  <h2 className="font-display text-[26px] leading-[1.05] tracking-tight text-foreground">WHAT MATTERS?</h2>
                  <p className="mt-1 text-xs text-muted-foreground">I already know where, when and how many of you.</p>
                  <div className="mt-4 flex flex-wrap justify-center gap-2">
                    {STAY_WANTS.map((w) => (
                      <button key={w} type="button" onClick={() => setWants((cur) => (cur.includes(w) ? cur.filter((x) => x !== w) : [...cur, w]))} className={`cursor-pointer rounded-full border px-4 py-2 text-sm font-medium ${wants.includes(w) ? "border-accent bg-pop-pink-tint text-accent-strong" : "border-border bg-page"}`}>
                        {w}
                      </button>
                    ))}
                  </div>
                  <button type="button" onClick={searchStays} className="mt-5 cursor-pointer rounded-full bg-accent px-6 py-2.5 text-sm font-semibold text-accent-foreground">
                    Find stays
                  </button>
                </div>
              )}

              {stayStep === "results" && stays && (
                <div className="mt-5">
                  <h2 className="mb-3 text-center font-display text-[26px] leading-[1.05] tracking-tight text-foreground">STAYS CLOCKWISE FOUND ✦</h2>
                  <StayList tripId={tripId} listings={stays.listings} context={stays.context} notes={stays.notes} initialSaved={stays.saved} />
                </div>
              )}

              {!busy && !answer && !stayStep && (
                <div className="mt-5 flex flex-wrap justify-center gap-2">
                  {TOPICS.map((t) => (
                    <button
                      key={t.label}
                      type="button"
                      onClick={() => (t.label === "Find a stay" ? setStayStep("wants") : ask(t.prompt))}
                      className="cursor-pointer rounded-full border border-border bg-page px-4 py-2 text-sm font-medium text-foreground transition-colors hover:border-accent"
                    >
                      <span className="mr-1.5">{t.icon}</span>
                      {t.label}
                    </button>
                  ))}
                </div>
              )}

              {answer && (
                <div className="mt-5 space-y-3">
                  <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">You asked · {answer.q}</p>
                  {answer.reply && <p className="whitespace-pre-wrap rounded-2xl bg-surface-muted px-4 py-3 text-sm leading-relaxed text-foreground">{answer.reply}</p>}
                  {answer.hasCard && (
                    <Link href={`/trips/${tripId}/agent`} className="block text-sm font-semibold text-accent underline-offset-2 hover:underline">
                      See the details in My Clockwise →
                    </Link>
                  )}
                  <button type="button" onClick={() => setAnswer(null)} className="cursor-pointer text-xs font-semibold uppercase tracking-wider text-accent">
                    Ask something else
                  </button>
                </div>
              )}

              {error && (
                <div className="mt-4 flex items-center justify-center gap-3 text-sm text-danger" role="alert">
                  <span>{error}</span>
                </div>
              )}
            </div>

            <form
              className="flex shrink-0 items-center gap-2 border-t border-border px-4 py-3"
              onSubmit={(e) => {
                e.preventDefault();
                ask(text);
              }}
            >
              <input
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Ask Clockwise…"
                autoComplete="off"
                disabled={busy}
                className="flex-1 rounded-full border border-border bg-page px-4 py-2 text-sm focus:border-accent focus:outline-none disabled:opacity-60"
              />
              <button
                type="submit"
                aria-label="Ask"
                disabled={busy || !text.trim()}
                className="flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-full bg-accent text-accent-foreground disabled:opacity-50"
              >
                <ArrowUp className="size-4" strokeWidth={2.25} />
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
