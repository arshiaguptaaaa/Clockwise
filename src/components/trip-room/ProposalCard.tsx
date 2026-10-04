"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import { castApprovalVoteAction, organiserHardConfirmAction, cancelProposalAction } from "@/app/proposal-actions";
import { PersonFace, firstName } from "@/components/decisions/People";
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
    <ul className="mt-3.5 flex flex-wrap gap-x-5 gap-y-2">
      {approvals.map((a) => (
        <li key={a.userId} className="flex items-center gap-1.5 text-[13px]">
          <PersonFace userId={a.userId} name={a.name} className={`size-6 ${a.decision === "PENDING" ? "opacity-50 grayscale" : ""}`} />
          <span className="font-medium text-foreground">{firstName(a.name)}</span>
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
  const agreed = status === "APPROVED";
  const done = status === "CONFIRMED" || status === "EXECUTED";
  const replaced = status === "CANCELLED";
  const oneClick = proposal.kind === "reschedule" || proposal.kind === "place";

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
      <div id={`proposal-${proposal.id}`} className="tile-in w-full max-w-md border-l-[3px] border-success bg-success-tint/50 py-4 pl-4 pr-3 sm:max-w-lg" data-proposal-card>
        <p className="eyebrow !text-success">◷ Everyone&apos;s in.</p>
        <p className="mt-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">{proposal.headline}</p>
        <p className="mt-1 flex flex-wrap items-baseline gap-x-3 font-display text-[34px] leading-[1.02] tracking-[-0.02em]">
          <span className="text-muted-foreground line-through decoration-[1.5px]">{proposal.change.from}</span>
          <span>{proposal.change.to} <span className="text-success">✓</span></span>
        </p>
        <p className="mt-2 text-[13px] text-muted-foreground">Plan updated.</p>
        <People approvals={proposal.approvals} />
      </div>
    );
  }

  return (
    <div id={`proposal-${proposal.id}`} className="w-full max-w-md border-l-[3px] border-accent bg-surface-muted/60 py-4 pl-4 pr-3 sm:max-w-lg" data-proposal-card>
      <div className="flex flex-wrap items-center gap-x-2">
        <span className="eyebrow !text-accent-strong">◷ Clockwise</span>
        <span className="eyebrow">· {proposal.retry ? "One more try" : done ? "Confirmed" : agreed ? "Everyone's in" : "Proposal"}</span>
      </div>

      {proposal.change ? (
        <>
          <p className="mt-2.5 text-[11px] font-semibold uppercase tracking-[0.2em] text-foreground">Move {proposal.headline}?</p>
          <p className="mt-1 flex flex-wrap items-baseline gap-x-3 font-display text-[32px] leading-[1.02] tracking-[-0.02em]">
            <span className="text-muted-foreground line-through decoration-[1.5px]">{proposal.change.from}</span>
            <span className="text-muted-foreground">→</span>
            <span>{proposal.change.to}{agreed || done ? <span className="text-success"> ✓</span> : <span className="text-muted-foreground"> ?</span>}</span>
          </p>
        </>
      ) : (
        <p className="mt-2.5 font-display text-[24px] leading-[1.1] tracking-[-0.01em] text-foreground">{proposal.title}</p>
      )}
      <p className="mt-2 text-[13.5px] leading-snug text-muted-foreground">{proposal.summary}</p>

      {!proposal.change && (proposal.payload.pickup || proposal.payload.destination || proposal.payload.timing || proposal.payload.price) && (
        <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1.5 text-xs">
          {proposal.payload.pickup && <div><span className="text-muted-foreground">Pickup: </span><span className="font-medium">{proposal.payload.pickup}</span></div>}
          {proposal.payload.destination && <div><span className="text-muted-foreground">Destination: </span><span className="font-medium">{proposal.payload.destination}</span></div>}
          {proposal.payload.timing && <div><span className="text-muted-foreground">Timing: </span><span className="font-medium">{proposal.payload.timing}</span></div>}
          {proposal.payload.price && <div><span className="text-muted-foreground">Price: </span><span className="font-medium">{proposal.payload.price}</span></div>}
        </div>
      )}

      <People approvals={proposal.approvals} />

      {/* Proposal is not Plan: say exactly which one this is. */}
      {open && <p className="mt-3 text-[12px] text-muted-foreground">Proposed. The Plan hasn&apos;t changed.</p>}
      {agreed && <p className="mt-3 text-[12.5px] font-medium text-success">Everyone accepted ✓ <span className="font-normal text-muted-foreground">· the Plan changes when {isOrganiser ? "you confirm" : `${firstName(organiserName)} confirms`}.</span></p>}
      {status === "REJECTED" && <p className="mt-3 text-[12.5px] text-danger">Not everyone could make it. The Plan hasn&apos;t changed.</p>}
      {status === "EXECUTED" && proposal.executionResult && !proposal.change && <p className="mt-3 text-[12.5px] text-success">✓ {proposal.executionResult}</p>}
      {status === "FAILED" && proposal.failureReason && (
        <p className="mt-3 flex items-center gap-1.5 text-xs text-danger"><AlertTriangle className="size-3.5" /> {proposal.failureReason}</p>
      )}

      {error && <p className="mt-2 text-[11px] text-danger">{error}</p>}

      {canVote && open && myApproval?.decision === "PENDING" && (
        <div className="mt-3.5 flex gap-2">
          <button type="button" disabled={isPending} onClick={() => vote("APPROVED")} className="cursor-pointer rounded-full bg-accent px-6 py-2 text-[12px] font-semibold tracking-[0.12em] text-accent-foreground transition-opacity hover:opacity-90 disabled:opacity-50">ACCEPT</button>
          <button type="button" disabled={isPending} onClick={() => vote("REJECTED")} className="cursor-pointer rounded-full border border-foreground/25 px-6 py-2 text-[12px] font-semibold tracking-[0.12em] hover:border-foreground disabled:opacity-50">CAN&apos;T</button>
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
          {isPending ? "UPDATING…" : agreed ? (proposal.kind === "reschedule" ? "UPDATE PLAN" : "MAKE IT OFFICIAL") : "Confirm without waiting"}
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
