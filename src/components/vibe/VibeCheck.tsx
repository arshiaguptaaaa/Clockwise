"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { X } from "lucide-react";
import { ClockwiseMark } from "@/components/ClockwiseMark";
import { BengaluruArt } from "@/components/art/BengaluruArt";
import { saveVibeAnswerAction, deferVibeAction, completeVibeAction, searchOriginAction } from "@/app/traveller-actions";
import type { Question, QuestionId } from "@/lib/traveller/vibe";

type Found = { displayName: string; name: string; region: string | null; country: string | null; place: unknown };

// Private, one question per screen, written straight to the traveller's own
// structured preferences. Nothing here posts to group chat.
export function VibeCheck({ tripId, firstName, questions, knownLine }: { tripId: string; firstName: string; questions: Question[]; knownLine?: string | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(true);
  const [stage, setStage] = useState<"intro" | "q" | "done">("intro");
  const [i, setI] = useState(0);
  const [single, setSingle] = useState<Record<string, string>>({});
  const [multi, setMulti] = useState<Record<string, string[]>>({});
  const [text, setText] = useState("");
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<Found[]>([]);
  const [origin, setOrigin] = useState<Found | null>(null);
  const [busy, start] = useTransition();
  const q = questions[i];
  const total = questions.length;

  const summary = useMemo(() => {
    const bits: string[] = [];
    if (multi.energy?.length) bits.push(multi.energy.slice(0, 3).join(" + ").toLowerCase().replace(/_/g, " "));
    if (single.food) bits.push(single.food.toLowerCase().replace(/_/g, " "));
    if (single.movement) bits.push(`${single.movement.toLowerCase().replace(/_/g, " ")} getting around`);
    if (single.pace) bits.push(`${single.pace.toLowerCase().replace(/_/g, " ")} pace`);
    return bits;
  }, [single, multi]);

  if (!open) return null;

  const next = (save?: () => Promise<unknown>) =>
    start(async () => {
      if (save) await save();
      if (i + 1 >= total) {
        await completeVibeAction(tripId);
        setStage("done");
      } else {
        setI(i + 1);
        setText("");
      }
    });

  const later = () =>
    start(async () => {
      if (stage !== "done") await deferVibeAction(tripId);
      setOpen(false);
      router.refresh();
    });

  const cur = q?.id as QuestionId | undefined;
  const canNext = !q ? false : q.kind === "place" ? Boolean(origin) : q.kind === "single" ? Boolean(single[q.id]) : q.kind === "multi" ? (multi[q.id]?.length ?? 0) > 0 : true;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-surface" role="dialog" aria-label="Vibe check" data-vibe-check>
      <div className="mx-auto flex w-full max-w-lg flex-1 flex-col px-6 pb-8 pt-6">
        <div className="flex items-center justify-between">
          <span className="text-accent-strong">
            <ClockwiseMark size={28} />
          </span>
          <button type="button" aria-label="Close" onClick={later} className="cursor-pointer rounded-full p-1 text-muted-foreground">
            <X className="size-5" />
          </button>
        </div>

        {stage === "intro" && (
          <div className="flex flex-1 flex-col justify-center text-center">
            <BengaluruArt scene="coffee" className="tile-in mx-auto w-44 -rotate-2 shadow-[0_16px_32px_-18px_rgba(20,24,26,0.55)]" />
            <h1 className="headline headline-xl mt-8">Hey {firstName}.</h1>
            <p className="mt-3 font-display text-[22px] leading-snug tracking-[-0.01em] text-foreground">
              Before we plan around you,
              <br />
              quick vibe check?
            </p>
            <p className="lede mx-auto mt-3 max-w-[18rem]">30 seconds. Private. Your answers never go to the group chat.</p>
            {knownLine && <p className="mt-3 text-xs text-muted-foreground">I already have: {knownLine}. I won&apos;t ask that again.</p>}
            <div className="mt-8 flex flex-col items-center gap-3">
              <button type="button" onClick={() => (total === 0 ? next() : setStage("q"))} className="w-60 cursor-pointer rounded-full bg-accent py-3.5 text-[13px] font-semibold tracking-[0.14em] text-accent-foreground">
                LET&apos;S GO
              </button>
              <button type="button" onClick={later} disabled={busy} className="cursor-pointer text-sm font-semibold text-muted-foreground">
                LATER
              </button>
            </div>
          </div>
        )}

        {stage === "q" && q && (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="mt-4 flex gap-1.5" aria-hidden>
              {questions.map((_, k) => (
                <span key={k} className={`h-1.5 flex-1 rounded-full ${k <= i ? "bg-accent" : "bg-border"}`} />
              ))}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto py-6">
              <h2 className="headline headline-lg">{q.title.charAt(0) + q.title.slice(1).toLowerCase()}</h2>
              {q.hint && <p className="mt-1 text-xs text-muted-foreground">{q.hint}</p>}

              {q.kind === "place" && (
                <div className="mt-5">
                  <input
                    value={origin ? origin.displayName : query}
                    onChange={async (e) => {
                      setOrigin(null);
                      setQuery(e.target.value);
                      setFound(await searchOriginAction(e.target.value));
                    }}
                    placeholder="Search a city"
                    className="w-full rounded-full border border-border bg-page px-4 py-3 text-sm focus:border-accent focus:outline-none"
                  />
                  {!origin && found.length > 0 && (
                    <ul className="mt-2 overflow-hidden rounded-2xl border border-border">
                      {found.map((f, k) => (
                        <li key={k}>
                          <button type="button" onClick={() => setOrigin(f)} className="block w-full cursor-pointer px-4 py-2.5 text-left text-sm hover:bg-surface-muted">
                            <span className="font-medium">{f.name}</span>
                            <span className="block text-xs text-muted-foreground">{[f.region, f.country].filter(Boolean).join(", ")}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              {(q.kind === "single" || q.kind === "multi") && (
                <div className="mt-5 flex flex-wrap gap-2.5">
                  {q.options!.map((o) => {
                    const on = q.kind === "single" ? single[q.id] === o.value : multi[q.id]?.includes(o.value);
                    return (
                      <button
                        key={o.value}
                        type="button"
                        onClick={() =>
                          q.kind === "single"
                            ? setSingle((s) => ({ ...s, [q.id]: o.value }))
                            : setMulti((m) => ({ ...m, [q.id]: m[q.id]?.includes(o.value) ? m[q.id].filter((x) => x !== o.value) : [...(m[q.id] ?? []), o.value] }))
                        }
                        className={`cursor-pointer rounded-full border px-4 py-2.5 text-sm font-medium transition-colors ${on ? "border-accent bg-accent text-accent-foreground" : "border-foreground/15 bg-surface"}`}
                        data-option={o.value}
                      >
                        {o.icon && <span className="mr-1.5">{o.icon}</span>}
                        {o.label}
                      </button>
                    );
                  })}
                </div>
              )}

              {q.kind === "text" && <input value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. No 6 AM plans" className="mt-5 w-full rounded-full border border-border bg-page px-4 py-3 text-sm focus:border-accent focus:outline-none" />}
            </div>

            <div className="flex items-center gap-3">
              {q.optional && (
                <button type="button" disabled={busy} onClick={() => next()} className="cursor-pointer text-sm font-semibold text-muted-foreground">
                  Skip
                </button>
              )}
              <button
                type="button"
                disabled={busy || !canNext}
                onClick={() =>
                  next(async () => {
                    if (!cur) return;
                    if (q.kind === "place" && origin) await saveVibeAnswerAction(tripId, cur, [origin.displayName], origin.place);
                    else if (q.kind === "single") await saveVibeAnswerAction(tripId, cur, [single[q.id]]);
                    else if (q.kind === "multi") await saveVibeAnswerAction(tripId, cur, multi[q.id] ?? []);
                    else if (q.kind === "text" && text.trim()) await saveVibeAnswerAction(tripId, cur, [text.trim()]);
                  })
                }
                className="ml-auto cursor-pointer rounded-full bg-accent px-8 py-3 text-sm font-semibold text-accent-foreground disabled:opacity-50"
              >
                {i + 1 >= total ? "Done" : "Next"}
              </button>
            </div>
          </div>
        )}

        {stage === "done" && (
          <div className="flex flex-1 flex-col items-center justify-center text-center">
            <BengaluruArt scene="ready" className="tile-in w-44 rotate-2 shadow-[0_16px_32px_-18px_rgba(20,24,26,0.55)]" />
            <h2 className="headline headline-xl mt-8">Got your vibe.</h2>
            {summary.length > 0 && <p className="mt-3 max-w-xs text-sm text-muted-foreground">{summary.join(" · ")}</p>}
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                router.push(`/trips/${tripId}/agent/around`);
              }}
              className="mt-8 w-60 cursor-pointer rounded-full bg-accent py-3.5 text-[13px] font-semibold tracking-[0.14em] text-accent-foreground"
            >
              SEE AROUND YOU
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
