"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId, setCurrentUserId } from "@/lib/session";
import { getClockwiseUserId } from "@/lib/clockwise";
import { emailProvider } from "@/lib/email/resend-provider";
import { tripJoinConfirmationEmail, tripJoinNotificationEmail } from "@/lib/email/templates";
import { ADMIN_NOTIFY_EMAIL } from "@/lib/notify-email";
import { createAndEmailInvite } from "@/lib/invite";

export type CreateInviteResult = { ok: true; token: string } | { ok: false; error: string };

// Invite someone to an EXISTING trip — the only invite-creation path
// before this was inline in createTrip() (wizard-actions.ts), run once at
// trip setup, with no way to invite anyone afterward. This reuses the
// exact same createAndEmailInvite() helper, not a parallel system.
// Organiser-only, matching how naming travellers during trip creation was
// always implicitly organiser-scoped (only the creator fills that form).
export async function createInvite(
  tripId: string,
  name: string,
  contact: string
): Promise<CreateInviteResult> {
  const actorId = await getCurrentUserId();
  if (!actorId) return { ok: false, error: "Sign in first." };

  const [trip, actor] = await Promise.all([
    prisma.trip.findUnique({ where: { id: tripId } }),
    prisma.user.findUnique({ where: { id: actorId } }),
  ]);
  if (!trip) return { ok: false, error: "Trip not found." };
  if (trip.createdBy !== actorId) return { ok: false, error: "Only the trip organiser can invite travellers." };

  const trimmedName = name.trim() || "Traveller";
  const trimmedContact = contact.trim();

  const { token } = await createAndEmailInvite({
    tripId,
    tripName: trip.name,
    inviterName: actor?.name ?? "Your trip organiser",
    invitedBy: actorId,
    inviteeName: trimmedName,
    contact: trimmedContact || null,
  });

  revalidatePath(`/trips/${tripId}/room`);
  revalidatePath(`/trips/${tripId}/plan/travellers`);
  return { ok: true, token };
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

  // Email failures never undo the join or block the redirect below — the
  // TripMember row is already saved regardless of delivery outcome, same
  // rule the waitlist flow already follows.
  if (invite.contact?.includes("@")) {
    const confirmation = tripJoinConfirmationEmail({ tripName: trip.name });
    const confirmationResult = await emailProvider.send({
      to: invite.contact,
      subject: confirmation.subject,
      html: confirmation.html,
    });
    if (!confirmationResult.sent) {
      console.warn(`Trip-join confirmation email not sent to ${invite.contact}: ${confirmationResult.reason}`);
    }
  }

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

  await setCurrentUserId(newUser.id);
  redirect(`/trips/${invite.tripId}/agent`);
}
