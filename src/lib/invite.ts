// The one place Invite rows get created and emailed — used by trip
// creation (wizard-actions.ts, auto-email at creation time, unchanged
// behavior) and by inviting someone after the trip already exists
// (invite-actions.ts, explicit create-then-send). Extracted so there is
// exactly one invite-creation code path, not two, and exactly one
// email-sending code path, not two.
import { prisma } from "./prisma";
import { generateUniqueInviteToken } from "./invite-token";
import { getAppBaseUrl } from "./site-url";
import { emailProvider } from "./email/resend-provider";
import { tripInviteEmail } from "./email/templates";
import type { Invite } from "@prisma/client";

// Despite the name (kept as-is to avoid requiring a Vercel env var
// rename on an already-configured production value), this now gates
// EVERY transactional email this app sends while Resend is in test mode
// — not just waitlist. The Resend account itself is currently restricted
// to delivering only to this one address (confirmed live — see commit
// history); redirecting the `to` field is the only way "Send by email"
// is genuinely testable right now instead of failing every time with the
// same 403. Subject/body are always the real production content —
// nothing test-mode-flavored is ever visible to whoever receives it.
export function emailTestRecipient(): string | null {
  return process.env.WAITLIST_EMAIL_TEST_RECIPIENT?.trim() || null;
}

async function sendInviteEmailNow(params: {
  invite: Pick<Invite, "id" | "token" | "contact">;
  tripName: string;
  inviterName: string;
  destinations: string[];
}): Promise<{ sent: boolean; reason?: string }> {
  if (!params.invite.contact?.includes("@")) {
    return { sent: false, reason: "This invite has no email address on file." };
  }

  const email = tripInviteEmail({
    inviterName: params.inviterName,
    tripName: params.tripName,
    inviteUrl: `${getAppBaseUrl()}/invite/${params.invite.token}`,
    destinations: params.destinations,
  });
  const to = emailTestRecipient() ?? params.invite.contact;
  const result = await emailProvider.send({ to, subject: email.subject, html: email.html });

  if (result.sent) {
    await prisma.invite.update({ where: { id: params.invite.id }, data: { emailSentAt: new Date() } });
    return { sent: true };
  }
  console.warn(`Invite email not sent to ${params.invite.contact}: ${result.reason}`);
  return { sent: false, reason: result.reason };
}

// Trip creation (wizard-actions.ts) — creates the row and immediately
// attempts an email if the contact looks like one. Email failure never
// removes the invite — same "never undo a real row over an email
// failure" rule as the waitlist flow. Unchanged behavior from before this
// file was split.
export async function createAndEmailInvite(params: {
  tripId: string;
  tripName: string;
  inviterName: string;
  invitedBy: string;
  inviteeName: string;
  contact: string | null;
  destinations?: string[];
}): Promise<{ token: string }> {
  const token = await generateUniqueInviteToken();
  const invite = await prisma.invite.create({
    data: {
      tripId: params.tripId,
      token,
      inviteeName: params.inviteeName,
      contact: params.contact,
      invitedBy: params.invitedBy,
      status: "PENDING",
    },
  });

  await sendInviteEmailNow({
    invite,
    tripName: params.tripName,
    inviterName: params.inviterName,
    destinations: params.destinations ?? [],
  });

  return { token };
}

// Invite Travellers panel's "Generate invite" — creates the row ONLY, no
// automatic email. Generating a link must always work independent of
// Resend/any delivery rail; sending is a separate, explicit action
// (sendInviteEmail below) the organiser triggers themselves.
export async function createInviteOnly(params: {
  tripId: string;
  inviteeName: string;
  contact: string | null;
  invitedBy: string;
}): Promise<{ token: string; inviteId: string }> {
  const token = await generateUniqueInviteToken();
  const invite = await prisma.invite.create({
    data: {
      tripId: params.tripId,
      token,
      inviteeName: params.inviteeName,
      contact: params.contact,
      invitedBy: params.invitedBy,
      status: "PENDING",
    },
  });
  return { token, inviteId: invite.id };
}

// Explicit "Send by email" / "Resend" for an EXISTING invite — never
// creates a new token/row, just (re-)attempts delivery for the one that
// already exists.
export async function sendInviteEmail(inviteId: string): Promise<{ sent: boolean; reason?: string }> {
  const invite = await prisma.invite.findUnique({ where: { id: inviteId } });
  if (!invite) return { sent: false, reason: "Invite not found." };

  const trip = await prisma.trip.findUnique({
    where: { id: invite.tripId },
    include: { destinations: { orderBy: { order: "asc" } } },
  });
  if (!trip) return { sent: false, reason: "Trip not found." };

  const inviter = await prisma.user.findUnique({ where: { id: invite.invitedBy } });

  return sendInviteEmailNow({
    invite,
    tripName: trip.name,
    inviterName: inviter?.name ?? "Your trip organiser",
    destinations: trip.destinations.map((d) => d.name),
  });
}
