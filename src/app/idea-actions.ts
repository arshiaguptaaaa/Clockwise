"use server";

// CLOCKWISE HAS AN IDEA -> PROPOSE TO GROUP. This is the step that turns a SUGGESTION into a PROPOSAL: it opens the
// normal vote (every traveller) and the usual organiser confirmation. Nothing here touches the Plan; the Plan only
// changes when the proposal is agreed and confirmed (see executeIdea in lib/proposal-execution.ts).
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/session";
import { getClockwiseUserId } from "@/lib/clockwise";
import { createProposal } from "@/lib/proposals";
import { humanMoment } from "@/lib/when";
import type { IdeaStep } from "@/lib/ideas";

async function memberOf(tripId: string, userId: string) {
  return prisma.tripMember.findUnique({ where: { tripId_userId: { tripId, userId } }, select: { id: true } });
}

function refresh(tripId: string) {
  for (const p of ["room", "plan", "agent"]) revalidatePath(`/trips/${tripId}/${p}`);
}

export async function proposeIdeaAction(suggestionId: string): Promise<{ ok: true; proposalId: string } | { ok: false; error: string }> {
  const userId = await getCurrentUserId();
  if (!userId) return { ok: false, error: "Sign in first." };
  const s = await prisma.tripSuggestion.findUnique({ where: { id: suggestionId } });
  if (!s) return { ok: false, error: "That idea isn't there any more." };
  if (!(await memberOf(s.tripId, userId))) return { ok: false, error: "You're not on this trip." };
  if (s.status === "PROPOSED" && s.proposalId) return { ok: true, proposalId: s.proposalId };
  if (s.status !== "OPEN") return { ok: false, error: "This idea has already been dealt with." };

  // Claim it first so two people pressing PROPOSE at once make one proposal.
  const claimed = await prisma.tripSuggestion.updateMany({ where: { id: s.id, status: "OPEN" }, data: { status: "PROPOSED" } });
  if (claimed.count === 0) {
    const again = await prisma.tripSuggestion.findUnique({ where: { id: s.id } });
    return again?.proposalId ? { ok: true, proposalId: again.proposalId } : { ok: false, error: "This idea has already been dealt with." };
  }

  const steps = JSON.parse(s.steps) as IdeaStep[];
  const timed = steps.filter((x) => x.at);
  const when = s.windowStart ? humanMoment(s.windowStart).split(",")[0] : "";
  const proposer = (await prisma.user.findUnique({ where: { id: userId }, select: { name: true } }))?.name.split(" ")[0] ?? "Someone";
  const clockwiseId = await getClockwiseUserId();
  const proposal = await createProposal({
    tripId: s.tripId,
    type: "OTHER",
    title: `Add ${s.title}${when ? ` on ${when}` : ""}?`,
    summary: `${s.why} ${timed.map((x) => `${x.name} · ${humanMoment(x.at!).split(", ")[1]}`).join(" → ")}. ${proposer} asked me to put it to the group.`,
    payload: { timing: timed.map((x) => humanMoment(x.at!)).join(" → "), idea: { suggestionId: s.id, title: s.title, steps: timed.map((x) => ({ name: x.name, at: x.at, location: x.location })) } },
    createdBy: clockwiseId,
  });
  const msg = await prisma.message.create({ data: { tripId: s.tripId, senderId: clockwiseId, channel: "GROUP", content: `Proposal: ${proposal.title}` } });
  await prisma.proposal.update({ where: { id: proposal.id }, data: { groupMessageId: msg.id } });
  await prisma.tripSuggestion.update({ where: { id: s.id }, data: { proposalId: proposal.id } });
  await prisma.tripPointer.updateMany({ where: { id: { in: JSON.parse(s.pointerIds) as string[] } }, data: { status: "PROPOSED" } });
  await prisma.tripEvent
    .create({
      data: {
        tripId: s.tripId,
        kind: "SUGGESTION_PROPOSED",
        scope: "GROUP",
        actorUserId: userId,
        sourceChannel: "HUMAN",
        confidence: "HIGH",
        payload: JSON.stringify({ suggestionId: s.id, proposalId: proposal.id, title: s.title, stage: "PROPOSAL", proposedBy: proposer, note: "The group is being asked. The Plan changes only after everyone has voted and the organiser confirms." }),
        propagation: JSON.stringify(["proposals", "notifications", "chat"]),
      },
    })
    .catch(() => undefined);
  refresh(s.tripId);
  return { ok: true, proposalId: proposal.id };
}

export async function dismissIdeaAction(suggestionId: string): Promise<{ ok: boolean }> {
  const userId = await getCurrentUserId();
  if (!userId) return { ok: false };
  const s = await prisma.tripSuggestion.findUnique({ where: { id: suggestionId } });
  if (!s || !(await memberOf(s.tripId, userId)) || s.status !== "OPEN") return { ok: false };
  await prisma.tripSuggestion.update({ where: { id: s.id }, data: { status: "DISMISSED" } });
  // The pointers are still true; they just aren't offered again right now.
  await prisma.tripPointer.updateMany({ where: { id: { in: JSON.parse(s.pointerIds) as string[] }, status: "SUGGESTED" }, data: { status: "ACTIVE" } });
  await prisma.tripEvent
    .create({ data: { tripId: s.tripId, kind: "SUGGESTION_DISMISSED", scope: "GROUP", actorUserId: userId, sourceChannel: "HUMAN", confidence: "HIGH", payload: JSON.stringify({ suggestionId: s.id, title: s.title }), propagation: JSON.stringify(["chat"]) } })
    .catch(() => undefined);
  refresh(s.tripId);
  return { ok: true };
}

// "Forget this": a traveller removes something Clockwise picked up about them.
export async function forgetPointerAction(pointerId: string): Promise<{ ok: boolean }> {
  const userId = await getCurrentUserId();
  if (!userId) return { ok: false };
  const p = await prisma.tripPointer.findUnique({ where: { id: pointerId } });
  if (!p || p.userId !== userId) return { ok: false };
  await prisma.tripPointer.update({ where: { id: p.id }, data: { status: "DISMISSED" } });
  if (p.kind === "DIET") {
    const value = p.subject === "vegan" ? "VEGAN" : p.subject === "eggetarian" ? "EGGETARIAN" : "VEGETARIAN";
    await prisma.travellerPreference.deleteMany({ where: { tripId: p.tripId, userId, key: "FOOD", value, source: "CHAT" } });
  }
  await prisma.tripEvent
    .create({ data: { tripId: p.tripId, kind: "POINTER_FORGOTTEN", scope: "PERSONAL", actorUserId: userId, subjectUserId: userId, sourceChannel: "HUMAN", confidence: "HIGH", payload: JSON.stringify({ kind: p.kind, subject: p.subject }), propagation: JSON.stringify(["picked-up"]) } })
    .catch(() => undefined);
  refresh(p.tripId);
  return { ok: true };
}
