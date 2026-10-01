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

// The low-friction-reminder-before-escalation lifecycle. EscalationEvent
// already had reminderSentAt/acknowledgedAt fields and a documented
// PENDING -> REMINDED -> ESCALATING -> CALLED -> RESOLVED status
// progression, but nothing ever wrote a REMINDED row — triggerEscalation
// only ever created rows already at ESCALATING. This is what makes
// "send a low-friction nudge, then only call if they never responded" a
// real, checkable fact instead of Gemini guessing from vibes.
//
// Called by the send_readiness_reminder agent tool — NOT by Gemini
// writing the reminder text itself; this only records that a reminder
// moment occurred, so escalate_via_voice_call has something real to
// check before it's allowed to place a call.
export async function recordReadinessReminder(
  tripId: string,
  commitmentId: string,
  travellerId: string
): Promise<{ eventId: string }> {
  const commitment = await prisma.commitment.findUniqueOrThrow({ where: { id: commitmentId } });

  // Reuse an existing still-open reminder for this traveller+commitment
  // rather than creating a new one every turn Gemini happens to nudge
  // again — one open reminder per traveller per commitment at a time.
  const existing = await prisma.escalationEvent.findFirst({
    where: { tripId, commitmentId, travellerId, status: "REMINDED", acknowledgedAt: null },
  });
  if (existing) {
    await prisma.escalationEvent.update({ where: { id: existing.id }, data: { reminderSentAt: new Date() } });
    return { eventId: existing.id };
  }

  const event = await prisma.escalationEvent.create({
    data: {
      tripId,
      commitmentId,
      travellerId,
      expectedActionAt: commitment.targetTime,
      hardThresholdAt: commitment.hardThreshold,
      status: "REMINDED",
      mode: "DEMO", // no call has happened yet — this is just the reminder record
      reminderSentAt: new Date(),
    },
  });
  return { eventId: event.id };
}

// A traveller speaking in the group room after a reminder was sent to
// them counts as acknowledging it — deterministic application logic, not
// something Gemini decides. Called once per incoming group message, for
// whoever just sent it; harmless no-op when they have no open reminder.
export async function acknowledgeOpenReminders(tripId: string, travellerId: string): Promise<void> {
  await prisma.escalationEvent.updateMany({
    where: { tripId, travellerId, status: "REMINDED", acknowledgedAt: null },
    data: { acknowledgedAt: new Date() },
  });
}

export type EscalationReadiness =
  | { ok: true; event: { id: string; commitmentId: string } }
  | { ok: false; reason: string };

// The actual gate escalate_via_voice_call enforces before it's allowed to
// place a real call: a reminder must have genuinely been sent to THIS
// traveller for THIS commitment, they must not have acknowledged it
// since, and they must have opted in with a phone on file. Nothing here
// is Gemini's call to make — it's all checked against real rows.
export async function checkEscalationReadiness(
  tripId: string,
  commitmentId: string,
  travellerId: string
): Promise<EscalationReadiness> {
  const traveller = await prisma.user.findUnique({ where: { id: travellerId } });
  if (!traveller) return { ok: false, reason: "That traveller isn't on this trip." };
  if (!traveller.voiceEscalationOptIn) {
    return { ok: false, reason: `${traveller.name} hasn't opted into voice escalation.` };
  }
  if (!traveller.phone) {
    return { ok: false, reason: `${traveller.name} has no phone number on file.` };
  }

  const openReminder = await prisma.escalationEvent.findFirst({
    where: { tripId, commitmentId, travellerId, status: "REMINDED", acknowledgedAt: null },
    orderBy: { reminderSentAt: "desc" },
  });
  if (!openReminder) {
    return {
      ok: false,
      reason: `No unacknowledged reminder is on record for ${traveller.name} on this commitment — send a reminder first (send_readiness_reminder) and only escalate if it genuinely goes unanswered.`,
    };
  }

  const alreadyEscalating = await prisma.escalationEvent.findFirst({
    where: { tripId, commitmentId, travellerId, status: { in: ["ESCALATING", "CALLED"] } },
  });
  if (alreadyEscalating) {
    return { ok: false, reason: `A call to ${traveller.name} is already in progress for this commitment.` };
  }

  return { ok: true, event: { id: openReminder.id, commitmentId } };
}
