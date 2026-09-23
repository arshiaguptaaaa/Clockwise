"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, XCircle, Circle, ShieldCheck, AlertTriangle } from "lucide-react";
import { avatarColor } from "@/lib/avatar";
import { castApprovalVoteAction, organiserHardConfirmAction, cancelProposalAction } from "@/app/proposal-actions";

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
};

const STATUS_STYLE: Record<string, { label: string; className: string }> = {
  AWAITING_APPROVAL: { label: "Awaiting votes", className: "bg-warning-tint text-warning" },
  APPROVED: { label: "Group approved", className: "bg-success-tint text-success" },
  REJECTED: { label: "Group rejected", className: "bg-danger-tint text-danger" },
  CONFIRMED: { label: "Organiser confirmed", className: "bg-accent-tint text-accent-strong" },
  EXECUTED: { label: "Added to Plan", className: "bg-success-tint text-success" },
  FAILED: { label: "Confirmed, but failed", className: "bg-danger-tint text-danger" },
  CANCELLED: { label: "Cancelled", className: "bg-surface-muted text-muted-foreground" },
};

const VOTABLE = ["AWAITING_APPROVAL", "APPROVED", "REJECTED"];
const CONFIRMABLE = ["AWAITING_APPROVAL", "APPROVED", "FAILED"];

function DecisionIcon({ decision }: { decision: ProposalCardApproval["decision"] }) {
  if (decision === "APPROVED") return <CheckCircle2 className="size-3.5 text-success" />;
  if (decision === "REJECTED") return <XCircle className="size-3.5 text-danger" />;
  return <Circle className="size-3.5 text-muted-foreground" />;
}

