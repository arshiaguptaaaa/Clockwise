import { getTripStay } from "@/lib/stays";
import { prisma } from "@/lib/prisma";
import { getTripById, type Trip } from "@/lib/trip";
import { getClockwiseUserId } from "@/lib/clockwise";
import { getPendingDocumentTravellers } from "@/lib/document-readiness";
import { formatDateRange } from "@/lib/format";
import { decodeCard } from "@/lib/action-cards";
import { excludePrivateSourced } from "@/lib/decision-visibility";
import { privateStateLines } from "@/lib/personal-state";
import { localNow, humanMoment } from "@/lib/when";
import { loadPointers, pointerLine } from "@/lib/pointers/store";

// What the model needs to resolve "tomorrow" and to know what is ALREADY in the Plan, and what has only been
// PICKED UP from chat (which is not the Plan).
async function planAndPointerLines(tripId: string): Promise<string> {
  const now = localNow();
  const [commitments, pointers, openIdeas] = await Promise.all([
    prisma.commitment.findMany({ where: { tripId, status: { not: "CANCELLED" } }, orderBy: { targetTime: "asc" }, take: 25 }),
    loadPointers(tripId),
    prisma.tripSuggestion.findMany({ where: { tripId, status: { in: ["OPEN", "PROPOSED"] } }, select: { title: true, status: true } }),
  ]);
  const lines = [`Right now (trip's local clock, IST): ${humanMoment(`${now.date}T${now.time}`)} — today is ${now.date}. Resolve "today/tomorrow/tonight" from this; pass the words to tools and let them compute dates.`];
  lines.push(
    commitments.length
      ? `CONFIRMED PLAN (what is actually in the Plan):\n${commitments.map((c) => `- ${c.name} · ${humanMoment(c.targetTime.toISOString().slice(0, 16))} · ${c.location}`).join("\n")}`
      : "CONFIRMED PLAN: nothing yet."
  );
  if (pointers.length) lines.push(`PICKED UP from chat (memory only — NOT in the Plan, never present these as planned):\n${pointers.slice(0, 20).map((p) => `- ${pointerLine(p)}`).join("\n")}`);
  if (openIdeas.length) lines.push(`Ideas Clockwise has offered (suggestions, not proposals): ${openIdeas.map((i) => `${i.title} [${i.status}]`).join("; ")}`);
  return lines.join("\n");
}

export type ConversationTurn = {
  id: string;
  senderName: string;
  isClockwise: boolean;
  content: string;
};

export type AgentContext = {
  mode: "GROUP" | "PRIVATE";
  trip: Trip;
  clockwiseUserId: string;
  actingUserId: string;
  actingUserName: string;
  stateSummary: string;
  history: ConversationTurn[];
  privateProfileSummary?: string;
};

const HISTORY_LIMIT = 30;
// Bounded, not "every decision ever" — recent + still-relevant is what
// actually needs to survive between turns; older CONFIRMED facts that
// never get revisited don't need to keep costing tokens forever. Decision
// rows have no per-traveller visibility field (by design — a Decision is
// a group-level convergence, distinct from PrivateProfile), so the same
// set is safe to include in both GROUP and PRIVATE context.
const RECENT_DECISIONS_LIMIT = 15;

