// "Yes." ... to WHAT? A bare reply in the group chat can answer an open proposal, or Clockwise's own clash question.
// Counting it against the wrong one would change a Plan or a payment by accident, so the target is resolved here, in
// code, from stored state, and recency never decides:
//   - exactly ONE thing is waiting on this person            -> that one (it is clearly the active one)
//   - the reply NAMES it ("yes to the museum tickets")         -> that one, if the words match exactly one
//   - anything else                                            -> AMBIGUOUS: Clockwise asks, and nothing is counted
// The card's own Accept button is always the explicit path. Pure decision (`pickTarget`) + a thin loader.
import { prisma } from "./prisma";
import { timeLabel } from "@/lib/traveller/journey";

export type Candidate = { kind: "proposal" | "clash"; id: string; label: string; cardMessageId: string | null };
export type ReplyTarget = { kind: "none" } | { kind: "proposal"; id: string } | { kind: "clash"; id: string } | { kind: "ambiguous"; options: string[] };

const STOP = new Set(["yes", "yeah", "yep", "yup", "yea", "sure", "ok", "okay", "to", "for", "on", "the", "that", "this", "one", "with", "about", "please", "pls", "accept", "agree", "agreed", "im", "in", "its", "it", "is", "a", "an", "and", "of", "move", "payment", "needed"]);
export const words = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}\s:]/gu, " ").split(/\s+/).filter((w) => w && !STOP.has(w));

// "yes to the museum tickets" -> the words after the yes, minus filler. Empty for a bare "yes".
export function namedPhrase(text: string): string[] {
  const m = /^\s*(?:yes|yeah|yep|yup|yea|sure|ok(?:ay)?|accept(?:ed)?|agreed?|i'?m in|count me in)\b[\s,.!-]*(.*)$/i.exec(text);
  return m ? words(m[1]) : [];
}

export function pickTarget(candidates: Candidate[], named: string[] = []): ReplyTarget {
  if (candidates.length === 0) return { kind: "none" };
  if (candidates.length === 1) return { kind: candidates[0].kind, id: candidates[0].id } as ReplyTarget;
  if (named.length) {
    const hits = candidates.filter((c) => {
      const label = new Set(words(c.label));
      return named.some((w) => label.has(w));
    });
    if (hits.length === 1) return { kind: hits[0].kind, id: hits[0].id } as ReplyTarget;
  }
  return { kind: "ambiguous", options: candidates.map((c) => c.label) };
}

export async function candidatesFor(tripId: string, userId: string): Promise<Candidate[]> {
  const [proposals, clashes, member] = await Promise.all([
    prisma.proposal.findMany({ where: { tripId, status: "AWAITING_APPROVAL", approvals: { some: { decision: "PENDING", tripMember: { userId } } } }, select: { id: true, title: true, groupMessageId: true } }),
    prisma.tripClash.findMany({ where: { tripId, status: { in: ["OPEN", "INFORMED"] }, updatedAt: { gt: new Date(Date.now() - 6 * 3600_000) } }, select: { id: true, commitmentName: true, targetLocal: true, messageId: true } }),
    prisma.tripMember.findUnique({ where: { tripId_userId: { tripId, userId } }, select: { id: true } }),
  ]);
  if (!member) return [];
  return [
    ...proposals.map((p): Candidate => ({ kind: "proposal", id: p.id, label: p.title.replace(/^Payment needed:\s*/i, "").slice(0, 80), cardMessageId: p.groupMessageId })),
    ...clashes.map((c): Candidate => ({ kind: "clash", id: c.id, label: `the clash on ${c.commitmentName} (${timeLabel(c.targetLocal)})`, cardMessageId: c.messageId })),
  ];
}

export async function resolveReplyTarget(tripId: string, userId: string, replyText: string | null = null): Promise<ReplyTarget> {
  return pickTarget(await candidatesFor(tripId, userId), replyText ? namedPhrase(replyText) : []);
}

export const clarifyYes = (who: string, options: string[]) =>
  `Which one do you mean, ${who}? ${options.map((o) => `• ${o}`).join(" ")} I haven't counted that reply yet. Tap Accept on the card you mean, or tell me which.`;
