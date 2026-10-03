import { prisma } from "@/lib/prisma";
import { getTripById } from "@/lib/trip";
import { getClockwiseUserId } from "@/lib/clockwise";
import { getCurrentUserId } from "@/lib/session";
import { ChatThread } from "@/components/trip-room/ChatThread";
import { postPrivateMessage, runPrivateAgentTurn } from "@/app/actions";
import { ConnectedServices } from "@/components/my-clockwise/ConnectedServices";
import { CriticalTripAlerts } from "@/components/my-clockwise/CriticalTripAlerts";
import { liveLocationOffer } from "@/lib/readiness-engine";
import { CharacterScene, SpeechBubble } from "@/components/art/CharacterScene";
import { LiveLocationCard } from "@/components/my-clockwise/LiveLocationCard";
import { getTripStay } from "@/lib/stays";
import { VibeCheck } from "@/components/vibe/VibeCheck";
import { getVibeStatus, getPrefs, questionsToAsk } from "@/lib/traveller/vibe";

// Server actions on this page run the agent (model + tool calls), which can take
// 15–30s; give them an explicit budget rather than the platform default.
export const maxDuration = 60;

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
  searchParams: Promise<{ uber?: string; vibe?: string }>;
}) {
  const { tripId } = await params;
  const { uber: uberStatus, vibe: vibeParam } = await searchParams;
  const [trip, clockwiseUserId, currentUserId] = await Promise.all([
    getTripById(tripId),
    getClockwiseUserId(),
    getCurrentUserId(),
  ]);

  const stay = await getTripStay(tripId);
  // "Later" on the vibe check leaves a way back: ?vibe=1 (linked from Ready?).
  let vibeGate: React.ReactNode = null;
  if (vibeParam && currentUserId && (await getVibeStatus(tripId, currentUserId)) === "DEFERRED") {
    const prefs = await getPrefs(tripId, currentUserId);
    const j = await prisma.travellerJourney.findFirst({ where: { tripId, userId: currentUserId, status: "CONFIRMED" } });
    const me = trip.members.find((m) => m.userId === currentUserId)?.user.name ?? "there";
    vibeGate = <VibeCheck tripId={tripId} firstName={me.split(" ")[0]} questions={questionsToAsk(prefs, { origin: j?.originName, mode: j?.mode })} />;
  }
  const messages = await prisma.message.findMany({
    where: { tripId: trip.id, channel: "PRIVATE", recipientId: currentUserId },
    include: {
      sender: true,
      attachments: { select: { id: true, filename: true } },
    },
    orderBy: { timestamp: "asc" },
  });

  // Contextual only: offered when this traveller has a commitment coming up.
  const offer = currentUserId ? await liveLocationOffer(tripId, currentUserId) : null;

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
      {vibeGate}
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-2.5">
        <div>
          <p className="font-display text-xl font-medium leading-tight text-foreground">My Clockwise</p>
          <p className="text-xs text-muted-foreground">Private · Only you and Clockwise</p>
        </div>
        <div className="relative w-14 shrink-0">
          <CharacterScene scene="memories" tilt={4} sizes="60px" />
          <SpeechBubble className="absolute -left-[5.5rem] top-0 z-10 w-max" tail="right">
            Just between us.
          </SpeechBubble>
        </div>
      </div>

      {stay && (
        <div className="shrink-0 border-b border-border bg-surface-muted px-4 py-2 text-xs text-foreground" data-my-stay>
          <span className="font-semibold uppercase tracking-wider text-muted-foreground">Your stay</span>{" "}
          {stay.placeName} {stay.status === "CONFIRMED" ? "✓ booked" : "· approved, not booked yet"}
        </div>
      )}

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

      {offer?.commitment && (
        <LiveLocationCard
          tripId={tripId}
          commitmentName={offer.commitment.name}
          commitmentTimeLabel={offer.commitment.targetTime.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" })}
          initialConsent={offer.consent}
        />
      )}

      <ChatThread
        tripId={tripId}
        channel="PRIVATE"
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
          // Proposals are always posted to GROUP (a proposal is inherently
          // group-visible even when the idea originated in a private
          // conversation) — PRIVATE messages never carry one.
          proposal: null,
        }))}
        roster={roster}
        currentUserId={currentUserId}
        organiserId={trip.createdBy}
        postAction={postPrivateMessage.bind(null, tripId)}
        runAgentAction={runPrivateAgentTurn.bind(null, tripId)}
        placeholder="Message Clockwise privately…"
        emptyText="This is your private space with Clockwise. Ask about your schedule, budget, documents, or anything you don't want discussed in the group."
        suggestions={suggestions}
      />
    </div>
  );
}
