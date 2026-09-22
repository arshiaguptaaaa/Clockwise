// The one reusable lifecycle for every group-impacting, potentially
// external/irreversible action Clockwise proposes (see prisma/schema.prisma
// Proposal model comment). Actor ids are always passed in explicitly by the
// caller (never read from cookies() in here) so this file stays usable from
// both "use server" actions (src/app/proposal-actions.ts) and, later, agent
// tool execution — matching the existing src/lib/transport.ts /
// src/app/transport-actions.ts split.
import type { ApprovalDecision, ProposalStatus, ProposalType } from "@prisma/client";
import { prisma } from "./prisma";

export type ProposalPayload = {
  provider?: string;
  peopleAffected?: string[];
  timing?: string;
  destination?: string;
  price?: string;
  cancellationTerms?: string;
};

export function encodeProposalPayload(payload: ProposalPayload): string {
  return JSON.stringify(payload);
}

export function decodeProposalPayload(raw: string): ProposalPayload {
  return JSON.parse(raw) as ProposalPayload;
}

// Statuses a member vote is still allowed to move between. CONFIRMED,
// EXECUTED, FAILED and CANCELLED are terminal from a voting perspective —
// once there, only organiserHardConfirm/cancelProposal touch status again.
const VOTABLE_STATUSES: ProposalStatus[] = ["AWAITING_APPROVAL", "APPROVED", "REJECTED"];

// Statuses organiserHardConfirm is allowed to act from. Deliberately
// includes AWAITING_APPROVAL (not just APPROVED) — the organiser is the
// final authority per spec, not gated on full member consensus first.
// REJECTED, CANCELLED, EXECUTED and FAILED are excluded: a proposal the
// group rejected, or one already cancelled/executed/failed, cannot be
// hard-confirmed — a revised proposal must supersede it instead.
const CONFIRMABLE_STATUSES: ProposalStatus[] = ["AWAITING_APPROVAL", "APPROVED"];

const CANCELLABLE_STATUSES: ProposalStatus[] = ["AWAITING_APPROVAL", "APPROVED", "REJECTED"];

export function isConfirmable(status: ProposalStatus): boolean {
  return CONFIRMABLE_STATUSES.includes(status);
}

// Recomputes group-consensus status from every eligible member's vote.
// Can only ever produce AWAITING_APPROVAL, APPROVED, or REJECTED — reaching
// CONFIRMED is exclusively organiserHardConfirm's job, never this function's,
// no matter how unanimous the approvals are.
//
// AWAITING_APPROVAL until every eligible member has responded. Once all
// have responded: unanimous APPROVED -> APPROVED; anything else (any
// REJECTED among a fully-resolved vote) -> REJECTED. A single early
// rejection while others haven't voted yet does not immediately reject —
// it only resolves once the vote is complete.
export function aggregateApprovalStatus(
  decisions: ApprovalDecision[]
): "AWAITING_APPROVAL" | "APPROVED" | "REJECTED" {
  const allResponded = decisions.every((d) => d !== "PENDING");
  if (!allResponded) return "AWAITING_APPROVAL";
  return decisions.every((d) => d === "APPROVED") ? "APPROVED" : "REJECTED";
}

export type CreateProposalInput = {
  tripId: string;
  type: ProposalType;
  title: string;
  summary: string;
  payload: ProposalPayload;
  createdBy: string;
  // Points at the proposal this one revises/replaces, if any (requirement:
  // "what changed from the previous proposal"). The prior proposal is not
  // auto-cancelled here — callers that want that must call cancelProposal
  // explicitly, since a superseded-but-not-cancelled proposal is still a
  // meaningful distinct state (see isConfirmable's supersededBy check).
  supersedesId?: string;
};

