import { prisma } from "@/lib/prisma";
import { getTripById } from "@/lib/trip";
import { getClockwiseUserId } from "@/lib/clockwise";
import { getCurrentUserId } from "@/lib/session";
import { ChatThread } from "@/components/trip-room/ChatThread";
import { postPrivateMessage, runPrivateAgentTurn } from "@/app/actions";
import { ConnectedServices } from "@/components/my-clockwise/ConnectedServices";
import { CriticalTripAlerts } from "@/components/my-clockwise/CriticalTripAlerts";
import { liveLocationOffer } from "@/lib/readiness-engine";
import { LiveLocationCard } from "@/components/my-clockwise/LiveLocationCard";
import { getTripStay } from "@/lib/stays";
import Link from "next/link";
import { owedBy } from "@/lib/payments/obligations";
import { formatMoney } from "@/lib/budget/money";
import { timeLabel } from "@/lib/traveller/journey";
import { VibeCheck } from "@/components/vibe/VibeCheck";
import { getVibeStatus, getPrefs, questionsToAsk } from "@/lib/traveller/vibe";
import { loadPointers } from "@/lib/pointers/store";
import { PointerCard } from "@/components/plan/PointerCard";
import { notesForViewer } from "@/lib/private-notes";

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

  const me = trip.members.find((m) => m.userId === currentUserId)?.user;
  const [journey, savedCount, owed] = await Promise.all([
    currentUserId ? prisma.travellerJourney.findFirst({ where: { tripId, userId: currentUserId, status: "CONFIRMED" }, orderBy: { createdAt: "desc" } }) : null,
    currentUserId ? prisma.savedPlace.count({ where: { tripId, userId: currentUserId } }) : 0,
    currentUserId ? owedBy(tripId, currentUserId) : [],
  ]);
  const owedTotal = owed.reduce((n, o) => n + o.amountMinor, 0);
  // What Clockwise picked up about THIS traveller from the group chat (they can remove any of it).
  const remembered = currentUserId ? (await loadPointers(tripId)).filter((p) => p.userId === currentUserId) : [];
  const passedOn = currentUserId ? await notesForViewer(tripId, currentUserId, { all: true }).catch(() => []) : [];
  const foodPrefs = currentUserId ? (await getPrefs(tripId, currentUserId)).food ?? [] : [];
  const rows: { href: string; label: string; value: string; hot?: boolean }[] = [
    { href: `/trips/${tripId}/agent/journey`, label: "Journey", value: journey ? `${journey.originName ?? "?"} → ${journey.destinationName ?? "?"}${journey.arriveLocal ? ` · lands ${timeLabel(journey.arriveLocal)}` : ""}` : "Add your ticket or flight" },
    { href: `/trips/${tripId}/agent/ready`, label: "Before you go", value: "Weather and packing" },
    { href: `/trips/${tripId}/agent/saved`, label: "Saved", value: savedCount ? `${savedCount} place${savedCount === 1 ? "" : "s"}, just yours` : "Nothing yet" },
    { href: `/trips/${tripId}/budget`, label: "Budget", value: owed.length ? `You owe ${formatMoney(owedTotal, owed[0].currency)}` : "No one owes anyone", hot: owed.length > 0 },
  ];
  const youHeader = (
    <div data-you-hub>
      {vibeGate}
      <header className="px-5 pb-1 pt-5">
        <p className="eyebrow">You · private</p>
        <h1 className="t-display mt-2 text-[clamp(38px,12vw,52px)] break-words">Hi, {(me?.name ?? "there").split(" ")[0]}.</h1>
        <p className="t-voice mt-2 text-[15px]">Only you and Clockwise see this.</p>
      </header>

      <nav aria-label="Your things" className="mx-5 mt-4 row-rule border-y border-border">
        {stay && (
          <div className="flex items-baseline justify-between gap-4 py-3.5" data-my-stay>
            <span className="eyebrow">Stay</span>
            <span className="min-w-0 truncate text-right text-[14px]">{stay.placeName} {stay.status === "CONFIRMED" ? "✓" : "· not booked yet"}</span>
          </div>
        )}
        {rows.map((r) => (
          <Link key={r.href} href={r.href} className="group flex min-h-[56px] items-center justify-between gap-4 py-3">
            <span className="eyebrow shrink-0">{r.label}</span>
            <span className={`min-w-0 flex-1 truncate text-right text-[14px] ${r.hot ? "font-semibold text-danger" : ""}`}>{r.value}</span>
            <span aria-hidden className="text-muted-foreground transition-transform duration-150 group-hover:translate-x-0.5">→</span>
          </Link>
        ))}
      </nav>

      {(remembered.length > 0 || foodPrefs.length > 0) && (
        <section className="mx-5 mt-4" data-remembered>
          <p className="eyebrow">✦ What Clockwise knows about you</p>
          <ul className="mt-2 grid grid-cols-2 gap-2.5">
            {foodPrefs.filter((f) => !remembered.some((p) => p.kind === "DIET" && p.subject === f.toLowerCase())).map((f) => (
              <PointerCard key={`food-${f}`} kind="DIET" subject={f.toLowerCase().replace(/_/g, " ")} source="From your answers" />
            ))}
            {remembered.map((p) => (
              <PointerCard key={p.id} kind={p.kind} subject={p.subject} source="from the Trip Room" forgetId={p.id} />
            ))}
          </ul>
          <p className="mt-2 text-[12px] text-muted-foreground">Remove anything that&apos;s wrong with the ✕.</p>
        </section>
      )}

      {uberStatus && UBER_STATUS_MESSAGES[uberStatus] && <p className="mx-5 mt-3 text-[13px]">{UBER_STATUS_MESSAGES[uberStatus]}</p>}

      {offer?.commitment && (
        <LiveLocationCard
          tripId={tripId}
          commitmentName={offer.commitment.name}
          commitmentTimeLabel={offer.commitment.targetTime.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" })}
          initialConsent={offer.consent}
        />
      )}

      <details className="mx-5 mt-3 border-b border-border pb-1" data-settings>
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between text-[12px] uppercase tracking-[0.14em] text-muted-foreground [&::-webkit-details-marker]:hidden">
          Settings <span aria-hidden>▾</span>
        </summary>
        {currentUserId && <ConnectedServices tripId={tripId} viewerId={currentUserId} />}
        {currentUserId && <CriticalTripAlerts initialOptIn={me?.voiceEscalationOptIn ?? false} initialPhone={me?.phone ?? null} />}
      </details>

      {passedOn.length > 0 && (
        <section id="notes" className="mx-5 mt-4 scroll-mt-4" data-passed-on>
          <p className="eyebrow">✦ Notes passed on to you</p>
          <ul className="mt-2 space-y-2">
            {passedOn.map((n) => (
              <li key={n.id} className="rounded-[14px] border border-cw-line bg-cw-tint px-4 py-3 text-[14px]" data-passed-note>
                <p className="eyebrow">{n.amountLabel ? `${n.amountLabel} ${n.kind === "MONEY_TO_SENDER" ? "to" : "from"} ${n.fromName}` : `From ${n.fromName}`}</p>
                <p className="mt-1 leading-snug">{n.headline}</p>
                <p className="mt-1 text-[12px] text-muted-foreground">{n.status === "ACKED" ? "Got it ✓" : n.status === "ASKED" ? `You asked ${n.fromName} about this` : "New"}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="cw-unit mx-5 mt-6" data-private-chat-intro>
        <p className="cw-unit-label">Talk to Clockwise privately <span aria-hidden>✦</span></p>
        <p className="text-[14px] leading-snug">Tell Clockwise something, ask it to pass something on, or manage your part of the trip.</p>
        <p className="text-[12px] text-muted-foreground">🔒 This conversation is visible only to you and Clockwise. Nothing here goes to the group unless you say &ldquo;tell everyone&rdquo;.</p>
      </section>
    </div>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ChatThread
        header={youHeader}
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
