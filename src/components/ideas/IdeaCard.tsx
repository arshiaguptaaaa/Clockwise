"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { proposeIdeaAction, dismissIdeaAction } from "@/app/idea-actions";

export type IdeaStepView = { kind: "place" | "food" | "return"; name: string; at: string | null; location: string | null; note: string | null; provider: string | null };
export type IdeaView = { suggestionId: string; title: string; why: string; intro: string | null; windowLabel: string; steps: IdeaStepView[]; status: string };

const clock = (local: string) => new Date(`${local}:00Z`).toLocaleTimeString("en-GB", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "UTC" }).toUpperCase();

// CLOCKWISE HAS AN IDEA: a SUGGESTION. Not a proposal (nobody has been asked to vote) and not the Plan.
export function IdeaCard({ idea }: { idea: IdeaView }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const status = idea.status;

  function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    start(async () => {
      const r = await fn();
      if (!r.ok) setError(r.error ?? "That didn't work.");
      else router.refresh();
    });
  }

  if (status === "DISMISSED") {
    return (
      <div className="border-l border-border py-1 pl-4 text-[12.5px] text-muted-foreground" data-idea-card data-idea-status={status}>
        <span className="line-through decoration-[1px]">{idea.title}</span> — not now.
      </div>
    );
  }

  return (
    <div className="vote-in w-full max-w-md border-l-[3px] border-accent-strong bg-surface-muted/50 py-5 pl-4 pr-3 sm:max-w-lg" data-idea-card data-idea-status={status}>
      <p className="eyebrow !text-accent-strong">
        <span className="cw-mark">◷</span> Clockwise has an idea ✦
      </p>
      {idea.intro && <p className="mt-2 text-[14px] leading-snug">{idea.intro}</p>}
      <p className="mt-2.5 font-display text-[24px] leading-[1.1] tracking-[-0.015em]">{idea.title}</p>
      <p className="mt-2 text-[13.5px] leading-snug text-muted-foreground">{idea.why}</p>

      {open && (
        <ol className="mt-3 space-y-2" data-idea-steps>
          {idea.steps.map((s, i) => (
            <li key={i} className="flex items-baseline gap-3 text-[14px]">
              <span className="t-number w-[4.5rem] shrink-0 text-right text-[15px] text-muted-foreground">{s.at ? clock(s.at) : "↓"}</span>
              <span className="min-w-0">
                <span className={s.kind === "return" ? "text-muted-foreground" : "font-medium"}>{s.name}</span>
                {s.note && <span className="mt-0.5 block text-[12px] text-muted-foreground">{s.note}</span>}
              </span>
            </li>
          ))}
          <li className="text-[11.5px] text-muted-foreground">Routes by {idea.steps.some((x) => x.provider === "delhivery") ? "Delhivery" : "Geoapify"}; places from Geoapify. Nothing here is in the Plan.</li>
        </ol>
      )}

      {status === "OPEN" && (
        <>
          <p className="mt-3 text-[12px] text-muted-foreground">Just an idea. The Plan hasn&apos;t changed and nobody has been asked yet.</p>
          {error && <p className="mt-2 text-[11px] text-danger">{error}</p>}
          <div className="mt-3 flex flex-wrap gap-2">
            {!open && (
              <button type="button" onClick={() => setOpen(true)} className="btn btn-ghost" data-see-idea>
                See the idea
              </button>
            )}
            <button type="button" disabled={pending} onClick={() => run(() => proposeIdeaAction(idea.suggestionId))} className="btn btn-primary" data-propose-idea>
              {pending ? "Proposing…" : "Propose to group"}
            </button>
            <button type="button" disabled={pending} onClick={() => run(async () => ({ ok: (await dismissIdeaAction(idea.suggestionId)).ok }))} className="btn btn-ghost" data-dismiss-idea>
              Not now
            </button>
          </div>
        </>
      )}
      {status === "PROPOSED" && <p className="mt-3 text-[12.5px] font-medium">Proposed to the group ✓ <span className="font-normal text-muted-foreground">· the votes are in the card below. The Plan changes only after everyone&apos;s in and it&apos;s confirmed.</span></p>}
      {status === "CONFIRMED" && <p className="mt-3 text-[12.5px] font-medium text-success">In the Plan ✓</p>}
    </div>
  );
}
