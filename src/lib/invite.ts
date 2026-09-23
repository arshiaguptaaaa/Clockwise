// The one place an Invite row + its optional email get created — used by
// both trip creation (wizard-actions.ts) and inviting someone after the
// trip already exists (invite-actions.ts createInvite). Extracted so
// there is exactly one invite-creation code path, not two.
import { prisma } from "./prisma";
import { generateUniqueInviteToken } from "./invite-token";
import { getAppBaseUrl } from "./site-url";
import { emailProvider } from "./email/resend-provider";
import { tripInviteEmail } from "./email/templates";

export async function createAndEmailInvite(params: {
  tripId: string;
  tripName: string;
  inviterName: string;
  invitedBy: string;
  inviteeName: string;
  contact: string | null;
}): Promise<{ token: string }> {
  const token = await generateUniqueInviteToken();
  await prisma.invite.create({
    data: {
      tripId: params.tripId,
      token,
      inviteeName: params.inviteeName,
      contact: params.contact,
      invitedBy: params.invitedBy,
      status: "PENDING",
    },
  });

  // `contact` is free text (email or phone) — only send when it looks
  // like an email. A phone-only or blank contact still gets a real
  // Invite row and a shareable link (CopyInviteLink /
  // InviteTravellersPanel); it just doesn't get an automatic email.
  // Failure never removes the invite — same "never undo a real row over
  // an email failure" rule as the waitlist flow.
  if (params.contact?.includes("@")) {
    const invite = tripInviteEmail({
      inviterName: params.inviterName,
      tripName: params.tripName,
      inviteUrl: `${getAppBaseUrl()}/invite/${token}`,
    });
    const sent = await emailProvider.send({ to: params.contact, subject: invite.subject, html: invite.html });
    if (!sent.sent) {
      console.warn(`Invite email not sent to ${params.contact}: ${sent.reason}`);
    }
  }

  return { token };
}
