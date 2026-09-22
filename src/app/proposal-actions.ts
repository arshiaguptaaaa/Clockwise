"use server";

// The "use server" boundary for the Proposal lifecycle — resolves the
// current session (getCurrentUserId) and revalidates the affected trip
// pages, then delegates all actual state-machine logic to
// src/lib/proposals.ts. Mirrors the existing transport.ts /
// transport-actions.ts split for the Uber flow.
import { revalidatePath } from "next/cache";
import { getCurrentUserId } from "@/lib/session";
import {
  createProposal,
  castApprovalVote,
  organiserHardConfirm,
  cancelProposal,
  getProposalWithApprovals,
  type CreateProposalInput,
} from "@/lib/proposals";

function revalidateTrip(tripId: string) {
  revalidatePath(`/trips/${tripId}/room`);
  revalidatePath(`/trips/${tripId}/agent`);
  revalidatePath(`/trips/${tripId}/plan`);
}

export async function createProposalAction(input: Omit<CreateProposalInput, "createdBy">) {
  const actorId = await getCurrentUserId();
  if (!actorId) throw new Error("Sign in to create a proposal.");

  const proposal = await createProposal({ ...input, createdBy: actorId });
  revalidateTrip(input.tripId);
  return proposal;
}

export async function castApprovalVoteAction(proposalId: string, decision: "APPROVED" | "REJECTED") {
  const actorId = await getCurrentUserId();
  if (!actorId) return { ok: false as const, error: "Sign in to vote on this proposal." };

  const result = await castApprovalVote(proposalId, actorId, decision);
  if (result.ok) {
    const proposal = await getProposalWithApprovals(proposalId);
    if (proposal) revalidateTrip(proposal.tripId);
  }
  return result;
}

export async function organiserHardConfirmAction(proposalId: string) {
  const actorId = await getCurrentUserId();
  if (!actorId) return { ok: false as const, error: "Sign in to confirm this proposal." };

  const result = await organiserHardConfirm(proposalId, actorId);
  if (result.ok) {
    const proposal = await getProposalWithApprovals(proposalId);
    if (proposal) revalidateTrip(proposal.tripId);
  }
  return result;
}

export async function cancelProposalAction(proposalId: string) {
  const actorId = await getCurrentUserId();
  if (!actorId) return { ok: false as const, error: "Sign in to cancel this proposal." };

  const result = await cancelProposal(proposalId, actorId);
  if (result.ok) {
    const proposal = await getProposalWithApprovals(proposalId);
    if (proposal) revalidateTrip(proposal.tripId);
  }
  return result;
}
