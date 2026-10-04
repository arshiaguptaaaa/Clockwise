import { prisma } from "@/lib/prisma";
import { getTripById } from "@/lib/trip";
import { getClockwiseUserId } from "@/lib/clockwise";
import { getCurrentUserId } from "@/lib/session";
import { ChatThread } from "@/components/trip-room/ChatThread";
import { BengaluruArt } from "@/components/art/BengaluruArt";
import { postGroupMessage, runGroupAgentTurn } from "@/app/actions";
import { decodeProposalPayload } from "@/lib/proposals";
import type { ProposalCardData } from "@/components/trip-room/ProposalCard";

// Server actions on this page run the agent (model + tool calls), which can take
// 15–30s; give them an explicit budget rather than the platform default.
export const maxDuration = 60;

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
      proposal: {
        select: {
          id: true,
          status: true,
          title: true,
          summary: true,
          payload: true,
          executionResult: true,
          failureReason: true,
          approvals: {
            select: {
              decision: true,
              tripMember: { select: { userId: true, user: { select: { name: true } } } },
            },
          },
        },
      },
    },
    orderBy: { timestamp: "asc" },
  });

  const roster = trip.members.map((m) => ({ id: m.userId, name: m.user.name }));

  function toProposalCardData(p: NonNullable<(typeof messages)[number]["proposal"]>): ProposalCardData {
    return {
      id: p.id,
      status: p.status,
      title: p.title,
      summary: p.summary,
      payload: decodeProposalPayload(p.payload),
      executionResult: p.executionResult,
      failureReason: p.failureReason,
      approvals: p.approvals.map((a) => ({
        userId: a.tripMember.userId,
        name: a.tripMember.user.name,
        decision: a.decision,
      })),
    };
  }

  // A brand-new room (only Clockwise's welcome so far) gets an illustrated nudge.
  const isFresh = messages.length <= 1;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {isFresh && (
        <div className="mx-5 mt-4 flex shrink-0 items-center gap-4 border-b border-border pb-4">
          <BengaluruArt scene="converge" className="tile-in w-24 shrink-0 -rotate-2 shadow-[0_12px_26px_-16px_rgba(20,24,26,0.55)]" />
          <div className="min-w-0">
            <p className="headline headline-md">Start plotting.</p>
            <p className="mt-1 text-[12.5px] leading-snug text-muted-foreground">Say where, when, or what you&apos;re dreaming of. Clockwise keeps everyone&apos;s clock in step.</p>
          </div>
        </div>
      )}
    <ChatThread
      tripId={tripId}
      channel="GROUP"
      messages={messages.map((m) => ({
        id: m.id,
        senderId: m.senderId ?? undefined,
        senderName: m.sender?.name ?? "Unknown",
        content: m.content,
        timestamp: m.timestamp,
        isClockwise: m.senderId === clockwiseUserId,
        failed: m.failed,
        cardType: m.cardType,
        cardData: m.cardData,
        cardStatus: m.cardStatus,
        attachments: m.attachments,
        proposal: m.proposal ? toProposalCardData(m.proposal) : null,
      }))}
      roster={roster}
      currentUserId={currentUserId}
      organiserId={trip.createdBy}
      postAction={postGroupMessage.bind(null, tripId)}
      runAgentAction={runGroupAgentTurn.bind(null, tripId)}
      placeholder="Message the group…"
      emptyText="No messages yet. Say hello to the group."
    />
    </div>
  );
}