// Fixes the eligible-voter set at creation time: one ProposalApproval row
// per trip member who exists right now. Someone who joins the trip later is
// not retroactively added as a voter for this proposal — a deliberate,
// documented limitation for this stage, not an oversight.
export async function createProposal(input: CreateProposalInput) {
  const tripMembers = await prisma.tripMember.findMany({ where: { tripId: input.tripId } });
  if (tripMembers.length === 0) {
    throw new Error("Cannot create a proposal for a trip with no members.");
  }

  if (input.supersedesId) {
    const prior = await prisma.proposal.findUnique({ where: { id: input.supersedesId } });
    if (!prior || prior.tripId !== input.tripId) {
      throw new Error("The proposal being superseded doesn't belong to this trip.");
    }
  }

  const proposal = await prisma.proposal.create({
    data: {
      tripId: input.tripId,
      type: input.type,
      status: "AWAITING_APPROVAL",
      title: input.title,
      summary: input.summary,
      payload: encodeProposalPayload(input.payload),
      createdBy: input.createdBy,
      supersedesId: input.supersedesId,
    },
  });

  await prisma.proposalApproval.createMany({
    data: tripMembers.map((m) => ({ proposalId: proposal.id, tripMemberId: m.id })),
  });

  await prisma.auditLog.create({
    data: {
      tripId: input.tripId,
      actorId: input.createdBy,
      actionType: "PROPOSAL_CREATED",
      payloadSummary: `Proposal "${input.title}" (${input.type}) created with ${tripMembers.length} eligible voter(s)${
        input.supersedesId ? `, superseding ${input.supersedesId}` : ""
      }.`,
    },
  });

  return proposal;
}

export type CastVoteResult =
  | { ok: true; proposalStatus: ProposalStatus }
  | { ok: false; error: string };

// Only eligible members can vote: eligibility means a ProposalApproval row
// already exists for (proposalId, that member's tripMemberId) — created up
// front by createProposal, never created lazily here. Re-casting the same
// decision is a no-op (idempotent, no duplicate AuditLog entry); voting
// never writes to any table this function doesn't itself own, so it can
// never cause an external action by construction.
export async function castApprovalVote(
  proposalId: string,
  actorId: string,
  decision: "APPROVED" | "REJECTED"
): Promise<CastVoteResult> {
  const proposal = await prisma.proposal.findUnique({ where: { id: proposalId } });
  if (!proposal) return { ok: false, error: "Proposal not found." };

  const tripMember = await prisma.tripMember.findUnique({
    where: { tripId_userId: { tripId: proposal.tripId, userId: actorId } },
  });
  if (!tripMember) {
    return { ok: false, error: "You're not a member of this trip." };
  }

  const approval = await prisma.proposalApproval.findUnique({
    where: { proposalId_tripMemberId: { proposalId, tripMemberId: tripMember.id } },
  });
  if (!approval) {
    return { ok: false, error: "You weren't an eligible voter when this proposal was created." };
  }

  if (!VOTABLE_STATUSES.includes(proposal.status)) {
    return { ok: false, error: `This proposal is ${proposal.status.toLowerCase()} and is no longer open for votes.` };
  }

  if (approval.decision === decision) {
    return { ok: true, proposalStatus: proposal.status };
  }

  await prisma.proposalApproval.update({
    where: { id: approval.id },
    data: { decision, respondedAt: new Date() },
  });

  await prisma.auditLog.create({
    data: {
      tripId: proposal.tripId,
      actorId,
      actionType: "PROPOSAL_VOTE_CAST",
      payloadSummary: `Trip member ${tripMember.id} voted ${decision} on proposal "${proposal.title}" (${proposalId}).`,
    },
  });

  const allApprovals = await prisma.proposalApproval.findMany({ where: { proposalId } });
  const nextAggregate = aggregateApprovalStatus(allApprovals.map((a) => a.decision));

  let proposalStatus = proposal.status;
  if (VOTABLE_STATUSES.includes(proposal.status) && nextAggregate !== proposal.status) {
    // Guarded by the status it was read at, so a concurrent organiser
    // confirm/cancel that already moved it off this status wins instead of
    // being clobbered by a stale aggregate recompute.
    const claimed = await prisma.proposal.updateMany({
      where: { id: proposalId, status: proposal.status },
      data: { status: nextAggregate },
    });
    if (claimed.count > 0) {
      proposalStatus = nextAggregate;
      await prisma.auditLog.create({
        data: {
          tripId: proposal.tripId,
          actorId,
          actionType: "PROPOSAL_STATUS_CHANGED",
          payloadSummary: `Proposal "${proposal.title}" (${proposalId}) moved ${proposal.status} -> ${nextAggregate} after member votes.`,
        },
      });
    } else {
      const latest = await prisma.proposal.findUniqueOrThrow({ where: { id: proposalId } });
      proposalStatus = latest.status;
    }
  }

  return { ok: true, proposalStatus };
}

export type OrganiserConfirmResult =
  | { ok: true; alreadyConfirmed: boolean }
  | { ok: false; error: string };

