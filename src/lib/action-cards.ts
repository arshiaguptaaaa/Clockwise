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

  // A money statement proposed from chat (Budget). The card confirms or edits
  // this Expense; nothing is recorded until then. proposerId = who may act on it.
  expenseId?: string;
  proposerId?: string;
  // "Pay her the remaining amount": a confirmation to RECORD that the debtor has paid, from the confirmed ledger. It moves no
  // money and creates no expense. Only `fromId` can confirm it.
  settlement?: { fromId: string; toId: string; fromName: string; toName: string; amountMinor: number; currency: string; statedByUser?: boolean; collectionId?: string; pine?: { bookingId: string; status: string; url: string | null } };
  // "X owes Y": a single debt, shown as such (one debtor, one creditor, never a split).
  debt?: boolean;
  // A Pine Labs payment-link card: the button opens the hosted checkout for
  // this Booking and can ask Pine Labs for the current status.
  payLink?: boolean;
  // A group payment: the card renders live from the PaymentCollection, never from this snapshot.
  collectionId?: string;
  // Honest handoffs to a provider's own booking page (never a claim that Clockwise priced or booked anything).
  links?: { label: string; url: string; provider?: string }[];
  collection?: boolean;
  // An approved stay waiting for the organiser to mark it booked.
  stayBooking?: boolean;
  // A pending journey read from a ticket, waiting for the traveller's confirmation.
  journeyId?: string;

  // Real live-search results only (src/lib/travel/*) — every entry here
  // came from an actual provider call, never invented. `provider` +
  // `retrievedAt` are shown so old results never look like permanent
  // truth (see spec §10).
  stays?: import("./travel/hotel-provider").HotelListing[];
  stayContext?: { destination: string; dates: string | null; nights: number | null; travellers: number };
  places?: {
    name: string;
    formattedAddress: string | null;
    distanceMeters: number | null;
    latitude?: number | null;
    longitude?: number | null;
    walkMinutes?: number | null;
    // From a provider response only; absent when the provider supplied none.
    category?: string | null;
    hours?: string | null;
    provider?: string | null;
    mapsUrl?: string | null;
    why?: string | null;
  }[];
  // CLOCKWISE HAS AN IDEA: a suggestion (not a proposal, not the Plan). Rendered live from TripSuggestion.
  idea?: {
    suggestionId: string;
    title: string;
    why: string;
    intro: string | null;
    windowLabel: string;
    steps: { kind: "place" | "food" | "return"; name: string; at: string | null; location: string | null; note: string | null; provider: string | null; providerPlaceId: string | null; lat: number | null; lng: number | null }[];
  };
  // CLOCKWISE CAUGHT A CLASH: the card renders live from TripClash.
  clash?: { clashId: string };
  // Which providers answered a search, in order, shown quietly on the card ("Places · Geoapify").
  sources?: string[];
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
