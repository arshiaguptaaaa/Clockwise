import { prisma } from "@/lib/prisma";
import { getTripById, type Trip } from "@/lib/trip";
import { getClockwiseUserId } from "@/lib/clockwise";
import { getPendingDocumentTravellers } from "@/lib/document-readiness";
import { formatDateRange } from "@/lib/format";
import { decodeCard } from "@/lib/action-cards";

export type ConversationTurn = {
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

function buildSharedStateSummary(
  trip: Trip,
  pendingCardTitles: string[],
  pendingDocCount: number
) {
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

  return lines.join("\n");
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

  const [pendingCards, pendingDocTravellers, history] = await Promise.all([
    prisma.message.findMany({
      where: { tripId, channel: "GROUP", cardStatus: "PENDING" },
      orderBy: { timestamp: "desc" },
      take: 10,
    }),
    getPendingDocumentTravellers(tripId),
    fetchGroupHistory(tripId, clockwiseUserId),
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
    stateSummary: buildSharedStateSummary(trip, pendingCardTitles, pendingDocTravellers.length),
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

  const [pendingCards, pendingDocTravellers, privateProfile, permissions, privateMessages] =
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

  return {
    mode: "PRIVATE",
    trip,
    clockwiseUserId,
    actingUserId,
    actingUserName,
    stateSummary: buildSharedStateSummary(trip, pendingCardTitles, pendingDocTravellers.length),
    history,
    privateProfileSummary: profileLines.join("\n"),
  };
}
