"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId, setCurrentUserId } from "@/lib/session";
import { getClockwiseUserId } from "@/lib/clockwise";
import { emailProvider } from "@/lib/email/resend-provider";
import { tripJoinConfirmationEmail, tripJoinNotificationEmail } from "@/lib/email/templates";
import { ADMIN_NOTIFY_EMAIL } from "@/lib/notify-email";
import { createInviteOnly, sendInviteEmail, emailTestRecipient } from "@/lib/invite";
import { recordInviteAccepted } from "@/lib/invite-engine";
import { ensureJoinCode, rotateJoinCode, normaliseJoinCode, MAX_MEMBERS_VIA_LINK } from "@/lib/join-link";
import { notify } from "@/lib/notifications";

export type CreateInviteResult =
  | { ok: true; token: string; inviteId: string; looksLikeEmail: boolean; looksLikePhone: boolean }
  | { ok: false; error: string };

const PHONE_PATTERN = /^[+\d][\d\s().-]{5,}$/;

async function assertOrganiser(tripId: string, actorId: string | null) {
  if (!actorId) return { ok: false as const, error: "Sign in first." };
  const trip = await prisma.trip.findUnique({ where: { id: tripId } });
  if (!trip) return { ok: false as const, error: "Trip not found." };
  if (trip.createdBy !== actorId) return { ok: false as const, error: "Only the trip organiser can invite travellers." };
  return { ok: true as const, trip };
}

// Invite Travellers panel's "Generate invite" — creates the Invite row
// ONLY (real Postgres write via createInviteOnly), no automatic email or
// SMS. Generating a link must always succeed independent of any delivery
// rail — sending is a separate, explicit action the organiser triggers
// after seeing the URL (sendInviteEmailAction below; SMS not implemented,
// see the panel for why).
export async function createInvite(tripId: string, name: string, contact: string): Promise<CreateInviteResult> {
  const actorId = await getCurrentUserId();
  const auth = await assertOrganiser(tripId, actorId);
  if (!auth.ok) return { ok: false, error: auth.error };

  const trimmedName = name.trim() || "Traveller";
  const trimmedContact = contact.trim();

  const { token, inviteId } = await createInviteOnly({
    tripId,
    inviteeName: trimmedName,
    contact: trimmedContact || null,
    invitedBy: actorId!,
  });

  revalidatePath(`/trips/${tripId}/room`);
  revalidatePath(`/trips/${tripId}/plan/travellers`);
  return {
    ok: true,
    token,
    inviteId,
    looksLikeEmail: trimmedContact.includes("@"),
    looksLikePhone: !trimmedContact.includes("@") && PHONE_PATTERN.test(trimmedContact),
  };
}

export type SendInviteEmailResult = { ok: true } | { ok: false; error: string };

// Explicit "Send by email" / "Resend" — delivers for an EXISTING invite,
// never creates a new token/row. Organiser-only, re-checked here (not
// just trusted from a client-supplied inviteId).
export async function sendInviteEmailAction(tripId: string, inviteId: string): Promise<SendInviteEmailResult> {
  const actorId = await getCurrentUserId();
  const auth = await assertOrganiser(tripId, actorId);
  if (!auth.ok) return { ok: false, error: auth.error };

  const invite = await prisma.invite.findFirst({ where: { id: inviteId, tripId } });
  if (!invite) return { ok: false, error: "Invite not found." };

  const result = await sendInviteEmail(inviteId);
  revalidatePath(`/trips/${tripId}/room`);
  revalidatePath(`/trips/${tripId}/plan/travellers`);
  return result.sent ? { ok: true } : { ok: false, error: result.reason ?? "Couldn't send the email." };
}

export type PendingInviteView = {
  id: string;
  token: string;
  inviteeName: string;
  contact: string | null;
  emailSent: boolean;
};

// Read-only — the Invite Travellers panel's "Pending invites" list, so a
// generated link is recoverable after closing/reopening the panel instead
// of being lost. Organiser-only (matches who can act on these).
export async function getPendingInvites(tripId: string): Promise<PendingInviteView[]> {
  const actorId = await getCurrentUserId();
  const auth = await assertOrganiser(tripId, actorId);
  if (!auth.ok) return [];

  const invites = await prisma.invite.findMany({
    where: { tripId, status: "PENDING" },
    orderBy: { createdAt: "desc" },
  });
  return invites.map((i) => ({
    id: i.id,
    token: i.token,
    inviteeName: i.inviteeName,
    contact: i.contact,
    emailSent: Boolean(i.emailSentAt),
  }));
}

