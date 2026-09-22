import type { CardStatus, CardType } from "@prisma/client";
import { prisma } from "./prisma";
import { getClockwiseUserId } from "./clockwise";

export type ActionCardValue = { label: string; value: string };

// The JSON payload stored in Message.cardData. Keep this small and
// display-oriented — bookingId/payerId etc. are read back by server
// actions when a card's button is pressed, not re-derived from prose.
export type ActionCardData = {
  title: string;
  context?: string;
  values?: ActionCardValue[];
  affectedTravellerIds?: string[];
  deadline?: string; // ISO timestamp
  bookingId?: string;
  payerId?: string;
  amount?: number;
  currency?: string;
  // Present only on TRANSPORT cards backed by a real TransportPlan (the
  // Uber sandbox flow) — the card's client component reads/writes all ride
  // state through this id rather than through cardData, since a plan's
  // state changes as real Uber API calls resolve, not just on confirm.
  transportPlanId?: string;
  // Bidirectional link between a GROUP-visible card and the matching
  // PRIVATE authorization card in the payer's My Agent inbox, so
  // confirming one can update the other without guessing by content.
  linkedMessageId?: string;
  // True for cards that are notices, not requests — e.g. the group-safe
  // "I'll follow up with them privately" card. Never gets action buttons,
  // regardless of status.
  informational?: boolean;

  // Real live-search results only (src/lib/travel/*) — every entry here
  // came from an actual provider call, never invented. `provider` +
  // `retrievedAt` are shown so old results never look like permanent
  // truth (see spec §10).
  places?: {
    name: string;
    formattedAddress: string | null;
    distanceMeters: number | null;
    latitude?: number | null;
    longitude?: number | null;
  }[];
  route?: {
    mode: string;
    fromLabel: string;
    toLabel: string;
    distanceMeters: number;
    durationSeconds: number;
    from?: { lat: number; lng: number };
    to?: { lat: number; lng: number };
    // Real routed path geometry when the provider returned one — never a
    // fabricated straight line (see src/lib/travel/geoapify-provider.ts).
    geometry?: { lat: number; lng: number }[];
  };
  weather?: {
    temperatureC: number;
    forecast: { date: string; minC: number; maxC: number; precipitationProbability: number | null }[];
  };
  provider?: string;
  retrievedAt?: string;
};

export function encodeCard(data: ActionCardData) {
  return JSON.stringify(data);
}

export function decodeCard(raw: string): ActionCardData {
  return JSON.parse(raw) as ActionCardData;
}

// Every action card is just a Clockwise-authored Message with cardType set.
// This keeps a single, chronologically-ordered feed instead of a parallel
// "events" table that would need its own merge-by-time logic.
export async function postActionCard(params: {
  tripId: string;
  channel: "GROUP" | "PRIVATE";
  recipientId?: string;
  type: CardType;
  status: CardStatus;
  data: ActionCardData;
}) {
  const clockwiseId = await getClockwiseUserId();
  return prisma.message.create({
    data: {
      tripId: params.tripId,
      senderId: clockwiseId,
      channel: params.channel,
      recipientId: params.recipientId ?? null,
      content: params.data.title,
      cardType: params.type,
      cardStatus: params.status,
      cardData: encodeCard(params.data),
    },
  });
}

export async function updateCardStatus(messageId: string, status: CardStatus) {
  return prisma.message.update({
    where: { id: messageId },
    data: { cardStatus: status },
  });
}
