"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { castApprovalVoteAction, organiserHardConfirmAction } from "@/app/proposal-actions";
import { ReasonForm } from "./ReasonForm";
import { PersonFace, firstName } from "./People";
import type { DecisionView } from "@/lib/decisions";

type Props = {
  tripId: string;
  viewerId: string;
  organiserId: string;
  organiserName: string;
  decisions: DecisionView[];
};

function readFlag(key: string): boolean {
  try {
    return sessionStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}
function setFlag(key: string) {
  try {
    sessionStorage.setItem(key, "1");
  } catch {
    // storage unavailable: the strip simply re-shows, which is harmless
  }
}

const waitingNames = (d: DecisionView, viewerId: string) =>
  d.people.filter((p) => p.decision === "PENDING" && p.userId !== viewerId).map((p) => firstName(p.name));

const joinNames = (n: string[]) => (n.length <= 1 ? (n[0] ?? "") : `${n.slice(0, -1).join(", ")} and ${n.at(-1)}`);

function Subject({ d }: { d: DecisionView }) {
  return (
    <span className="font-display text-[22px] leading-[1.1] tracking-[-0.01em] text-foreground">
      {d.headline}
      {d.change && (
        <>
          <span className="text-muted-foreground"> · </span>
          <span className="text-muted-foreground line-through decoration-[1px]">{d.change.from}</span>
          <span className="text-muted-foreground"> → </span>
          <span>{d.change.to}</span>
        </>
      )}
    </span>
  );
}

function ClockMark() {
  return <span aria-hidden className="text-[13px] text-accent-strong">◷</span>;
}

function Decision({ d, viewerId, organiserId, organiserName, compact, index }: { d: DecisionView; viewerId: string; organiserId: string; organiserName: string; compact?: boolean; index?: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [telling, setTelling] = useState(false);
  const declKey = `cw-declined-${d.id}`;
  const inKey = `cw-in-${d.id}`;
  const [declinedClosed, setDeclinedClosed] = useState(false);
  const [inSeen, setInSeen] = useState(true);

  // Session flags live in the browser only, so they are read after mount.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const t0 = setTimeout(() => {
      setDeclinedClosed(readFlag(declKey));
      const seen = readFlag(inKey);
      setInSeen(seen);
      if (d.mine === "APPROVED" && d.stage === "PROPOSED" && !seen) {
        timer = setTimeout(() => {
          setFlag(inKey);
          setInSeen(true);
        }, 6000);
      }
    }, 0);
    return () => {
      clearTimeout(t0);
      if (timer) clearTimeout(timer);
    };
  }, [d.id, d.mine, d.stage, declKey, inKey]);

  function vote(decision: "APPROVED" | "REJECTED") {
    setError(null);
    start(async () => {
      const r = await castApprovalVoteAction(d.id, decision);
      if (!r.ok) setError(r.error);
      else router.refresh();
    });
  }
  function makeOfficial() {
    setError(null);
    start(async () => {
      const r = await organiserHardConfirmAction(d.id);
      if (!r.ok) setError(r.error);
      else router.refresh();
    });
  }

  const wait = waitingNames(d, viewerId);
  const isOrganiser = viewerId === organiserId;
  const num = index != null ? <span className="mr-2 font-display text-[13px] text-muted-foreground">{String(index + 1).padStart(2, "0")}</span> : null;

  // 1. A decision is waiting on me.
  if (d.stage === "PROPOSED" && d.mine === "PENDING") {
    return (
      <div>
        {!compact && <p className="eyebrow !text-accent-strong"><ClockMark /> A decision&apos;s waiting</p>}
        <div className={compact ? "" : "mt-1.5"}>{num}<Subject d={d} /></div>
        <div className="mt-2.5 flex items-center gap-2">
          <span className="mr-1 text-[13px] text-muted-foreground">Do you accept?</span>
          <button type="button" disabled={pending} onClick={() => vote("APPROVED")} className="cursor-pointer rounded-full bg-accent px-5 py-1.5 text-[12px] font-semibold tracking-[0.12em] text-accent-foreground transition-opacity hover:opacity-90 disabled:opacity-50">YES</button>
          <button type="button" disabled={pending} onClick={() => vote("REJECTED")} className="cursor-pointer rounded-full border border-foreground/25 px-5 py-1.5 text-[12px] font-semibold tracking-[0.12em] text-foreground transition-colors hover:border-foreground disabled:opacity-50">CAN&apos;T</button>
          <DecisionLink d={d} />
        </div>
        {error && <p className="mt-1.5 text-[11.5px] text-danger">{error}</p>}
      </div>
    );
  }

  // 2. I said no: acknowledge it, and offer (never require) a reason.
  if (d.stage === "PROPOSED" && d.mine === "REJECTED" && !declinedClosed) {
    return (
      <div>
        <p className="eyebrow !text-danger">{d.change ? `You can't make ${d.change.to}` : "You can't make this one"}</p>
        {!telling ? (
          <div className="mt-2 flex items-center gap-3">
            <button type="button" onClick={() => setTelling(true)} className="cursor-pointer rounded-full border border-foreground/25 px-4 py-1.5 text-[11.5px] font-semibold tracking-[0.12em] hover:border-foreground">TELL CLOCKWISE WHY</button>
            <button type="button" onClick={() => { setFlag(declKey); setDeclinedClosed(true); }} className="cursor-pointer text-[12px] text-muted-foreground hover:text-foreground">Not now</button>
          </div>
        ) : (
          <ReasonForm proposalId={d.id} onDone={() => { setFlag(declKey); setDeclinedClosed(true); setTelling(false); }} onCancel={() => setTelling(false)} />
        )}
        {error && <p className="mt-1.5 text-[11.5px] text-danger">{error}</p>}
      </div>
    );
  }

  // 3. Everyone agreed. The Plan has not changed yet: the organiser makes it official.
  if (d.stage === "AGREED") {
    if (isOrganiser) {
      return (
        <div>
          <p className="eyebrow !text-accent-strong"><ClockMark /> Everyone&apos;s in.</p>
          <div className="mt-1.5">{num}<Subject d={d} /></div>
          <div className="mt-2.5 flex items-center gap-2">
            <span className="mr-1 text-[13px] text-muted-foreground">Make it official?</span>
            {d.kind === "reschedule" || d.kind === "place" ? (
              <button type="button" disabled={pending} onClick={makeOfficial} className="cursor-pointer rounded-full bg-accent px-5 py-1.5 text-[12px] font-semibold tracking-[0.12em] text-accent-foreground hover:opacity-90 disabled:opacity-50">{pending ? "UPDATING…" : d.kind === "reschedule" ? "UPDATE PLAN" : "ADD TO PLAN"}</button>
            ) : (
              <button type="button" onClick={() => document.getElementById(`proposal-${d.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" })} className="cursor-pointer rounded-full bg-accent px-5 py-1.5 text-[12px] font-semibold tracking-[0.12em] text-accent-foreground hover:opacity-90">REVIEW</button>
            )}
            <DecisionLink d={d} />
          </div>
          {error && <p className="mt-1.5 text-[11.5px] text-danger">{error}</p>}
        </div>
      );
    }
    return <SlimLine d={d}>Everyone agreed · waiting for {firstName(organiserName)} to confirm</SlimLine>;
  }

  // 4. I'm in; for a few seconds say so, then get out of the way.
  if (d.stage === "PROPOSED" && d.mine === "APPROVED") {
    if (!inSeen) {
      return (
        <div>
          <p className="eyebrow !text-success">You&apos;re in ✓</p>
          <div className="mt-1.5">{num}<Subject d={d} /></div>
          {wait.length > 0 && <p className="mt-1 text-[13px] text-muted-foreground">Waiting for {joinNames(wait)}</p>}
        </div>
      );
    }
    return <SlimLine d={d}>{d.headline} {d.kind === "reschedule" ? "change" : "decision"} · waiting on {joinNames(wait) || "the group"}</SlimLine>;
  }

  // 5. Someone else's vote, or my own no that I've closed.
  return <SlimLine d={d}>{d.headline} · {wait.length ? `waiting on ${joinNames(wait)}` : "in progress"}</SlimLine>;
}

function DecisionLink({ d }: { d: DecisionView }) {
  return (
    <Link href={`#proposal-${d.id}`} scroll className="ml-auto text-[12px] text-muted-foreground underline-offset-4 hover:text-foreground hover:underline" onClick={(e) => {
      const el = document.getElementById(`proposal-${d.id}`);
      if (el) { e.preventDefault(); el.scrollIntoView({ behavior: "smooth", block: "center" }); }
    }}>See it</Link>
  );
}

function SlimLine({ d, children }: { d: DecisionView; children: React.ReactNode }) {
  return (
    <p className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
      <span className="inline-flex -space-x-1.5">
        {d.people.filter((p) => p.decision === "APPROVED").slice(0, 4).map((p) => <PersonFace key={p.userId} userId={p.userId} name={p.name} className="size-4 rounded-full ring-1 ring-surface" />)}
      </span>
      <span>{children}</span>
    </p>
  );
}

export function DecisionStrip({ tripId, viewerId, organiserId, organiserName, decisions }: Props) {
  const [open, setOpen] = useState(false);
  const attention = decisions.filter((d) => (d.stage === "PROPOSED" && d.mine === "PENDING") || (d.stage === "AGREED" && viewerId === organiserId));
  const rest = decisions.filter((d) => !attention.includes(d));
  void tripId;
  if (decisions.length === 0) return null;
  const shared = { viewerId, organiserId, organiserName };

  return (
    <div className="shrink-0 border-b border-border bg-accent-tint/70 px-5 py-3.5" data-decision-strip>
      {attention.length > 1 ? (
        <div>
          <div className="flex items-center justify-between">
            <p className="eyebrow !text-accent-strong"><ClockMark /> {attention.length} decisions waiting</p>
            <button type="button" onClick={() => setOpen((v) => !v)} className="cursor-pointer rounded-full border border-foreground/25 px-4 py-1 text-[11.5px] font-semibold tracking-[0.12em] hover:border-foreground">{open ? "HIDE" : "REVIEW"}</button>
          </div>
          {open && (
            <ol className="mt-3 space-y-4 border-t border-foreground/10 pt-3">
              {attention.map((d, i) => (
                <li key={d.id}><Decision d={d} compact index={i} {...shared} /></li>
              ))}
            </ol>
          )}
        </div>
      ) : attention.length === 1 ? (
        <Decision d={attention[0]} {...shared} />
      ) : null}
      {rest.length > 0 && (
        <div className={attention.length ? "mt-3 space-y-1.5 border-t border-foreground/10 pt-2.5" : "space-y-1.5"}>
          {rest.map((d) => (
            <Decision key={d.id} d={d} {...shared} />
          ))}
        </div>
      )}
    </div>
  );
}
