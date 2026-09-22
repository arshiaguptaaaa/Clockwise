import { prisma } from "@/lib/prisma";

// Same deterministic check the check_readiness agent tool uses — pulled
// out so any page can show a commitment's CURRENT status without waiting
// for someone to have asked Clockwise about it first.
export function computeReadinessStatus(commitment: {
  targetTime: Date;
  hardThreshold: Date | null;
}): "ON_TRACK" | "AT_RISK" | "MISSED" {
  const now = new Date();
  if (commitment.hardThreshold && now > commitment.hardThreshold) return "MISSED";
  const minutesUntil = (commitment.targetTime.getTime() - now.getTime()) / 60_000;
  if (minutesUntil < 30) return "AT_RISK";
  return "ON_TRACK";
}

// Deterministic readiness recalculation — shared by the demo-mode
// simulation and the real Gnani webhook, so a call's outcome always
// updates state the same way regardless of which path produced it. Never
// left to the LLM to "decide" a new status.
export async function recalculateCommitmentReadiness(
  commitmentId: string,
  estimatedDelayMinutes: number | null
): Promise<void> {
  const commitment = await prisma.commitment.findUniqueOrThrow({ where: { id: commitmentId } });
  const now = new Date();

  let status: "ON_TRACK" | "AT_RISK" | "MISSED" | "RECOVERING";
  if (estimatedDelayMinutes == null) {
    // No parseable delay (e.g. "can't make it", or a real call whose
    // disposition didn't include a number) — flag for human review rather
    // than guessing a time.
    status = "MISSED";
  } else if (estimatedDelayMinutes === 0) {
    status = "ON_TRACK";
  } else {
    const newExpected = new Date(now.getTime() + estimatedDelayMinutes * 60_000);
    status = commitment.hardThreshold && newExpected > commitment.hardThreshold ? "AT_RISK" : "RECOVERING";
  }

  await prisma.commitment.update({ where: { id: commitmentId }, data: { status } });
}

// Best-effort extraction of a stated delay ("leaving in 15 minutes") from
// a real call's transcript/disposition text — never invents a number that
// isn't actually present in the text.
export function parseDelayMinutes(text: string | null): number | null {
  if (!text) return null;
  const match = text.match(/(\d{1,3})\s*(?:min|minute)/i);
  if (!match) return null;
  return Number(match[1]);
}
