"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import { castApprovalVoteAction, organiserHardConfirmAction, cancelProposalAction } from "@/app/proposal-actions";
import { PersonFace, firstName } from "@/components/decisions/People";
import { HUMAN } from "@/lib/copy";
import { ReasonForm } from "@/components/decisions/ReasonForm";

export type ProposalCardPayload = {
  pickup?: string;
  destination?: string;
  timing?: string;
  price?: string;
  amount?: number;
  currency?: string;
  provider?: string;
  cancellationTerms?: string;
  peopleAffected?: string[];
  split?: { totalMinor: number; lines: { userId: string; name: string; amountMinor: number; alreadyPaid: boolean }[] };
  idea?: { title: string; steps: { name: string; at: string | null; location: string | null }[] };
};

export type ProposalCardApproval = { userId: string; name: string; decision: "PENDING" | "APPROVED" | "REJECTED" };

export type ProposalCardData = {
  id: string;
  status: string;
  title: string;
  summary: string;
  payload: ProposalCardPayload;
  executionResult: string | null;
  failureReason: string | null;
  approvals: ProposalCardApproval[];
  // Server-computed (so this client file stays free of server-only imports).
  headline: string;
  kind: "reschedule" | "place" | "stay" | "ride" | "payment" | "other";
  change: { from: string; to: string } | null;
  because: string | null;
  retry: boolean;
};

const VOTABLE = ["AWAITING_APPROVAL", "APPROVED", "REJECTED"];
const CONFIRMABLE = ["AWAITING_APPROVAL", "APPROVED", "FAILED"];

function State({ decision }: { decision: ProposalCardApproval["decision"] }) {
  if (decision === "APPROVED") return <span className="text-success">✓</span>;
  if (decision === "REJECTED") return <span className="text-danger">can&apos;t</span>;
  return <span className="text-muted-foreground">waiting</span>;
}

// Who has said what: faces and first names, never "2/3 votes".
function People({ approvals }: { approvals: ProposalCardApproval[] }) {
  if (approvals.length === 0) return null;
  return (
    <ul className="mt-4 flex flex-wrap gap-x-5 gap-y-2.5">
      {approvals.map((a) => (
        <li key={`${a.userId}-${a.decision}`} className="vote-in flex items-center gap-2 text-[13px]">
          <PersonFace userId={a.userId} name={a.name} className={`size-7 transition-[filter,opacity] duration-300 ${a.decision === "PENDING" ? "opacity-50 grayscale" : ""}`} />
          <span className="text-[11.5px] font-semibold uppercase tracking-[0.12em] text-foreground">{firstName(a.name)}</span>
          <State decision={a.decision} />
        </li>
      ))}
    </ul>
  );
}