function buildSharedStateSummary(
  trip: Trip,
  pendingCardTitles: string[],
  pendingDocCount: number,
  decisions: { type: string; value: string; status: string; affectedUserIds: string }[],
  stay: { status: string; placeName: string | null } | null = null
) {
  const nameByUserId = new Map(trip.members.map((m) => [m.userId, m.user.name]));
  const route = [...trip.destinations]
    .sort((a, b) => a.order - b.order)
    .map((d) => d.name)
    .join(" → ");
  const members = trip.members
    .map((m) => {
      const window =
        m.participationStart && m.participationEnd
          ? `participates ${formatDateRange(m.participationStart, m.participationEnd, "short")}`
          : "hasn't shared their dates yet";
      const departure = m.departureCity ? `, departs from ${m.departureCity}` : "";
      return `${m.user.name} (${window}${departure})`;
    })
    .join("; ");

  const lines = [
    `Trip: ${trip.name}`,
    route ? `Route: ${route}` : "Route: not decided yet",
    trip.coreStartDate && trip.coreEndDate
      ? `Core dates: ${formatDateRange(trip.coreStartDate, trip.coreEndDate, "long")} ${trip.coreEndDate.getUTCFullYear()} (${trip.coreStartDate.toISOString().slice(0, 10)} to ${trip.coreEndDate.toISOString().slice(0, 10)} in ISO 8601 — always resolve relative dates like "the 6th" against this year)`
      : "Core dates: not decided yet",
    `Travellers (${trip.members.length}): ${members || "none yet"}`,
  ];

  if (stay?.placeName) {
    lines.push(
      stay.status === "CONFIRMED"
        ? `Stay (booked, authoritative): ${stay.placeName}. "our hotel" / "the hotel" means this place — use get_route with from or to "our hotel"; do not search for hotels.`
        : `Stay: ${stay.placeName} is APPROVED by the group but NOT booked yet — it is not "our hotel" until the organiser marks it booked.`
    );
  }

  if (pendingDocCount > 0) {
    lines.push(
      `${pendingDocCount} traveller(s) have an unresolved travel-document dependency. Never name who in the group room — only mention it exists.`
    );
  }

  if (pendingCardTitles.length > 0) {
    lines.push(
      `Already-pending action cards in Trip Room (do not propose duplicates of these): ${pendingCardTitles.join("; ")}`
    );
  }

  // The actual memory fix: previously recorded Decision/constraint rows
  // were written by the agent's decision-recording tool but never read
  // back anywhere —
  // they only "existed" for as long as they stayed inside the last 30
  // raw messages. This is what lets Clockwise remember a hard constraint
  // or a confirmed decision on turn 50 that was established on turn 3.
  // Rendering who a claim concerns lets Gemini resolve "who still needs
  // to respond/approve" from state alone, instead of defaulting to
  // asking the whole group — the actual people-scoping fix.
  function formatAffected(affectedUserIdsJson: string): string {
    let ids: string[] = [];
    try {
      ids = JSON.parse(affectedUserIdsJson);
    } catch {
      return "";
    }
    const names = ids.map((id) => nameByUserId.get(id)).filter((n): n is string => Boolean(n));
    if (names.length === 0 || names.length === trip.members.length) return "";
    return ` (concerns: ${names.join(", ")})`;
  }

  const confirmed = decisions.filter((d) => d.status === "CONFIRMED");
  const open = decisions.filter((d) => d.status !== "CONFIRMED");
  if (confirmed.length > 0) {
    lines.push(
      `Confirmed decisions/constraints so far:\n${confirmed.map((d) => `- [${d.type}] ${d.value}${formatAffected(d.affectedUserIds)}`).join("\n")}`
    );
  }
  if (open.length > 0) {
    lines.push(
      `Still open / unresolved (not yet confirmed — do not treat these as settled):\n${open.map((d) => `- [${d.type}] ${d.value} (${d.status})${formatAffected(d.affectedUserIds)}`).join("\n")}`
    );
  }

  return lines.join("\n");
}

// The ambient shared state only ever shows Decisions that did not originate
// in a private room (see decision-visibility.ts). viewerId is null for the
// group context: nobody's private claims belong in a room everyone reads.
// The private context passes the acting traveller, who may see their own.
async function fetchRecentDecisions(tripId: string, viewerId: string | null) {
  const rows = await prisma.decision.findMany({
    // SUPERSEDED claims were made untrue by a later change of canonical state.
    where: { tripId, status: { not: "SUPERSEDED" } },
    orderBy: { createdAt: "desc" },
    take: RECENT_DECISIONS_LIMIT * 2,
    select: { type: true, value: true, status: true, affectedUserIds: true, sourceMessageIds: true, actorUserId: true },
  });
  return (await excludePrivateSourced(rows, viewerId)).slice(0, RECENT_DECISIONS_LIMIT);
}

async function fetchGroupHistory(tripId: string, clockwiseUserId: string): Promise<ConversationTurn[]> {
  const messages = await prisma.message.findMany({
    where: { tripId, channel: "GROUP" },
    include: { sender: true },
    orderBy: { timestamp: "desc" },
    take: HISTORY_LIMIT,
  });
  return messages
    .reverse()
    .filter((m) => !m.cardType) // action cards are UI objects, not conversational turns
    .map((m) => ({
      id: m.id,
      senderName: m.sender?.name ?? "Unknown",
      isClockwise: m.senderId === clockwiseUserId,
      content: m.content,
    }));
}

// GROUP mode's query never selects PrivateProfile/Permission at all — the
// isolation guarantee comes from what's fetched, not from prompting the
// model to behave. There is nothing here for a leak to come from.
export async function buildGroupContext(
  tripId: string,
  actingUserId: string
): Promise<AgentContext> {
  const [trip, clockwiseUserId] = await Promise.all([
    getTripById(tripId),
    getClockwiseUserId(),
  ]);

  const [pendingCards, pendingDocTravellers, history, decisions] = await Promise.all([
    prisma.message.findMany({
      where: { tripId, channel: "GROUP", cardStatus: "PENDING" },
      orderBy: { timestamp: "desc" },
      take: 10,
    }),
    getPendingDocumentTravellers(tripId),
    fetchGroupHistory(tripId, clockwiseUserId),
    fetchRecentDecisions(tripId, null),
  ]);

  const pendingCardTitles = pendingCards
    .filter((m) => m.cardData)
    .map((m) => decodeCard(m.cardData!).title);

  const actingUser = trip.members.find((m) => m.userId === actingUserId);

  return {
    mode: "GROUP",
    trip,
    clockwiseUserId,
    actingUserId,
    actingUserName: actingUser?.user.name ?? "Unknown",
    stateSummary: `${buildSharedStateSummary(trip, pendingCardTitles, pendingDocTravellers.length, decisions, await getTripStay(tripId))}\n${await planAndPointerLines(tripId)}`,
    history,
  };
}

