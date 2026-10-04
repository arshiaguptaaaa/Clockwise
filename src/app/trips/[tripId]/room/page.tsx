import { prisma } from "@/lib/prisma";
import { getTripById } from "@/lib/trip";
import { getClockwiseUserId } from "@/lib/clockwise";
import { getCurrentUserId } from "@/lib/session";
import { ChatThread } from "@/components/trip-room/ChatThread";
import { BengaluruArt } from "@/components/art/BengaluruArt";
import { TripHeader } from "@/components/trip-room/TripHeader";
import { whosHere } from "@/lib/whos-here";
import { heroLine } from "@/lib/copy";
import { formatDateRange } from "@/lib/format";
import { collectionsForTrip } from "@/lib/payments/obligations";
import { postGroupMessage, runGroupAgentTurn } from "@/app/actions";
import { decodeProposalPayload } from "@/lib/proposals";
import { describeProposal } from "@/lib/decisions";
import type { ProposalCardData } from "@/components/trip-room/ProposalCard";
import type { IdeaView } from "@/components/ideas/IdeaCard";

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
      reactions: { select: { emoji: true, userId: true }, orderBy: { createdAt: "asc" } },
      proposal: {
        select: {
          id: true,
          status: true,
          type: true,
          supersedesId: true,
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

  const nameOf = new Map(trip.members.map((m) => [m.userId, m.user.name.split(" ")[0]]));
  function groupReactions(rows: { emoji: string; userId: string }[]) {
    const by = new Map<string, { emoji: string; userIds: string[]; names: string[] }>();
    for (const r of rows) {
      const g = by.get(r.emoji) ?? { emoji: r.emoji, userIds: [], names: [] };
      g.userIds.push(r.userId);
      g.names.push(nameOf.get(r.userId) ?? "Someone");
      by.set(r.emoji, g);
    }
    return [...by.values()];
  }

  const roster = trip.members.map((m) => ({ id: m.userId, name: m.user.name }));

  function toProposalCardData(p: NonNullable<(typeof messages)[number]["proposal"]>): ProposalCardData {
    const payload = decodeProposalPayload(p.payload);
    const d = describeProposal({ title: p.title, type: p.type, payload });
    return {
      id: p.id,
      status: p.status,
      title: p.title,
      summary: p.summary,
      payload,
      headline: d.headline,
      kind: d.kind,
      change: d.change,
      because: d.because,
      retry: Boolean(p.supersedesId),
      executionResult: p.executionResult,
      failureReason: p.failureReason,
      // Stable, human order (the roster's), not whichever vote landed last.
      approvals: p.approvals
        .map((a) => ({ userId: a.tripMember.userId, name: a.tripMember.user.name, decision: a.decision }))
        .sort((x, y) => trip.members.findIndex((m) => m.userId === x.userId) - trip.members.findIndex((m) => m.userId === y.userId)),
    };
  }

  // A brand-new room (only Clockwise's welcome so far) gets an illustrated nudge.
  const isFresh = messages.length <= 1;

  const place = trip.destinations[0]?.city ?? trip.destinations[0]?.name ?? trip.name;
  const dates = trip.coreStartDate && trip.coreEndDate ? formatDateRange(trip.coreStartDate, trip.coreEndDate, "short").toUpperCase() : "DATES TO DECIDE";
  const days = trip.coreStartDate && trip.coreEndDate ? Math.round((trip.coreEndDate.getTime() - trip.coreStartDate.getTime()) / 86_400_000) + 1 : null;
  const people = await whosHere(trip.id, trip.members);
  const collections = await collectionsForTrip(trip.id, currentUserId);
  // Ideas render from their LIVE row (OPEN / PROPOSED / DISMISSED / CONFIRMED), not from the card's first snapshot.
  const suggestionRows = await prisma.tripSuggestion.findMany({ where: { tripId: trip.id } });
  const introBySuggestion = new Map<string, string | null>();
  for (const m of messages) {
    if (m.cardType !== "IDEA" || !m.cardData) continue;
    try {
      const d = (JSON.parse(m.cardData) as { idea?: { suggestionId: string; intro: string | null } }).idea;
      if (d) introBySuggestion.set(d.suggestionId, d.intro ?? null);
    } catch {
      // unreadable card: shown without its intro
    }
  }
  const ideas: IdeaView[] = suggestionRows.map((s) => ({ suggestionId: s.id, title: s.title, why: s.why, intro: introBySuggestion.get(s.id) ?? null, windowLabel: "", steps: JSON.parse(s.steps), status: s.status }));
  const late = people.find((p) => p.tone === "late");
  const voiceLine = late ? `${late.name.split(" ")[0]}'s running late. I'll keep everyone together.` : "Everyone's on a different clock. I'll keep them together.";
  const header = (
    <>
      <TripHeader
        tripId={tripId}
        place={place}
        dates={dates}
        tagline={heroLine(trip.members.length)}
        voice={voiceLine}
        people={people}
        isOrganiser={currentUserId === trip.createdBy}
        viewerId={currentUserId}
      />
      {isFresh && (
        <div className="mx-5 mt-4 flex shrink-0 items-center gap-4 border-b border-border pb-4">
          <BengaluruArt scene="converge" className="tile-in w-24 shrink-0 -rotate-2 shadow-[0_12px_26px_-16px_rgba(20,24,26,0.55)]" />
          <div className="min-w-0">
            <p className="headline headline-md">Start plotting.</p>
            <p className="mt-1 text-[12.5px] leading-snug text-muted-foreground">Say where, when, or what you&apos;re dreaming of. Clockwise keeps everyone&apos;s clock in step.</p>
          </div>
        </div>
      )}
    </>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
    <ChatThread
      header={header}
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
        reactions: groupReactions(m.reactions),
      }))}
      roster={roster}
      collections={collections}
      ideas={ideas}
      currentUserId={currentUserId}
      organiserId={trip.createdBy}
      organiserName={trip.members.find((m) => m.userId === trip.createdBy)?.user.name ?? "the organiser"}
      postAction={postGroupMessage.bind(null, tripId)}
      runAgentAction={runGroupAgentTurn.bind(null, tripId)}
      placeholder="Message the group…"
      emptyText="No messages yet. Say hello to the group."
    />
    </div>
  );
}
