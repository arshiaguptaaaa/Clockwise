// A yes with a condition is not a yes. "I'm fine with 10, but only if we're back by 11." is attached to the ONE proposal it
// answers, shown on that proposal's card, and never counted as approval. The condition cannot be checked from the Plan
// (it stores when things start, not how long they run), so Clockwise says that and asks what the person wants to do. An
// explicit Accept afterwards is a yes without the condition (see castApprovalVote).
import { prisma } from "./prisma";
import { candidatesFor, pickTarget, clarifyYes, words } from "./reply-target";

const first = (n: string) => n.trim().split(/\s+/)[0] ?? n;

export async function attachCondition(p: { tripId: string; userId: string; accepts: string; condition: string; messageId: string | null }): Promise<string | null> {
  const user = await prisma.user.findUnique({ where: { id: p.userId }, select: { name: true } });
  const me = first(user?.name ?? "you");
  const candidates = await candidatesFor(p.tripId, p.userId);
  const target = pickTarget(candidates, words(p.accepts));
  await prisma.tripEvent
    .create({
      data: {
        tripId: p.tripId,
        kind: "CONDITIONAL_APPROVAL_NOTED",
        scope: "GROUP",
        actorUserId: p.userId,
        sourceChannel: "GROUP",
        sourceMessageId: p.messageId,
        confidence: "MEDIUM",
        payload: JSON.stringify({ condition: p.condition.slice(0, 120), counted: false, attachedTo: target.kind === "proposal" ? target.id : null, openDecisions: candidates.length, note: "A conditional yes is kept on the proposal and is not counted as approval." }),
        propagation: "[]",
      },
    })
    .catch(() => undefined);
  if (target.kind === "ambiguous") return clarifyYes(me, target.options);
  if (target.kind !== "proposal") return null;
  const proposal = await prisma.proposal.findUnique({ where: { id: target.id }, select: { title: true } });
  const dup = await prisma.proposalCondition.findFirst({ where: { proposalId: target.id, userId: p.userId, status: "OPEN", text: p.condition } });
  if (!dup) await prisma.proposalCondition.create({ data: { proposalId: target.id, userId: p.userId, text: p.condition.slice(0, 200) } });
  return `Noted, ${me}: your yes to "${proposal?.title ?? "that proposal"}" depends on "${p.condition}". I've put that on the proposal and I haven't counted it as approval. I can't check it for you: the Plan stores when things start, not how long they run or when they end. If you're fine without the condition, tap Accept; otherwise ask the group how long it will take.`;
}
