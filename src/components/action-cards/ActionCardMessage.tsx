"use client";

import type { CardStatus, CardType } from "@prisma/client";
import { decodeCard } from "@/lib/action-cards";
import { TransportCard } from "./TransportCard";
import { BookingCard } from "./BookingCard";
import { PaymentCard } from "./PaymentCard";
import { TravelResultCard } from "./TravelResultCard";
import { ClockwiseActionCard, type CardPerson } from "./ClockwiseActionCard";
import { dismissActionCard } from "@/app/card-actions";

export function ActionCardMessage({
  tripId,
  messageId,
  cardType,
  cardStatus,
  cardData,
  roster,
  currentUserId,
}: {
  tripId: string;
  messageId: string;
  cardType: CardType;
  cardStatus: CardStatus;
  cardData: string;
  roster: CardPerson[];
  currentUserId?: string | null;
}) {
  const data = decodeCard(cardData);

  if (cardType === "TRANSPORT" && data.transportPlanId) {
    return (
      <TransportCard
        tripId={tripId}
        messageId={messageId}
        status={cardStatus}
        title={data.title}
        context={data.context}
        transportPlanId={data.transportPlanId}
      />
    );
  }

  if (cardType === "BOOKING" && data.payerId) {
    return (
      <BookingCard
        status={cardStatus}
        title={data.title}
        context={data.context}
        values={data.values}
        payerId={data.payerId}
        payerName={roster.find((p) => p.id === data.payerId)?.name}
        currentUserId={currentUserId ?? null}
      />
    );
  }

  if (cardType === "PLACES" || cardType === "ROUTE" || cardType === "WEATHER") {
    return <TravelResultCard cardType={cardType} data={data} />;
  }

  if (cardType === "PAYMENT") {
    return (
      <PaymentCard
        messageId={messageId}
        status={cardStatus}
        title={data.title}
        context={data.context}
        values={data.values}
        amount={data.amount}
        currency={data.currency}
      />
    );
  }

  // Generic fallback for card types that don't have a dedicated
  // interactive wrapper yet — renders correctly with the shared shell,
  // just without bespoke multi-step UX like TransportCard's.
  const canAct = cardStatus === "PENDING" && !data.informational;
  return (
    <ClockwiseActionCard
      type={cardType}
      title={data.title}
      context={data.context}
      values={data.values}
      status={cardStatus}
      deadline={data.deadline}
      affectedTravellers={roster.filter((p) =>
        data.affectedTravellerIds?.includes(p.id)
      )}
      secondaryAction={
        canAct
          ? {
              label: cardType === "DOCUMENT" ? "Acknowledge" : "Dismiss",
              run: async () => {
                await dismissActionCard(messageId);
              },
            }
          : undefined
      }
    />
  );
}
