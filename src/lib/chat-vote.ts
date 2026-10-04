// Plain replies in the group chat can answer an open proposal, so nobody is forced to
// find a button. It is deliberately conservative:
//   - only when exactly ONE open proposal is waiting on this sender (otherwise it is
//     ambiguous and the message is left alone for Clockwise to read in context);
//   - only for short, clearly yes/no replies.
// Buttons remain the safest fast path.
import { prisma } from "./prisma";
import { castApprovalVote } from "./proposals";
import { declineWithReason } from "./reschedule-counter";

export type ReplyIntent = "YES" | "NO" | "COUNTER" | null;

const YES = /^(yes|yeah|yep|yup|yea|ya|sure|ok(ay)?|works?|that works|works for me|works fine|sounds (good|great)|perfect|i'?m in|im in|count me in|fine|fine by me|let'?s do it|do it|accept(ed)?|agreed?|👍|✅)\b[\s.!,]*(for me|with me|by me|too)?[\s.!]*$/i;
const COUNTER = /^(make it|how about|what about|can we (do|make)|could we (do|make)|let'?s (do|make|say))\b.*\d/i;
// A bare "no", or a no that carries a time or a limit. "no way, that's hilarious" is chatter.
const NO_BARE = /^(no|nope|nah)[\s.!]*$/i;
const NO_WITH_SUBSTANCE = /^(no|nope|nah)\b[,.]?\s+.*(\d|\bleave\b|\bbefore\b|\bafter\b|\bcan'?t\b|\bcannot\b)/i;
const NO_OTHER = /^(can'?t|cannot|not (for me|possible|going to work)|doesn'?t work|won'?t work|i'?m out|im out|i (have|need|must|got) to (leave|go|be)|i'?ll have to leave)/i;

export function classifyReply(text: string): ReplyIntent {
  const t = text.trim();
  if (!t || t.length > 90) return null;
  if (COUNTER.test(t)) return "COUNTER";
  if (YES.test(t)) return "YES";
  if (NO_BARE.test(t) || NO_WITH_SUBSTANCE.test(t) || NO_OTHER.test(t)) return "NO";
  return null;
}

export type ChatVoteResult = { handled: boolean; proposalId?: string };

export async function voteFromChat(params: { tripId: string; userId: string; text: string }): Promise<ChatVoteResult> {
  const intent = classifyReply(params.text);
  if (!intent) return { handled: false };

  const open = await prisma.proposal.findMany({
    where: { tripId: params.tripId, status: "AWAITING_APPROVAL", approvals: { some: { decision: "PENDING", tripMember: { userId: params.userId } } } },
    select: { id: true },
  });
  if (open.length !== 1) return { handled: false };
  const proposalId = open[0].id;

  if (intent === "YES") {
    const r = await castApprovalVote(proposalId, params.userId, "APPROVED");
    return { handled: r.ok, proposalId };
  }
  // A "no" that names a time or a limit gets the full treatment (a private limit, then another
  // try); a bare "no" is just a vote. Either way the sender's words stay in the group chat they
  // were typed in.
  const hasSubstance = intent === "COUNTER" || /\d/.test(params.text) || /\b(leave|before|after|by|until|till|later|earlier)\b/i.test(params.text);
  const r = hasSubstance ? await declineWithReason(proposalId, params.userId, params.text) : await castApprovalVote(proposalId, params.userId, "REJECTED");
  return { handled: r.ok, proposalId };
}