export function ProposalCard({
  proposal,
  viewerId,
  isOrganiser,
}: {
  proposal: ProposalCardData;
  viewerId: string | null;
  isOrganiser: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirmStep, setConfirmStep] = useState(false);

  const status = STATUS_STYLE[proposal.status] ?? { label: proposal.status, className: "bg-surface-muted text-muted-foreground" };
  const myApproval = viewerId ? proposal.approvals.find((a) => a.userId === viewerId) : undefined;
  const canVote = Boolean(myApproval) && VOTABLE.includes(proposal.status);
  const canConfirm = isOrganiser && CONFIRMABLE.includes(proposal.status);
  const canCancel = isOrganiser && ["AWAITING_APPROVAL", "APPROVED", "REJECTED", "FAILED"].includes(proposal.status);

  function vote(decision: "APPROVED" | "REJECTED") {
    setError(null);
    startTransition(async () => {
      const result = await castApprovalVoteAction(proposal.id, decision);
      if (!result.ok) setError(result.error);
      else router.refresh();
    });
  }

  function confirm() {
    setError(null);
    startTransition(async () => {
      const result = await organiserHardConfirmAction(proposal.id);
      setConfirmStep(false);
      if (!result.ok) setError(result.error);
      else router.refresh();
    });
  }

  function cancel() {
    setError(null);
    startTransition(async () => {
      const result = await cancelProposalAction(proposal.id);
      if (!result.ok) setError(result.error);
      else router.refresh();
    });
  }

  return (
    <div className="w-full max-w-md rounded-2xl border border-border bg-surface px-4 py-3.5 sm:max-w-lg">
      <div className="flex items-start gap-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground">
          <ShieldCheck className="size-4" strokeWidth={2} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="text-xs font-medium text-accent-strong">Clockwise</span>
            <span className="text-[11px] text-muted-foreground">· Proposal</span>
            <span className={`ml-auto rounded-full px-1.5 py-0.5 text-[10px] font-medium ${status.className}`}>
              {status.label}
            </span>
          </div>

          <p className="mt-1 text-sm font-medium leading-snug text-foreground">{proposal.title}</p>
          <p className="mt-0.5 text-sm leading-snug text-muted-foreground">{proposal.summary}</p>

          {(proposal.payload.pickup || proposal.payload.destination || proposal.payload.timing || proposal.payload.price) && (
            <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1.5">
              {proposal.payload.pickup && (
                <div className="text-xs">
                  <span className="text-muted-foreground">Pickup: </span>
                  <span className="font-medium text-foreground">{proposal.payload.pickup}</span>
                </div>
              )}
              {proposal.payload.destination && (
                <div className="text-xs">
                  <span className="text-muted-foreground">Destination: </span>
                  <span className="font-medium text-foreground">{proposal.payload.destination}</span>
                </div>
              )}
              {proposal.payload.timing && (
                <div className="text-xs">
                  <span className="text-muted-foreground">Timing: </span>
                  <span className="font-medium text-foreground">{proposal.payload.timing}</span>
                </div>
              )}
              {proposal.payload.price && (
                <div className="text-xs">
                  <span className="text-muted-foreground">Price: </span>
                  <span className="font-medium text-foreground">{proposal.payload.price}</span>
                </div>
              )}
            </div>
          )}

          {proposal.approvals.length > 0 && (
            <div className="mt-2.5 flex flex-wrap gap-x-3 gap-y-1">
              {proposal.approvals.map((a) => {
                const color = avatarColor(a.name);
                return (
                  <div key={a.userId} className="flex items-center gap-1 text-[11px]">
                    <span
                      className="flex size-4 items-center justify-center rounded-full text-[8px] font-medium"
                      style={{ backgroundColor: color.bg, color: color.text }}
                    >
                      {a.name.slice(0, 1)}
                    </span>
                    <DecisionIcon decision={a.decision} />
                    <span className="text-muted-foreground">{a.name}</span>
                  </div>
                );
              })}
            </div>
          )}

          {proposal.status === "EXECUTED" && proposal.executionResult && (
            <p className="mt-2.5 flex items-center gap-1.5 text-xs text-success">
              <CheckCircle2 className="size-3.5" /> {proposal.executionResult}
            </p>
          )}
          {proposal.status === "FAILED" && proposal.failureReason && (
            <p className="mt-2.5 flex items-center gap-1.5 text-xs text-danger">
              <AlertTriangle className="size-3.5" /> {proposal.failureReason}
            </p>
          )}

          {error && <p className="mt-2 text-[11px] text-danger">{error}</p>}

          {canVote && (
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={isPending}
                onClick={() => vote("APPROVED")}
                className={`cursor-pointer rounded-full px-3.5 py-1.5 text-xs font-medium transition-opacity disabled:cursor-not-allowed disabled:opacity-50 ${
                  myApproval?.decision === "APPROVED"
                    ? "bg-success text-white"
                    : "border border-border text-muted-foreground hover:border-success hover:text-success"
                }`}
              >
                Approve
              </button>
              <button
                type="button"
                disabled={isPending}
                onClick={() => vote("REJECTED")}
                className={`cursor-pointer rounded-full px-3.5 py-1.5 text-xs font-medium transition-opacity disabled:cursor-not-allowed disabled:opacity-50 ${
                  myApproval?.decision === "REJECTED"
                    ? "bg-danger text-white"
                    : "border border-border text-muted-foreground hover:border-danger hover:text-danger"
                }`}
              >
                Reject
              </button>
            </div>
          )}

          {/* Deliberately never the same button as voting, and never a
              single click — the organiser must see exactly what they're
              about to authorize before a second, distinctly-labelled
              click actually confirms it. */}
          {canConfirm && !confirmStep && (
            <button
              type="button"
              onClick={() => setConfirmStep(true)}
              className="mt-3 cursor-pointer rounded-full border border-accent px-3.5 py-1.5 text-xs font-medium text-accent-strong transition-colors hover:bg-accent-tint"
            >
              Review &amp; give final confirmation
            </button>
          )}
          {canConfirm && confirmStep && (
            <div className="mt-3 rounded-xl border border-accent bg-accent-tint px-3 py-2.5">
              <p className="text-xs font-medium text-accent-strong">
                This will apply now: &ldquo;{proposal.title}&rdquo; — {proposal.summary}
              </p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Only you, as organiser, can do this. Member votes above are informational — this is the actual authorization.
              </p>
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  disabled={isPending}
                  onClick={confirm}
                  className="cursor-pointer rounded-full bg-accent px-3.5 py-1.5 text-xs font-medium text-accent-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isPending ? "Confirming…" : "Yes, confirm and apply"}
                </button>
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => setConfirmStep(false)}
                  className="cursor-pointer rounded-full border border-border px-3.5 py-1.5 text-xs font-medium text-muted-foreground hover:border-foreground hover:text-foreground"
                >
                  Not yet
                </button>
              </div>
            </div>
          )}

          {canCancel && !confirmStep && (
            <button
              type="button"
              disabled={isPending}
              onClick={cancel}
              className="mt-2 cursor-pointer text-[11px] text-muted-foreground hover:text-danger disabled:cursor-not-allowed disabled:opacity-50"
            >
              Cancel this proposal
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
