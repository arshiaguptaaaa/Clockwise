// Stage 2 agent output contract — Gemini's tool-call arguments are a
// hint to the model, never a guarantee about what actually comes back.
// This is the real validation boundary: executeTool (tools.ts) parses
// every record_trip_understanding call through this schema before a
// single row is written. Malformed output is rejected with a clear
// message the model can react to, never silently coerced or half-applied.
import { z } from "zod";
import type { ClaimType, DecisionStatus } from "@prisma/client";

export const TripUnderstandingSchema = z.object({
  claimType: z.enum([
    "PREFERENCE",
    "SOFT_CONSTRAINT",
    "HARD_CONSTRAINT",
    "DECISION_CANDIDATE",
    "CONFIRMED_DECISION",
    "CONFLICT",
    "PARTICIPATION_CHANGE",
    "BOOKING_INTENT",
  ]),
  category: z.string().trim().min(1).max(60),
  value: z.string().trim().min(1).max(500),
  confidence: z.enum(["LOW", "MEDIUM", "HIGH"]),
  // Names as the model knows them from the trip roster, NOT user ids —
  // the handler (tools.ts) resolves each name against ctx.trip.members
  // and silently drops anything that doesn't match a real traveller, so
  // the model can never invent a person who isn't actually on the trip.
  // Omitted/empty means "concerns only the speaker" (see resolveAffectedUserIds)
  // — this is the actual people-scoping default: most personal statements
  // ("I can't leave before 5") concern one person, not the whole group.
  affectedTravellerNames: z.array(z.string().trim().min(1)).max(20).optional(),
});

export type TripUnderstanding = z.infer<typeof TripUnderstandingSchema>;

// The tool-facing claimType is richer/friendlier than the underlying
// Prisma enums (ClaimType/DecisionStatus) — this is the one place that
// mapping lives, so it can't drift between call sites. HARD_CONSTRAINT
// and PARTICIPATION_CHANGE map to CONFIRMED status because they're
// factual claims about a person's situation, not something pending
// group agreement — CONFIRMED here means "this fact is on record", not
// "the group approved it".
const CLAIM_TYPE_MAP: Record<TripUnderstanding["claimType"], { type: ClaimType; status: DecisionStatus }> = {
  PREFERENCE: { type: "PREFERENCE", status: "CANDIDATE" },
  SOFT_CONSTRAINT: { type: "SOFT_CONSTRAINT", status: "CANDIDATE" },
  HARD_CONSTRAINT: { type: "HARD_CONSTRAINT", status: "CONFIRMED" },
  DECISION_CANDIDATE: { type: "DECISION", status: "CANDIDATE" },
  CONFIRMED_DECISION: { type: "DECISION", status: "CONFIRMED" },
  CONFLICT: { type: "CONFLICT", status: "UNRESOLVED" },
  PARTICIPATION_CHANGE: { type: "PARTICIPATION_CHANGE", status: "CONFIRMED" },
  BOOKING_INTENT: { type: "BOOKING_INTENT", status: "CANDIDATE" },
};

export function resolveDecisionFields(claimType: TripUnderstanding["claimType"]) {
  return CLAIM_TYPE_MAP[claimType];
}

// Name matching is intentionally strict (case-insensitive exact match on
// a real trip member's name) rather than fuzzy — a fuzzy match risks
// silently attaching a claim to the wrong traveller, which is worse than
// dropping an unmatched name. DECISION_CANDIDATE/CONFIRMED_DECISION/
// CONFLICT default to every current trip member when the model names no
// one (a decision candidate is inherently about the group), while every
// other claim type defaults to the actor alone — matches the product
// rule "a preference is not a hard constraint" and "don't ask the whole
// group unnecessarily".
export function resolveAffectedUserIds(
  claimType: TripUnderstanding["claimType"],
  affectedTravellerNames: string[] | undefined,
  actorUserId: string,
  members: { userId: string; user: { name: string } }[]
): string[] {
  if (affectedTravellerNames && affectedTravellerNames.length > 0) {
    const matched = affectedTravellerNames
      .map((name) => members.find((m) => m.user.name.toLowerCase() === name.toLowerCase())?.userId)
      .filter((id): id is string => Boolean(id));
    if (matched.length > 0) return [...new Set(matched)];
  }
  const groupScoped: TripUnderstanding["claimType"][] = ["DECISION_CANDIDATE", "CONFIRMED_DECISION", "CONFLICT"];
  if (groupScoped.includes(claimType)) {
    return members.map((m) => m.userId);
  }
  return [actorUserId];
}
