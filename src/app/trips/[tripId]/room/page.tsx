import { prisma } from "@/lib/prisma";
import { getTripById } from "@/lib/trip";
import { getClockwiseUserId } from "@/lib/clockwise";
import { getCurrentUserId } from "@/lib/session";
import { ChatThread } from "@/components/trip-room/ChatThread";
import { postGroupMessage, runGroupAgentTurn } from "@/app/actions";

export default async function TripRoomChatPage({
  params,
}: {
  params: Promise<{ tripId: string }>;
}) {
  const { tripId } = await params;
  const [trip, clockwiseUserId, currentUserId] = await Promise.all([
    getTripById(tripId),
    getClockwiseUserId(),
    getCurrentUserId(),
  ]);

  const messages = await prisma.message.findMany({
    where: { tripId: trip.id, channel: "GROUP" },
    include: {
      sender: true,
      // select-only, never blobUrl/blobPathname — see the same reasoning
      // in src/app/trips/[tripId]/room/files/page.tsx.
      attachments: { select: { id: true, filename: true } },
    },
    orderBy: { timestamp: "asc" },
  });

  const roster = trip.members.map((m) => ({ id: m.userId, name: m.user.name }));

  return (
    <ChatThread
      tripId={tripId}
      channel="GROUP"
      messages={messages.map((m) => ({
        id: m.id,
        senderName: m.sender?.name ?? "Unknown",
        content: m.content,
        timestamp: m.timestamp,
        isClockwise: m.senderId === clockwiseUserId,
        failed: m.failed,
        cardType: m.cardType,
        cardData: m.cardData,
        cardStatus: m.cardStatus,
        attachments: m.attachments,
      }))}
      roster={roster}
      currentUserId={currentUserId}
      postAction={postGroupMessage.bind(null, tripId)}
      runAgentAction={runGroupAgentTurn.bind(null, tripId)}
      placeholder="Message the group…"
      emptyText="No messages yet. Say hello to the group."
    />
  );
}
