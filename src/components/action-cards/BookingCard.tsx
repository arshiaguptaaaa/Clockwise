"use client";

import { useRouter } from "next/navigation";
import type { CardStatus } from "@prisma/client";
import { ClockwiseActionCard } from "./ClockwiseActionCard";

type Props = {
  status: CardStatus;
  title: string;
  context?: string;
  values?: { label: string; value: string }[];
  payerId?: string;
  payerName?: string;
  currentUserId: string | null;
};

export function BookingCard({
  status,
  title,
  context,
  values,
  payerId,
  payerName,
  currentUserId,
}: Props) {
  const router = useRouter();
  const isPayer = !!payerId && payerId === currentUserId;

  const displayContext =
    !isPayer && payerId && status === "PENDING"
      ? `${context ?? ""} Waiting on ${payerName} to confirm.`.trim()
      : context;

  return (
    <ClockwiseActionCard
      type="BOOKING"
      title={title}
      context={displayContext}
      values={values}
      status={status}
      primaryAction={
        isPayer
          ? {
              label: "Review & Pay",
              run: async () => {
                router.push("/agent");
              },
            }
          : undefined
      }
    />
  );
}
