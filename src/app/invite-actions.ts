"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { setCurrentUserId } from "@/lib/session";
import { getClockwiseUserId } from "@/lib/clockwise";

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

  await setCurrentUserId(newUser.id);
  redirect(`/trips/${invite.tripId}/agent`);
}
