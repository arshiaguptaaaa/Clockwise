import { prisma } from "@/lib/prisma";
import { getTripById } from "@/lib/trip";
import { getClockwiseUserId } from "@/lib/clockwise";
import { getCurrentUserId } from "@/lib/session";
import { ChatThread } from "@/components/trip-room/ChatThread";
import { postPrivateMessage, runPrivateAgentTurn } from "@/app/actions";
import { ConnectedServices } from "@/components/my-clockwise/ConnectedServices";
import { CriticalTripAlerts } from "@/components/my-clockwise/CriticalTripAlerts";

const UBER_STATUS_MESSAGES: Record<string, string> = {
  connected: "Uber connected.",
  denied: "Uber connection cancelled.",
  error: "Couldn't connect Uber — please try again.",
  not_configured: "Uber isn't configured for this environment yet.",
  not_organiser: "Only the trip organiser can connect Uber.",
};

export default async function MyClockwisePage({
  params,
  searchParams,
}: {
  params: Promise<{ tripId: string }>;
  searchParams: Promise<{ uber?: string }>;
}) {
  const { tripId } = await params;
  const { uber: uberStatus } = await searchParams;
  const [trip, clockwiseUserId, currentUserId] = await Promise.all([
    getTripById(tripId),
    getClockwiseUserId(),
    getCurrentUserId(),
  ]);

  const messages = await prisma.message.findMany({
    where: { tripId: trip.id, channel: "PRIVATE", recipientId: currentUserId },
    include: {
      sender: true,
      attachments: { select: { id: true, filename: true } },
    },
    orderBy: { timestamp: "asc" },
  });

  const roster = trip.members.map((m) => ({ id: m.userId, name: m.user.name }));

  // Only surface quick-reply prompts on a traveller's very first visit —
  // exactly one message (the automatic welcome) and nothing from them yet.
  const isFirstVisit = messages.length === 1 && messages[0].senderId === clockwiseUserId;
  const suggestions = isFirstVisit
    ? [
        "I can only join partway through",
        "I have a dietary restriction",
        "I'm on a tighter budget",
        "Nothing for now",
      ]
    : undefined;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 border-b border-border px-4 py-2.5">
        <p className="text-sm font-semibold text-foreground">My Clockwise</p>
        <p className="text-xs text-muted-foreground">Private · Only you and Clockwise</p>
      </div>

      {uberStatus && UBER_STATUS_MESSAGES[uberStatus] && (
        <div className="shrink-0 border-b border-border bg-surface-muted px-4 py-2 text-xs text-foreground">
          {UBER_STATUS_MESSAGES[uberStatus]}
        </div>
      )}

      {currentUserId && <ConnectedServices tripId={tripId} viewerId={currentUserId} />}
      {currentUserId &&
        (() => {
          const self = trip.members.find((m) => m.userId === currentUserId)?.user;
          return (
            <CriticalTripAlerts
              initialOptIn={self?.voiceEscalationOptIn ?? false}
              initialPhone={self?.phone ?? null}
            />
          );
        })()}

      <ChatThread
        tripId={tripId}
        channel="PRIVATE"
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
        postAction={postPrivateMessage.bind(null, tripId)}
        runAgentAction={runPrivateAgentTurn.bind(null, tripId)}
        placeholder="Message Clockwise privately…"
        emptyText="This is your private space with Clockwise. Ask about your schedule, budget, documents, or anything you don't want discussed in the group."
        suggestions={suggestions}
      />
    </div>
  );
}