// Deliberately the first and only place a real TripMember gets created for
// an invited traveller — see build notes on Invite: no "ghost" member
// exists before this moment. The organiser never enters this person's
// private information; everything from here on is theirs to tell
// Clockwise directly.
export async function acceptInvite(token: string) {
  const invite = await prisma.invite.findUnique({ where: { token } });
  if (!invite) {
    throw new Error("This invite link isn't valid.");
  }

  if (invite.status === "ACCEPTED" && invite.acceptedByUserId) {
    // Already used — just sign back in as whoever accepted it rather than
    // creating a second person for the same invite.
    await setCurrentUserId(invite.acceptedByUserId);
    redirect(`/trips/${invite.tripId}/agent`);
  }

  const trip = await prisma.trip.findUniqueOrThrow({ where: { id: invite.tripId } });
  const newUser = await prisma.user.create({ data: { name: invite.inviteeName } });

  await prisma.tripMember.create({
    data: {
      tripId: invite.tripId,
      userId: newUser.id,
      role: "TRAVELLER",
      participationStart: trip.coreStartDate,
      participationEnd: trip.coreEndDate,
    },
  });

  await prisma.invite.update({
    where: { id: invite.id },
    data: { status: "ACCEPTED", acceptedByUserId: newUser.id, acceptedAt: new Date() },
  });

  // The required action is done: stop the reminder and cancel any call, and tell the organiser.
  await recordInviteAccepted(invite.id);

  const clockwiseUserId = await getClockwiseUserId();
  await prisma.message.create({
    data: {
      tripId: invite.tripId,
      senderId: clockwiseUserId,
      channel: "PRIVATE",
      recipientId: newUser.id,
      content:
        "Anything you tell me here stays within the permissions you choose — I'll use it to help coordinate your part of the trip without unnecessarily sharing your private information with the group.\n\nBefore we start, is there anything about this trip I should know privately?",
    },
  });

  const testRecipient = emailTestRecipient();
  // While email is in sandbox mode every message is redirected to one inbox, so
  // these two secondary mails would only pile into the tester's inbox and blur
  // the invitation/reminder test. They resume automatically once the override is removed.
  const sandboxActive = Boolean(testRecipient);

  // Email failures never undo the join or block the redirect below — the
  // TripMember row is already saved regardless of delivery outcome, same
  // rule the waitlist flow already follows.
  if (!sandboxActive && invite.contact?.includes("@")) {
    const confirmation = tripJoinConfirmationEmail({ tripName: trip.name });
    const confirmationResult = await emailProvider.send({
      to: testRecipient ?? invite.contact,
      subject: confirmation.subject,
      html: confirmation.html,
    });
    if (!confirmationResult.sent) {
      console.warn(`Trip-join confirmation email not sent to ${invite.contact}: ${confirmationResult.reason}`);
    }
  }

  if (!sandboxActive) {
    const notification = tripJoinNotificationEmail({
      inviteeName: invite.inviteeName,
      tripName: trip.name,
      joinedAt: new Date(),
    });
    const notificationResult = await emailProvider.send({
      to: ADMIN_NOTIFY_EMAIL,
      subject: notification.subject,
      html: notification.html,
    });
    if (!notificationResult.sent) {
      console.warn(`Trip-join admin notification not sent: ${notificationResult.reason}`);
    }
  }

  await setCurrentUserId(newUser.id);
  redirect(`/trips/${invite.tripId}/agent`);
}

// ---- Persistent group join link (/join/<code>) --------------------------------------------

// Any member may read or create the link (friends bring friends); only the organiser rotates it.
export async function getJoinCodeAction(tripId: string): Promise<{ ok: true; code: string; isOrganiser: boolean } | { ok: false; error: string }> {
  const actorId = await getCurrentUserId();
  if (!actorId) return { ok: false, error: "Sign in first." };
  const member = await prisma.tripMember.findUnique({ where: { tripId_userId: { tripId, userId: actorId } } });
  if (!member) return { ok: false, error: "You're not on this trip." };
  const trip = await prisma.trip.findUniqueOrThrow({ where: { id: tripId }, select: { createdBy: true } });
  return { ok: true, code: await ensureJoinCode(tripId), isOrganiser: trip.createdBy === actorId };
}

export async function rotateJoinCodeAction(tripId: string): Promise<{ ok: true; code: string } | { ok: false; error: string }> {
  const actorId = await getCurrentUserId();
  const auth = await assertOrganiser(tripId, actorId);
  if (!auth.ok) return { ok: false, error: auth.error };
  return { ok: true, code: await rotateJoinCode(tripId) };
}

// The only way a stranger becomes a member without a named invite. They choose what to be
// called; everything private (Vibe Check, journey, saves) starts empty and stays theirs.
export async function joinByCode(code: string, formData: FormData) {
  const name = String(formData.get("name") ?? "").trim().replace(/\s+/g, " ").slice(0, 40);
  const normalised = normaliseJoinCode(code);
  const trip = normalised ? await prisma.trip.findUnique({ where: { joinCode: normalised }, include: { members: { select: { userId: true } } } }) : null;
  if (!trip) redirect(`/join/${encodeURIComponent(normalised || "invalid")}`);

  // Already here on this device: just go in.
  const existing = await getCurrentUserId();
  if (existing && trip.members.some((m) => m.userId === existing)) redirect(`/trips/${trip.id}/room`);

  if (!name) redirect(`/join/${normalised}?error=name`);
  if (trip.members.length >= MAX_MEMBERS_VIA_LINK) redirect(`/join/${normalised}?error=full`);

  const user = await prisma.user.create({ data: { name } });
  await prisma.tripMember.create({
    data: { tripId: trip.id, userId: user.id, role: "TRAVELLER", participationStart: trip.coreStartDate, participationEnd: trip.coreEndDate },
  });
  const clockwiseUserId = await getClockwiseUserId();
  await prisma.message.create({
    data: {
      tripId: trip.id,
      senderId: clockwiseUserId,
      channel: "PRIVATE",
      recipientId: user.id,
      content:
        "Anything you tell me here stays within the permissions you choose — I'll use it to help coordinate your part of the trip without unnecessarily sharing your private information with the group.\n\nBefore we start, is there anything about this trip I should know privately?",
    },
  });
  await prisma.auditLog.create({ data: { tripId: trip.id, actorId: user.id, actionType: "MEMBER_JOINED_VIA_LINK", payloadSummary: `${name} joined through the group join link.` } });
  await notify({ tripId: trip.id, recipientIds: [trip.createdBy], severity: "INFO", kind: "MEMBER_JOINED", title: `${name.split(" ")[0]} joined`, body: "They used the group link.", href: `/trips/${trip.id}/room` });

  await setCurrentUserId(user.id);
  revalidatePath(`/trips/${trip.id}/room`);
  redirect(`/trips/${trip.id}/agent`);
}
