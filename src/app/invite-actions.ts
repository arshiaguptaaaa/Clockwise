"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { setCurrentUserId } from "@/lib/session";
import { getClockwiseUserId } from "@/lib/clockwise";
import { emailProvider } from "@/lib/email/resend-provider";
import { tripJoinConfirmationEmail, tripJoinNotificationEmail } from "@/lib/email/templates";
import { ADMIN_NOTIFY_EMAIL } from "@/lib/notify-email";

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
