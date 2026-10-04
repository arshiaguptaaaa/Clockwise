// A proposal, seen as a shared decision moment. Pure presentation of facts that
// already live on Proposal / ProposalApproval: nothing here decides, approves or
// changes the Plan. The three states are never blurred:
//   PROPOSED  - votes are still coming in; the Plan is untouched
//   AGREED    - every traveller accepted; the Plan is STILL untouched until the
//               organiser makes it official (the existing hard-confirm authority)
//   CONFIRMED - the organiser confirmed and the change was applied
import type { ApprovalDecision, ProposalStatus } from "@prisma/client";
import { prisma } from "./prisma";
import { decodeProposalPayload, type ProposalPayload } from "./proposals";
import { timeLabel } from "./traveller/journey";

export type DecisionStage = "PROPOSED" | "AGREED" | "CONFIRMED" | "NOT_AGREED" | "CLOSED";

export type DecisionPerson = { userId: string; name: string; decision: ApprovalDecision };

export type DecisionView = {
  id: string;
  kind: "reschedule" | "place" | "stay" | "ride" | "payment" | "other";
  stage: DecisionStage;
  status: ProposalStatus;
  // Short subject, e.g. "Dinner" or "Cubbon Park".
  headline: string;
  // The one question, e.g. "Move dinner to 10:00 PM?".
  ask: string;
  change: { from: string; to: string } | null;
  because: string | null;
  people: DecisionPerson[];
  mine: ApprovalDecision | null;
  createdAt: string;
  executionResult: string | null;
};

export function stageOf(status: ProposalStatus): DecisionStage {
  switch (status) {
    case "AWAITING_APPROVAL":
    case "PROPOSED":
      return "PROPOSED";
    case "APPROVED":
      return "AGREED";
    case "CONFIRMED":
    case "EXECUTED":
      return "CONFIRMED";
    case "REJECTED":
      return "NOT_AGREED";
    default:
      return "CLOSED";
  }
}

export function kindOf(payload: ProposalPayload, type: string): DecisionView["kind"] {
  if (payload.reschedule) return "reschedule";
  if (payload.place) return "place";
  if (payload.split) return "payment";
  if (payload.stay || type === "BOOKING") return "stay";
  if (type === "UBER_RIDE") return "ride";
  return "other";
}

export function describeProposal(p: { title: string; type: string; payload: ProposalPayload }): Pick<DecisionView, "kind" | "headline" | "ask" | "change" | "because"> {
  const kind = kindOf(p.payload, p.type);
  const r = p.payload.reschedule;
  if (r) {
    return {
      kind,
      headline: r.commitmentName,
      ask: p.title,
      change: { from: timeLabel(r.oldTime), to: timeLabel(r.newTime) },
      because: r.because,
    };
  }
  if (p.payload.split) return { kind: "payment", headline: p.title.replace(/^Payment needed:\s*/i, "").replace(/\?$/, "").replace(/^./, (c) => c.toUpperCase()), ask: p.title, change: null, because: null };
  if (p.payload.place) return { kind, headline: p.payload.place.name, ask: p.title, change: null, because: null };
  if (p.payload.stay) return { kind, headline: p.payload.stay.name, ask: p.title, change: null, because: null };
  return { kind, headline: p.title.replace(/\?$/, ""), ask: p.title, change: null, because: null };
}

const OPEN: ProposalStatus[] = ["AWAITING_APPROVAL", "APPROVED"];

export const first = (name: string) => name.split(" ")[0];

// Proposals that still need someone: voting is open, or everyone agreed and the
// organiser has not made it official. Newest first.
export async function getOpenDecisions(tripId: string, viewerId: string | null): Promise<DecisionView[]> {
  const rows = await prisma.proposal.findMany({
    where: { tripId, status: { in: OPEN } },
    orderBy: { createdAt: "desc" },
    include: { approvals: { include: { tripMember: { include: { user: { select: { id: true, name: true } } } } } } },
  });
  return rows.map((p) => toView(p, viewerId));
}

export function toView(
  p: {
    id: string;
    type: string;
    status: ProposalStatus;
    title: string;
    payload: string;
    createdAt: Date;
    executionResult: string | null;
    approvals: { decision: ApprovalDecision; tripMember: { userId: string; user: { name: string } } }[];
  },
  viewerId: string | null
): DecisionView {
  const payload = decodeProposalPayload(p.payload);
  const people = p.approvals.map((a) => ({ userId: a.tripMember.userId, name: a.tripMember.user.name, decision: a.decision }));
  return {
    id: p.id,
    stage: stageOf(p.status),
    status: p.status,
    ...describeProposal({ title: p.title, type: p.type, payload }),
    people,
    mine: viewerId ? (people.find((x) => x.userId === viewerId)?.decision ?? null) : null,
    createdAt: p.createdAt.toISOString(),
    executionResult: p.executionResult,
  };
}

// A pending reschedule per commitment, so Plan can show the proposed time without
// treating it as canonical.
export async function pendingReschedules(tripId: string): Promise<Map<string, { to: string; proposalId: string; stage: DecisionStage }>> {
  const rows = await prisma.proposal.findMany({ where: { tripId, status: { in: OPEN } }, select: { id: true, status: true, payload: true } });
  const out = new Map<string, { to: string; proposalId: string; stage: DecisionStage }>();
  for (const p of rows) {
    try {
      const r = decodeProposalPayload(p.payload).reschedule;
      if (r) out.set(r.commitmentId, { to: r.newTime, proposalId: p.id, stage: stageOf(p.status) });
    } catch {
      // ignore unparseable payloads
    }
  }
  return out;
}

// Decisions waiting on THIS person: they are an eligible voter who has not voted
// on an open proposal.
export function waitingOn(decisions: DecisionView[]): DecisionView[] {
  return decisions.filter((d) => d.stage === "PROPOSED" && d.mine === "PENDING");
}
