"use client";

import type { CardStatus, CardType } from "@prisma/client";
import { decodeCard } from "@/lib/action-cards";
import { TransportCard } from "./TransportCard";
import { BookingCard } from "./BookingCard";
import { PaymentCard } from "./PaymentCard";
import { TravelResultCard } from "./TravelResultCard";
import { ClockwiseActionCard, type CardPerson } from "./ClockwiseActionCard";
import { ExpenseCard } from "./ExpenseCard";
import { PaymentLinkCard } from "./PaymentLinkCard";
import { StayBookedCard } from "./StayBookedCard";
import { StayList } from "@/components/stays/StayList";
import { dismissActionCard } from "@/app/card-actions";

export function ActionCardMessage({
  tripId,
  messageId,
  cardType,
  cardStatus,
  cardData,
  roster,
  currentUserId,
  organiserId,
}: {
  tripId: string;
  messageId: string;
  cardType: CardType;
  cardStatus: CardStatus;
  cardData: string;
  roster: CardPerson[];
  currentUserId?: string | null;
  organiserId?: string;
}) {
  const data = decodeCard(cardData);

  if (data.stayBooking && data.bookingId) {
    return <StayBookedCard bookingId={data.bookingId} status={cardStatus} title={data.title} context={data.context} canMark={Boolean(currentUserId && currentUserId === organiserId)} />;
  }

  if (cardType === "PLACES" && data.stays) {
    return (
      <ClockwiseActionCard type="PLACES" title={data.title} context={data.context} status="CONFIRMED">
        <div className="mt-2.5">
          <StayList tripId={tripId} listings={data.stays} context={data.stayContext} />
        </div>
      </ClockwiseActionCard>
    );
  }

  if (data.payLink && data.bookingId) {
    return <PaymentLinkCard bookingId={data.bookingId} status={cardStatus} title={data.title} context={data.context} />;
  }

  if (data.expenseId) {
    return (
      <ExpenseCard
        tripId={tripId}
        messageId={messageId}
        expenseId={data.expenseId}
        status={cardStatus}
        title={data.title}
        context={data.context}
        values={data.values}
        canAct={Boolean(currentUserId && (currentUserId === data.proposerId || currentUserId === data.payerId))}
      />
    );
  }

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