// PRIVATE mode additionally loads the ONE traveller's own PrivateProfile,
// Permission rows, and private message history — and only ever for
// actingUserId, never for anyone else. This function is never called with
// a userId other than the authenticated session's own id.
export async function buildPrivateContext(
  tripId: string,
  actingUserId: string
): Promise<AgentContext> {
  const [trip, clockwiseUserId] = await Promise.all([
    getTripById(tripId),
    getClockwiseUserId(),
  ]);

  const [pendingCards, pendingDocTravellers, privateProfile, permissions, privateMessages, decisions] =
    await Promise.all([
      prisma.message.findMany({
        where: { tripId, channel: "GROUP", cardStatus: "PENDING" },
        orderBy: { timestamp: "desc" },
        take: 10,
      }),
      getPendingDocumentTravellers(tripId),
      prisma.privateProfile.findUnique({ where: { tripId_userId: { tripId, userId: actingUserId } } }),
      prisma.permission.findMany({ where: { tripId, userId: actingUserId } }),
      prisma.message.findMany({
        where: { tripId, channel: "PRIVATE", recipientId: actingUserId },
        orderBy: { timestamp: "desc" },
        take: HISTORY_LIMIT,
      }),
      fetchRecentDecisions(tripId, actingUserId),
    ]);

  const pendingCardTitles = pendingCards
    .filter((m) => m.cardData)
    .map((m) => decodeCard(m.cardData!).title);

  const actingUser = trip.members.find((m) => m.userId === actingUserId);
  const actingUserName = actingUser?.user.name ?? "Unknown";

  const history: ConversationTurn[] = privateMessages
    .reverse()
    .filter((m) => !m.cardType)
    .map((m) => ({
      id: m.id,
      senderName: m.senderId === clockwiseUserId ? "Clockwise" : actingUserName,
      isClockwise: m.senderId === clockwiseUserId,
      content: m.content,
    }));

  const profileLines = [
    `Participation window: ${
      actingUser?.participationStart && actingUser?.participationEnd
        ? `${formatDateRange(actingUser.participationStart, actingUser.participationEnd, "short")} ${actingUser.participationEnd.getUTCFullYear()} (${actingUser.participationStart.toISOString().slice(0, 10)} to ${actingUser.participationEnd.toISOString().slice(0, 10)} in ISO 8601)`
        : "not shared yet — if they tell you their dates, call update_participation_window"
    }`,
  ];
  if (privateProfile?.budgetCeiling) {
    profileLines.push(
      `Private budget ceiling: ${privateProfile.budgetCeiling} (visibility: ${privateProfile.budgetVisibility}) — you may discuss this freely with them here, never in the group room`
    );
  }
  if (privateProfile?.roomPreference) {
    profileLines.push(
      `Room preference: ${privateProfile.roomPreference}${
        privateProfile.roomSharingWith ? ` (sharing with a co-traveller)` : ""
      }`
    );
  }
  if (privateProfile?.passportStatus || privateProfile?.visaStatus) {
    profileLines.push(
      `Passport status: ${privateProfile.passportStatus ?? "unknown"}; Visa status: ${
        privateProfile.visaStatus ?? "unknown"
      }`
    );
  }
  if (privateProfile?.hardCommitments) {
    profileLines.push(`Hard commitments: ${privateProfile.hardCommitments}`);
  }
  if (permissions.length > 0) {
    profileLines.push(
      `Permissions on file: ${permissions.map((p) => `${p.permissionType} (${p.visibility})`).join(", ")}`
    );
  }

  // This traveller's own structured limits and private understanding — only
  // ever theirs (privateStateLines is keyed on actingUserId alone).
  profileLines.push(...(await privateStateLines(tripId, actingUserId)));

  return {
    mode: "PRIVATE",
    trip,
    clockwiseUserId,
    actingUserId,
    actingUserName,
    stateSummary: `${buildSharedStateSummary(trip, pendingCardTitles, pendingDocTravellers.length, decisions, await getTripStay(tripId))}\n${await planAndPointerLines(tripId)}`,
    history,
    privateProfileSummary: profileLines.join("\n"),
  };
}
