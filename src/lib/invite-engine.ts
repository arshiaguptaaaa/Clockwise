// Invitation + follow-up engine. The email, the reminder and the optional
// escalation call all hang off ONE piece of state — the Invite (PENDING until
// the person joins) and its ScheduledJob rows — so a response cancels
// everything that was waiting on it.
//
//   add traveller -> Invite row -> invitation email (logged, idempotent)
//     -> follow-up jobs scheduled for now + ESCALATION_DELAY
//   joined before the deadline -> reminder RESOLVED, call CANCELLED
//   still not joined at the deadline -> worker sends the reminder (and, with
//     consent + phone + credentials, places the call)
import { prisma } from "./prisma";
import { generateUniqueInviteToken } from "./invite-token";
import { getAppBaseUrl } from "./site-url";
import { deliverClockwiseEmail } from "./email/deliver";
import { notify } from "./notifications";

// SERVER-SIDE ONLY. Production is 24h; set ESCALATION_DELAY_MINUTES=2 in the
// deployment environment to test. It is read here and nowhere in client code,
// and no request parameter can change it.
export function escalationDelayMinutes(): number {
  const raw = Number(process.env.ESCALATION_DELAY_MINUTES);
  return Number.isFinite(raw) && raw >= 1 && raw <= 7 * 24 * 60 ? Math.floor(raw) : 24 * 60;
}

export const RESEND_MIN_INTERVAL_MS = 60_000;

export function inviteUrl(token: string): string {
  return `${getAppBaseUrl()}/invite/${token}`;
}

const looksLikeEmail = (v: string | null | undefined) => Boolean(v && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.trim()));
const looksLikePhone = (v: string | null | undefined) => Boolean(v && /^[+\d][\d\s().-]{6,}$/.test(v.trim()));

// Invitation events carry the invitee's email address, so they are PERSONAL to
// the organiser who added them — other travellers' Agent Trace never shows them.
async function recordEvent(tripId: string, kind: string, organiserId: string | null, payload: Record<string, unknown>, propagation: string[] = ["travellers", "notifications"]) {
  return prisma.tripEvent.create({
    data: {
      tripId,
      kind,
      scope: "PERSONAL",
      actorUserId: organiserId,
      subjectUserId: organiserId,
      sourceChannel: "SYSTEM",
      confidence: "HIGH",
      payload: JSON.stringify(payload),
      propagation: JSON.stringify(propagation),
    },
  });
}

async function tripContext(tripId: string, organiserId: string) {
  const [trip, organiser, memberCount] = await Promise.all([
    prisma.trip.findUnique({ where: { id: tripId }, include: { destinations: { orderBy: { order: "asc" } } } }),
    prisma.user.findUnique({ where: { id: organiserId }, select: { name: true } }),
    prisma.tripMember.count({ where: { tripId } }),
  ]);
  return {
    tripName: trip?.name ?? "your trip",
    organiserName: organiser?.name ?? "Your trip organiser",
    destinations: (trip?.destinations ?? []).map((d) => d.city ?? d.name),
    travellerCount: Math.max(0, memberCount - 1),
  };
}

export type CreateInviteParams = {
  tripId: string;
  invitedBy: string;
  inviteeName: string;
  // Email (preferred) or a phone number; phone may also be given separately.
  contact?: string | null;
  phone?: string | null;
  callConsent?: boolean;
};

export async function createInviteRecord(p: CreateInviteParams): Promise<{ inviteId: string; token: string }> {
  const contact = p.contact?.trim() || null;
  const email = looksLikeEmail(contact) ? contact : null;
  const phone = p.phone?.trim() || (!email && looksLikePhone(contact) ? contact : null);
  const token = await generateUniqueInviteToken();
  const invite = await prisma.invite.create({
    data: {
      tripId: p.tripId,
      token,
      inviteeName: p.inviteeName,
      contact: email ?? contact,
      phone,
      // A reminder call needs both the number and the consent; one alone is not enough.
      callConsent: Boolean(p.callConsent && phone),
      invitedBy: p.invitedBy,
      status: "PENDING",
    },
  });
  await recordEvent(p.tripId, "INVITE_CREATED", p.invitedBy, {
    inviteId: invite.id,
    invitee: p.inviteeName,
    hasEmail: Boolean(email),
    callConsent: invite.callConsent,
  });
  return { inviteId: invite.id, token };
}

export type SendInvitationResult =
  | { sent: true; alreadySent?: boolean; providerMessageId?: string; sentAt: Date }
  | { sent: false; reason: string };