export function ProposalCard({
  proposal,
  viewerId,
  isOrganiser,
  organiserName,
}: {
  proposal: ProposalCardData;
  viewerId: string | null;
  isOrganiser: boolean;
  organiserName: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [telling, setTelling] = useState(false);
  const [confirmStep, setConfirmStep] = useState(false);

  const status = proposal.status;
  const myApproval = viewerId ? proposal.approvals.find((a) => a.userId === viewerId) : undefined;
  const canVote = Boolean(myApproval) && VOTABLE.includes(status) && status !== "REJECTED";
  const canConfirm = isOrganiser && CONFIRMABLE.includes(status);
  const canCancel = isOrganiser && ["AWAITING_APPROVAL", "APPROVED", "REJECTED", "FAILED"].includes(status);
  const open = status === "AWAITING_APPROVAL";
  const waiting = proposal.approvals.filter((a) => a.decision === "PENDING");
  // Only when exactly one person is holding things up, and never says it to them.
  const lookingAt = open && waiting.length === 1 && waiting[0].userId !== viewerId ? waiting[0] : null;
  const agreed = status === "APPROVED";
  const done = status === "CONFIRMED" || status === "EXECUTED";
  const replaced = status === "CANCELLED";
  // Creating a split payment charges nothing (each person's own link is made when they press PAY), so it is one tap too.
  const oneClick = proposal.kind === "reschedule" || proposal.kind === "place" || Boolean(proposal.payload.split) || Boolean(proposal.payload.idea);

  function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    startTransition(async () => {
      const result = await fn();
      if (!result.ok) setError(result.error ?? "That didn't work.");
      else router.refresh();
    });
  }
  const vote = (d: "APPROVED" | "REJECTED") => run(() => castApprovalVoteAction(proposal.id, d));

  // Replaced by a newer suggestion, or withdrawn: stays in the story, quietly.
  if (replaced) {
    return (
      <div id={`proposal-${proposal.id}`} className="border-l border-border py-1 pl-4 text-[12.5px] text-muted-foreground" data-proposal-card>
        <span className="line-through decoration-[1px]">{proposal.title}</span> — replaced.
      </div>
    );
  }

  // The moment everyone is in and the Plan has genuinely changed.
  if (done && proposal.change) {
    return (
      <div id={`proposal-${proposal.id}`} className="settle w-full max-w-md border-l-[3px] border-success py-5 pl-4 pr-3 sm:max-w-lg" data-proposal-card>
        <p className="eyebrow !text-success"><span className="cw-mark !text-success">◷</span> Everyone&apos;s aligned ✓</p>
        <p className="mt-3 text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">{proposal.headline}</p>
        <p className="t-number mt-1 flex flex-wrap items-baseline gap-x-3 text-[44px]">
          <span className="text-[26px] text-muted-foreground line-through decoration-[1.5px]">{proposal.change.from}</span>
          <span>{proposal.change.to}</span>
        </p>
        <p className="mt-2 text-[13px] text-muted-foreground">Plan updated.</p>
        <People approvals={proposal.approvals} />
        {proposal.approvals.length >= 3 && proposal.approvals.every((a) => a.decision === "APPROVED") && <p className="mt-2 font-display text-[16px] italic text-muted-foreground">{HUMAN.unanimous}</p>}
      </div>
    );
  }

  return (
    <div id={`proposal-${proposal.id}`} key={status} className="vote-in w-full max-w-md border-l-[3px] border-accent bg-surface-muted/70 py-5 pl-4 pr-3 sm:max-w-lg" data-proposal-card>
      <p className="eyebrow !text-accent-strong">
        <span className="cw-mark">◷</span>{" "}
        {proposal.retry ? "One more try." : agreed ? "Everyone's aligned" : open ? "Clockwise proposed ✦" : "A decision"}
      </p>

      {proposal.change ? (
        <>
          {proposal.because && <p className="mt-2 font-display text-[19px] leading-snug tracking-[-0.01em]" data-because>{proposal.because}. {proposal.headline} is at {proposal.change.from}.</p>}
          <p className="mt-4 text-[11px] font-semibold uppercase tracking-[0.22em] text-foreground">{proposal.change.to === "Cancelled" ? "Cancel" : "Move"} {proposal.headline}?</p>
          <p className="t-number mt-1.5 flex flex-wrap items-baseline gap-x-3 text-[46px]" data-change>
            <span className="text-[26px] text-muted-foreground line-through decoration-[1.5px]">{proposal.change.from}</span>
            <span className="text-[24px] text-muted-foreground">→</span>
            <span>{proposal.change.to}{agreed || done ? <span className="text-success"> ✓</span> : <span className="text-muted-foreground"> ?</span>}</span>
          </p>
          {!proposal.because && <p className="mt-2 text-[13.5px] leading-snug text-muted-foreground">{proposal.summary}</p>}
        </>
      ) : (
        <>
          <p className="mt-2.5 font-display text-[26px] leading-[1.08] tracking-[-0.015em] text-foreground">{proposal.title}</p>
          <p className="mt-2 text-[13.5px] leading-snug text-muted-foreground">{proposal.summary}</p>
        </>
      )}

      {proposal.payload.idea && (
        <ol className="mt-3 space-y-1.5" data-idea-steps>
          {proposal.payload.idea.steps.map((s, i) => (
            <li key={i} className="flex items-baseline gap-3 text-[14px]">
              <span className="t-number w-[4.5rem] shrink-0 text-right text-[15px] text-muted-foreground">{s.at ? new Date(`${s.at}:00Z`).toLocaleTimeString("en-GB", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "UTC" }).toUpperCase() : ""}</span>
              <span className="font-medium">{s.name}</span>
            </li>
          ))}
        </ol>
      )}

      {proposal.payload.split && (
        <div className="mt-3" data-split>
          <p className="eyebrow">Here&apos;s the split</p>
          <ul className="mt-1.5 space-y-1">
            {proposal.payload.split.lines.map((l) => (
              <li key={l.userId} className="flex items-baseline justify-between gap-3 text-[14px]">
                <span className="font-medium">{l.name.split(" ")[0]}</span>
                <span className="font-display text-[17px]">₹{(l.amountMinor / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}{l.alreadyPaid && <span className="ml-1.5 font-sans text-[11px] text-success">already paid</span>}</span>
              </li>
            ))}
          </ul>
          <p className="mt-1.5 border-t border-border pt-1.5 text-[13px]"><span className="font-semibold">₹{(proposal.payload.split.totalMinor / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })} total</span> <span className="text-success">✓ adds up</span></p>
        </div>
      )}

      {!proposal.change && !proposal.payload.split && (proposal.payload.pickup || proposal.payload.destination || proposal.payload.timing || proposal.payload.price) && (
        <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1.5 text-xs">
          {proposal.payload.pickup && <div><span className="text-muted-foreground">Pickup: </span><span className="font-medium">{proposal.payload.pickup}</span></div>}
          {proposal.payload.destination && <div><span className="text-muted-foreground">Destination: </span><span className="font-medium">{proposal.payload.destination}</span></div>}
          {proposal.payload.timing && <div><span className="text-muted-foreground">Timing: </span><span className="font-medium">{proposal.payload.timing}</span></div>}
          {proposal.payload.price && <div><span className="text-muted-foreground">Price: </span><span className="font-medium">{proposal.payload.price}</span></div>}
        </div>
      )}

      <People approvals={proposal.approvals} />

      {/* Proposal is not Plan: say exactly which one this is. */}
      {open && <p className="mt-3 text-[12px] text-muted-foreground">Proposed. The Plan hasn&apos;t changed.{lookingAt && <> <span className="font-display italic">{HUMAN.lookingAt(firstName(lookingAt.name))}</span></>}</p>}
      {agreed && <p className="mt-3 text-[12.5px] font-medium text-success">Everyone accepted ✓ <span className="font-normal text-muted-foreground">· the Plan changes when {isOrganiser ? "you confirm" : `${firstName(organiserName)} confirms`}.</span></p>}
      {status === "REJECTED" && <p className="mt-3 text-[12.5px] text-danger">Not everyone could make it. The Plan hasn&apos;t changed.</p>}
      {status === "EXECUTED" && proposal.executionResult && !proposal.change && <p className="mt-3 text-[12.5px] text-success">✓ {proposal.executionResult}</p>}
      {status === "FAILED" && proposal.failureReason && (
        <p className="mt-3 flex items-center gap-1.5 text-xs text-danger"><AlertTriangle className="size-3.5" /> {proposal.failureReason}</p>
      )}

      {error && <p className="mt-2 text-[11px] text-danger">{error}</p>}

      {canVote && open && myApproval?.decision === "PENDING" && (
        <div className="mt-4 grid grid-cols-2 gap-2.5">
          <button type="button" disabled={isPending} onClick={() => vote("APPROVED")} className="btn btn-primary">Accept</button>
          <button type="button" disabled={isPending} onClick={() => vote("REJECTED")} className="btn btn-ghost">Decline</button>
        </div>
      )}
      {canVote && open && myApproval?.decision === "APPROVED" && (
        <p className="mt-3 text-[12px] text-muted-foreground">You&apos;re in. <button type="button" disabled={isPending} onClick={() => vote("REJECTED")} className="cursor-pointer underline underline-offset-4 hover:text-foreground">Change my answer</button></p>
      )}
      {open && myApproval?.decision === "REJECTED" && (
        <div className="mt-3">
          <p className="text-[12px] text-muted-foreground">You can&apos;t make this one. <button type="button" disabled={isPending} onClick={() => vote("APPROVED")} className="cursor-pointer underline underline-offset-4 hover:text-foreground">Actually, I can</button></p>
          {!telling ? (
            <button type="button" onClick={() => setTelling(true)} className="mt-2 cursor-pointer rounded-full border border-foreground/25 px-4 py-1.5 text-[11.5px] font-semibold tracking-[0.12em] hover:border-foreground">TELL CLOCKWISE WHY</button>
          ) : (
            <ReasonForm proposalId={proposal.id} onDone={() => setTelling(false)} onCancel={() => setTelling(false)} />
          )}
        </div>
      )}

      {/* The organiser's authority is unchanged: the Plan moves only on their confirmation.
          Moving a plan item or agreeing on a place changes nothing external, so it is one click.
          Anything that can book, charge or request something keeps the explicit second step. */}
      {canConfirm && !confirmStep && (
        <button
          type="button"
          disabled={isPending}
          onClick={() => (oneClick ? run(() => organiserHardConfirmAction(proposal.id)) : setConfirmStep(true))}
          className={`mt-3.5 cursor-pointer rounded-full px-6 py-2 text-[12px] font-semibold tracking-[0.12em] disabled:opacity-50 ${agreed ? "bg-accent text-accent-foreground hover:opacity-90" : "border border-accent text-accent-strong hover:bg-accent-tint"}`}
        >
          {isPending ? "UPDATING…" : agreed ? (proposal.kind === "reschedule" ? "UPDATE PLAN" : proposal.payload.split ? "CREATE PAYMENT" : "MAKE IT OFFICIAL") : "Confirm without waiting"}
        </button>
      )}
      {canConfirm && confirmStep && (
        <div className="mt-3.5 rounded-xl border border-accent bg-accent-tint px-3.5 py-3">
          <p className="text-xs font-medium text-accent-strong">This will apply now: &ldquo;{proposal.title}&rdquo;. {proposal.summary}</p>
          <p className="mt-1 text-[11px] text-muted-foreground">Only you, as organiser, can do this. The votes above inform you; this is the actual authorisation.</p>
          <div className="mt-2.5 flex gap-2">
            <button type="button" disabled={isPending} onClick={() => { run(() => organiserHardConfirmAction(proposal.id)); setConfirmStep(false); }} className="cursor-pointer rounded-full bg-accent px-4 py-1.5 text-xs font-semibold text-accent-foreground hover:opacity-90 disabled:opacity-50">{isPending ? "Confirming…" : "Yes, confirm and apply"}</button>
            <button type="button" disabled={isPending} onClick={() => setConfirmStep(false)} className="cursor-pointer rounded-full border border-border px-4 py-1.5 text-xs font-medium text-muted-foreground hover:border-foreground hover:text-foreground">Not yet</button>
          </div>
        </div>
      )}

      {canCancel && (
        <button type="button" disabled={isPending} onClick={() => run(() => cancelProposalAction(proposal.id))} className="mt-2.5 block cursor-pointer text-[11px] text-muted-foreground hover:text-danger disabled:opacity-50">
          Withdraw this proposal
        </button>
      )}
    </div>
  );
}
