// The one reusable lifecycle for every group-impacting, potentially
// external/irreversible action Clockwise proposes (see prisma/schema.prisma
// Proposal model comment). Actor ids are always passed in explicitly by the
// caller (never read from cookies() in here) so this file stays usable from
// both "use server" actions (src/app/proposal-actions.ts) and, later, agent
// tool execution — matching the existing src/lib/transport.ts /
// src/app/transport-actions.ts split.
import type { ApprovalDecision, ProposalStatus, ProposalType } from "@prisma/client";
import { prisma } from "./prisma";
import { executeConfirmedProposal, type ExecutionResult } from "./proposal-execution";
import { notify } from "./notifications";

export type ProposalPayload = {
  provider?: string;
  peopleAffected?: string[];
  timing?: string;
  // UBER_RIDE only: where the ride starts. `destination` (below) doubles
  // as the ride's dropoff for this type.
  pickup?: string;
  // For ITINERARY_CHANGE: the place name/text to resolve into a canonical
  // Destination on confirm (src/lib/proposal-execution.ts) — resolved the
  // same way chat's location tools already do (stored destination first,
  // then live geocode), never fabricated.
  destination?: string;
  // ISO 8601 datetime strings, resolved by the caller against real trip
  // dates BEFORE this payload is built (Gemini has the trip's actual ISO
  // core dates in its system prompt and resolves "tomorrow morning"
  // itself) — never raw free text. proposal-execution.ts re-validates
  // both as real dates before writing Destination.startDate/endDate;
  // never trusted un-parsed. Omitted when timing is genuinely unknown.
  startTime?: string;
  endTime?: string;
  price?: string;
  // Structured amount/currency for BOOKING proposals — kept separate from
  // the free-text `price` display string so proposal-execution.ts can
  // write a real Booking.amount/currency without re-parsing prose.
  amount?: number;
  currency?: string;
  cancellationTerms?: string;
  // BOOKING proposals for a place to stay. Everything here came from a
  // provider search (see travel/hotel-provider.ts); nothing is model-written.
  // Rates are deliberately absent: Geoapify supplies none.
  // OTHER proposals that move a shared commitment (e.g. dinner 20:00 -> 21:30).
  // Times are local wall-clock strings (YYYY-MM-DDTHH:mm), the Commitment convention.
  reschedule?: {
    commitmentId: string;
    commitmentName: string;
    oldTime: string;
    newTime: string;
    // Group-safe reason: whose arrival, and when they can reach the stay.
    because: string;
  };
  // OTHER proposals suggesting a real place (a Geoapify result). Agreeing to it
  // books nothing and schedules nothing: the group has only agreed on the place.
  place?: {
    provider: string;
    providerPlaceId: string;
    name: string;
    address: string | null;
    latitude: number;
    longitude: number;
    retrievedAt: string;
    kind: string;
  };
  // BOOKING proposals that collect money from travellers: who owes exactly what. Nothing is charged and no
  // link exists until the organiser confirms ("CREATE PAYMENT"); then each person gets their own Pine Labs link.
  split?: {
    totalMinor: number;
    lines: { userId: string; name: string; amountMinor: number; alreadyPaid: boolean }[];
  };
  stay?: {
    provider: string;
    providerPlaceId: string;
    name: string;
    address: string | null;
    latitude: number;
    longitude: number;
    retrievedAt: string;
    checkIn?: string; // ISO date
    checkOut?: string; // ISO date
    travellers?: number;
  };
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
// FAILED is included too: it means "confirmed, but the structured
// mutation itself failed" (e.g. a transient geocoding error), which is
// meant to be retryable by confirming again — not a dead end that forces
// a whole new superseding proposal for a temporary failure. REJECTED,
// CANCELLED and EXECUTED are excluded: a proposal the group rejected, or
// one already cancelled/executed, cannot be (re-)confirmed — a revised
// proposal must supersede it instead.
const CONFIRMABLE_STATUSES: ProposalStatus[] = ["AWAITING_APPROVAL", "APPROVED", "FAILED"];

const CANCELLABLE_STATUSES: ProposalStatus[] = ["AWAITING_APPROVAL", "APPROVED", "REJECTED", "FAILED"];

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

  // Everyone who can vote hears about it: a decision is waiting. Never throws into
  // the caller (notify swallows its own failures).
  await notify({
    tripId: input.tripId,
    recipientIds: tripMembers.map((m) => m.userId).filter((id) => id !== input.createdBy),
    severity: "IMPORTANT",
    kind: "DECISION_WAITING",
    title: "A decision's waiting",
    body: input.title,
    href: `/trips/${input.tripId}/room`,
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
  decision: "APPROVED" | "REJECTED",
  note?: string | null
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
    data: { decision, respondedAt: new Date(), note: decision === "REJECTED" ? (note?.trim().slice(0, 300) || null) : null },
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
      if (nextAggregate === "APPROVED") {
        await prisma.tripEvent.create({
          data: {
            tripId: proposal.tripId,
            kind: "GROUP_APPROVED",
            scope: "GROUP",
            actorUserId: actorId,
            sourceChannel: "HUMAN",
            confidence: "HIGH",
            payload: JSON.stringify({ proposalId, title: proposal.title, voters: allApprovals.length, approved: allApprovals.filter((a) => a.decision === "APPROVED").length }),
            propagation: JSON.stringify(["decision-strip", "notifications"]),
          },
        }).catch(() => undefined);
        // Everyone is in. The Plan has NOT changed: the organiser still makes it official.
        const trip = await prisma.trip.findUnique({ where: { id: proposal.tripId }, select: { createdBy: true } });
        const members = await prisma.tripMember.findMany({ where: { tripId: proposal.tripId }, select: { userId: true } });
        if (trip) {
          await notify({
            tripId: proposal.tripId,
            recipientIds: members.map((m) => m.userId).filter((id) => id === trip.createdBy),
            severity: "IMPORTANT",
            kind: "DECISION_EVERYONE_IN",
            title: "Everyone's in",
            body: `${proposal.title} Make it official when you're ready.`,
            href: `/trips/${proposal.tripId}/room`,
          });
        }
      }
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
  | { ok: true; alreadyExecuted: boolean; executionSummary?: string }
  | { ok: false; error: string };

// THE hard-confirmation gate. Deliberately the only function in this file
// (or anywhere) allowed to write CONFIRMED — never derived from votes, never
// inferred from a previous proposal's confirmation. Requires trip.createdBy
// specifically (same check already used for Uber connect in
// src/app/api/integrations/uber/connect/route.ts), not "any organiser-role
// TripMember" — there is exactly one authority here, the trip creator.
//
// Confirmation and execution happen together, in this one call: the whole
// point of the hard-confirm gate is that this is the last moment before
// the structured mutation (or, for types wired in a later stage, the
// external action) actually happens — not a separate third step. FAILED
// is retryable (a transient resolution failure shouldn't strand a
// proposal forever); EXECUTED is the one truly terminal success state.
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

  if (proposal.status === "EXECUTED") {
    // Idempotent: a repeated/double-clicked confirm on an already-executed
    // proposal succeeds without re-running the mutation or writing a
    // second AuditLog entry.
    return { ok: true, alreadyExecuted: true };
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
    if (latest.status === "EXECUTED") return { ok: true, alreadyExecuted: true };
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

  const confirmedProposal = await prisma.proposal.findUniqueOrThrow({ where: { id: proposalId } });

  let execution: ExecutionResult;
  try {
    execution = await executeConfirmedProposal(confirmedProposal);
  } catch (err) {
    execution = { ok: false, error: err instanceof Error ? err.message : "Execution failed unexpectedly." };
  }

  if (execution.ok) {
    await prisma.proposal.update({
      where: { id: proposalId },
      data: { status: "EXECUTED", executedAt: new Date(), executionResult: execution.summary },
    });
    await prisma.auditLog.create({
      data: {
        tripId: proposal.tripId,
        actorId,
        actionType: "PROPOSAL_EXECUTED",
        payloadSummary: `Proposal "${proposal.title}" (${proposalId}) executed: ${execution.summary}`,
      },
    });
    return { ok: true, alreadyExecuted: false, executionSummary: execution.summary };
  }

  await prisma.proposal.update({
    where: { id: proposalId },
    data: { status: "FAILED", failureReason: execution.error },
  });
  await prisma.auditLog.create({
    data: {
      tripId: proposal.tripId,
      actorId,
      actionType: "PROPOSAL_EXECUTION_FAILED",
      payloadSummary: `Proposal "${proposal.title}" (${proposalId}) confirmed but execution failed: ${execution.error}`,
    },
  });
  return { ok: false, error: `Confirmed, but execution failed: ${execution.error}` };
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