// Sends (or, with resend:true, re-sends) the invitation for an EXISTING invite.
// Never creates a second Invite. A first send happens once even if called
// twice; a resend is rate-limited and gets its own idempotency key.
export async function sendInvitation(inviteId: string, opts: { resend?: boolean } = {}): Promise<SendInvitationResult> {
  const invite = await prisma.invite.findUnique({ where: { id: inviteId } });
  if (!invite) return { sent: false, reason: "Invite not found." };
  if (invite.status === "ACCEPTED") return { sent: false, reason: "They've already joined." };
  if (!looksLikeEmail(invite.contact)) return { sent: false, reason: "This invite has no email address on file." };

  if (!opts.resend && invite.sendCount > 0 && invite.lastSentAt) {
    return { sent: true, alreadySent: true, sentAt: invite.lastSentAt };
  }
  if (opts.resend && invite.lastSentAt && Date.now() - invite.lastSentAt.getTime() < RESEND_MIN_INTERVAL_MS) {
    const wait = Math.ceil((RESEND_MIN_INTERVAL_MS - (Date.now() - invite.lastSentAt.getTime())) / 1000);
    return { sent: false, reason: `Sent a moment ago — you can resend in ${wait}s.` };
  }

  const ctx = await tripContext(invite.tripId, invite.invitedBy);
  const sequence = invite.sendCount + 1;
  const result = await deliverClockwiseEmail({
    tripId: invite.tripId,
    inviteId: invite.id,
    intendedRecipient: invite.contact!,
    idempotencyKey: `invite:${invite.id}:${sequence}`,
    content: {
      kind: "INVITATION",
      recipientName: invite.inviteeName,
      organiserName: ctx.organiserName,
      tripName: ctx.tripName,
      destinations: ctx.destinations,
      travellerCount: ctx.travellerCount,
      ctaUrl: inviteUrl(invite.token),
    },
  });

  if (!result.ok) {
    await recordEvent(invite.tripId, "INVITE_EMAIL_FAILED", invite.invitedBy, { inviteId: invite.id, invitee: invite.inviteeName, reason: result.reason.slice(0, 160) });
    return { sent: false, reason: result.reason };
  }
  if (result.duplicate) return { sent: true, alreadySent: true, sentAt: invite.lastSentAt ?? new Date() };

  const sentAt = new Date();
  await prisma.invite.update({ where: { id: invite.id }, data: { emailSentAt: sentAt, lastSentAt: sentAt, sendCount: sequence } });
  await recordEvent(invite.tripId, sequence > 1 ? "INVITE_EMAIL_RESENT" : "INVITE_EMAIL_SENT", invite.invitedBy, {
    inviteId: invite.id,
    invitee: invite.inviteeName,
    provider: "resend",
    providerMessageId: result.providerMessageId,
    intendedRecipient: invite.contact,
    deliveryRecipient: result.deliveryRecipient,
    overridden: result.overridden,
    sequence,
  });
  await notify({
    tripId: invite.tripId,
    recipientIds: [invite.invitedBy],
    severity: "INFO",
    kind: "INVITE_EMAIL_SENT",
    title: sequence > 1 ? `Invitation resent to ${invite.inviteeName}` : `Invite sent to ${invite.inviteeName}`,
    body: `Clockwise emailed ${invite.inviteeName}. We'll nudge them if they haven't joined in time.`,
    href: `/trips/${invite.tripId}/plan/travellers`,
  });
  if (sequence === 1) await scheduleFollowUps(invite.id);
  return { sent: true, providerMessageId: result.providerMessageId, sentAt };
}

// One reminder job (always) and one call job (only with consent + a phone).
// Created once per invite — the idempotency keys make a repeat a no-op.
async function scheduleFollowUps(inviteId: string) {
  const invite = await prisma.invite.findUnique({ where: { id: inviteId } });
  if (!invite || !looksLikeEmail(invite.contact)) return;
  const dueAt = new Date(Date.now() + escalationDelayMinutes() * 60_000);
  const make = async (eventType: string, channel: string, recipient: string, key: string, at: Date) => {
    try {
      return await prisma.scheduledJob.create({
        data: { tripId: invite.tripId, inviteId: invite.id, eventType, channel, recipient, scheduledFor: at, idempotencyKey: key },
      });
    } catch {
      return null; // unique violation = already scheduled
    }
  };
  const reminder = await make("INVITE_REMINDER_EMAIL", "EMAIL", invite.contact!, `job:${invite.id}:REMINDER`, dueAt);
  const call =
    invite.callConsent && invite.phone
      ? await make("INVITE_ESCALATION_CALL", "VOICE", invite.phone, `job:${invite.id}:CALL`, dueAt)
      : null;
  if (reminder || call) {
    await recordEvent(invite.tripId, "INVITE_FOLLOWUP_SCHEDULED", invite.invitedBy, {
      inviteId: invite.id,
      invitee: invite.inviteeName,
      dueAt: dueAt.toISOString(),
      delayMinutes: escalationDelayMinutes(),
      reminderEmail: Boolean(reminder),
      escalationCall: Boolean(call),
    });
  }
}

// The person completed the required action. Whatever was still waiting on it
// stops: the reminder is RESOLVED (the need is gone), the call CANCELLED.
export async function resolveInviteFollowUps(inviteId: string): Promise<{ resolved: number; cancelled: number }> {
  const now = new Date();
  const [resolved, cancelled] = await Promise.all([
    prisma.scheduledJob.updateMany({
      where: { inviteId, status: { in: ["SCHEDULED", "PROCESSING"] }, channel: "EMAIL" },
      data: { status: "RESOLVED", resolvedAt: now },
    }),
    prisma.scheduledJob.updateMany({
      where: { inviteId, status: { in: ["SCHEDULED", "PROCESSING"] }, channel: "VOICE" },
      data: { status: "CANCELLED", resolvedAt: now },
    }),
  ]);
  return { resolved: resolved.count, cancelled: cancelled.count };
}

export async function recordInviteAccepted(inviteId: string) {
  const invite = await prisma.invite.findUnique({ where: { id: inviteId } });
  if (!invite) return;
  const counts = await resolveInviteFollowUps(inviteId);
  await recordEvent(invite.tripId, "INVITE_ACCEPTED", invite.invitedBy, {
    inviteId,
    invitee: invite.inviteeName,
    followUpsResolved: counts.resolved,
    escalationsCancelled: counts.cancelled,
  });
  await notify({
    tripId: invite.tripId,
    recipientIds: [invite.invitedBy],
    severity: "IMPORTANT",
    kind: "INVITE_ACCEPTED",
    title: `${invite.inviteeName} joined the trip`,
    body: `${invite.inviteeName} accepted your invitation.`,
    href: `/trips/${invite.tripId}/plan/travellers`,
  });
}
