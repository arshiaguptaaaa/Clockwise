// Thin compatibility layer over invite-engine.ts. There is exactly one invite
// creation path and one email-sending path (the engine); these exports keep the
// existing callers (trip creation, the Invite panel) unchanged.
import { createInviteRecord, sendInvitation } from "./invite-engine";
import { prisma } from "./prisma";

// Legacy name: the single address emails were redirected to in test mode. The
// delivery layer (email/deliver.ts) now owns this and records both the
// intended and the actual recipient; kept so existing imports still compile.
export function emailTestRecipient(): string | null {
  return process.env.EMAIL_DELIVERY_OVERRIDE?.trim() || process.env.WAITLIST_EMAIL_TEST_RECIPIENT?.trim() || null;
}

// Trip creation: create the invite and email it immediately. A failed email
// never removes the invite (it can be resent).
export async function createAndEmailInvite(params: {
  tripId: string;
  tripName: string;
  inviterName: string;
  invitedBy: string;
  inviteeName: string;
  contact: string | null;
  phone?: string | null;
  callConsent?: boolean;
  destinations?: string[];
}): Promise<{ token: string }> {
  const { inviteId, token } = await createInviteRecord({
    tripId: params.tripId,
    invitedBy: params.invitedBy,
    inviteeName: params.inviteeName,
    contact: params.contact,
    phone: params.phone,
    callConsent: params.callConsent,
  });
  const result = await sendInvitation(inviteId);
  if (!result.sent) console.warn(`Invite email not sent for invite ${inviteId}: ${result.reason}`);
  return { token };
}

// Invite panel "Generate invite": creates the row only, no email.
export async function createInviteOnly(params: {
  tripId: string;
  inviteeName: string;
  contact: string | null;
  invitedBy: string;
}): Promise<{ token: string; inviteId: string }> {
  return createInviteRecord({ tripId: params.tripId, invitedBy: params.invitedBy, inviteeName: params.inviteeName, contact: params.contact });
}

// Explicit "Send by email" / "Resend" for an EXISTING invite.
export async function sendInviteEmail(inviteId: string): Promise<{ sent: boolean; reason?: string }> {
  const invite = await prisma.invite.findUnique({ where: { id: inviteId }, select: { sendCount: true } });
  const result = await sendInvitation(inviteId, { resend: (invite?.sendCount ?? 0) > 0 });
  return result.sent ? { sent: true } : { sent: false, reason: result.reason };
}