// THE hard-confirmation gate. Deliberately the only function in this file
// (or anywhere) allowed to write CONFIRMED — never derived from votes, never
// inferred from a previous proposal's confirmation. Requires trip.createdBy
// specifically (same check already used for Uber connect in
// src/app/api/integrations/uber/connect/route.ts), not "any organiser-role
// TripMember" — there is exactly one authority here, the trip creator.
export async function organiserHardConfirm(proposalId: string, actorId: string): Promise<OrganiserConfirmResult> {
  const proposal = await prisma.proposal.findUnique({
    where: { id: proposalId },
    include: { supersededBy: true },
  });
  if (!proposal) return { ok: false, error: "Proposal not found." };

  const trip = await prisma.trip.findUniqueOrThrow({ where: { id: proposal.tripId } });
  if (trip.createdBy !== actorId) {
    return { ok: false, error: "Only the trip organiser can give final confirmation." };
  }

  if (proposal.status === "CONFIRMED") {
    // Idempotent: a repeated/double-clicked confirm on an already-confirmed
    // proposal succeeds without writing a second AuditLog entry.
    return { ok: true, alreadyConfirmed: true };
  }

  if (proposal.supersededBy) {
    return { ok: false, error: "This proposal has been superseded by a newer one and can no longer be confirmed." };
  }

  if (!isConfirmable(proposal.status)) {
    return { ok: false, error: `This proposal is ${proposal.status.toLowerCase()} and can no longer be confirmed.` };
  }

  const claimed = await prisma.proposal.updateMany({
    where: { id: proposalId, status: proposal.status },
    data: { status: "CONFIRMED", organiserConfirmedBy: actorId, organiserConfirmedAt: new Date() },
  });

  if (claimed.count === 0) {
    // Lost a race with another confirm/cancel/vote — report what actually won.
    const latest = await prisma.proposal.findUniqueOrThrow({ where: { id: proposalId } });
    if (latest.status === "CONFIRMED") return { ok: true, alreadyConfirmed: true };
    return { ok: false, error: `This proposal is ${latest.status.toLowerCase()} and can no longer be confirmed.` };
  }

  await prisma.auditLog.create({
    data: {
      tripId: proposal.tripId,
      actorId,
      actionType: "PROPOSAL_ORGANISER_CONFIRMED",
      payloadSummary: `Organiser hard-confirmed proposal "${proposal.title}" (${proposalId}).`,
    },
  });

  return { ok: true, alreadyConfirmed: false };
}

export type CancelProposalResult = { ok: true } | { ok: false; error: string };

// Organiser-only, matching organiserHardConfirm's authority — not the
// proposal's `createdBy`, since agent-drafted proposals are "created by"
// Clockwise's own user id, not a human who should thereby gain cancel
// rights.
export async function cancelProposal(proposalId: string, actorId: string): Promise<CancelProposalResult> {
  const proposal = await prisma.proposal.findUnique({ where: { id: proposalId } });
  if (!proposal) return { ok: false, error: "Proposal not found." };

  const trip = await prisma.trip.findUniqueOrThrow({ where: { id: proposal.tripId } });
  if (trip.createdBy !== actorId) {
    return { ok: false, error: "Only the trip organiser can cancel a proposal." };
  }

  if (proposal.status === "CANCELLED") {
    return { ok: true };
  }
  if (!CANCELLABLE_STATUSES.includes(proposal.status)) {
    return { ok: false, error: `This proposal is already ${proposal.status.toLowerCase()} and can't be cancelled.` };
  }

  const claimed = await prisma.proposal.updateMany({
    where: { id: proposalId, status: proposal.status },
    data: { status: "CANCELLED" },
  });
  if (claimed.count === 0) {
    const latest = await prisma.proposal.findUniqueOrThrow({ where: { id: proposalId } });
    return latest.status === "CANCELLED"
      ? { ok: true }
      : { ok: false, error: `This proposal is already ${latest.status.toLowerCase()} and can't be cancelled.` };
  }

  await prisma.auditLog.create({
    data: {
      tripId: proposal.tripId,
      actorId,
      actionType: "PROPOSAL_CANCELLED",
      payloadSummary: `Organiser cancelled proposal "${proposal.title}" (${proposalId}).`,
    },
  });

  return { ok: true };
}

export async function getProposalWithApprovals(proposalId: string) {
  return prisma.proposal.findUnique({
    where: { id: proposalId },
    include: {
      approvals: { include: { tripMember: { include: { user: true } } } },
      supersedes: true,
      supersededBy: true,
    },
  });
}
