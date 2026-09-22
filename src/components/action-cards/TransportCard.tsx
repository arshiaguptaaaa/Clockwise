"use client";

import { useEffect, useState, useTransition } from "react";
import type { CardStatus } from "@prisma/client";
import { ClockwiseActionCard } from "./ClockwiseActionCard";
import { dismissActionCard } from "@/app/card-actions";
import {
  getTransportPlanState,
  updateTransportParticipant,
  checkTransportOptions,
  prepareRideConfirmation,
  confirmRideRequest,
  retryRideOrder,
  cancelRideOrder,
  advanceSandboxRideOrder,
  type TransportPlanState,
  type PreparedVehicle,
} from "@/app/transport-actions";
import type { VehicleOption } from "@/lib/providers/mobility";

type Props = {
  tripId: string;
  messageId: string;
  status: CardStatus;
  title: string;
  context?: string;
  transportPlanId: string;
};

type Step = "participants" | "options" | "confirm";

const CANCELLABLE_STATUSES = ["REQUESTING", "PROCESSING", "ACCEPTED", "ARRIVING"];
const TERMINAL_STATUSES = ["COMPLETED", "RIDER_CANCELLED", "DRIVER_CANCELLED", "FAILED"];

const STATUS_LABEL: Record<string, string> = {
  REQUESTING: "Requesting…",
  PROCESSING: "Processing",
  ACCEPTED: "Accepted",
  ARRIVING: "Driver arriving",
  IN_PROGRESS: "In progress",
  COMPLETED: "Completed",
  RIDER_CANCELLED: "Cancelled",
  DRIVER_CANCELLED: "Driver cancelled",
  FAILED: "Couldn't secure this ride",
};

function statusTint(status: string) {
  if (status === "FAILED" || status === "DRIVER_CANCELLED") return "text-danger";
  if (status === "COMPLETED") return "text-success";
  if (status === "RIDER_CANCELLED") return "text-muted-foreground";
  return "text-accent-strong";
}

export function TransportCard({ tripId, messageId, status, title, context, transportPlanId }: Props) {
  const [planState, setPlanState] = useState<TransportPlanState | null>(null);
  const [step, setStep] = useState<Step>("participants");
  const [options, setOptions] = useState<VehicleOption[]>([]);
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const [confirmData, setConfirmData] = useState<{
    displayName: string;
    vehicles: PreparedVehicle[];
    totalLow: number;
    totalHigh: number;
    currency: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [rowPending, setRowPending] = useState<string | null>(null);

  useEffect(() => {
    getTransportPlanState(transportPlanId).then(setPlanState);
  }, [transportPlanId]);

  if (status === "DISMISSED") {
    return <ClockwiseActionCard type="TRANSPORT" title={title} context={context} status="DISMISSED" />;
  }

  if (!planState) {
    return <ClockwiseActionCard type="TRANSPORT" title={title} context={context} status="PENDING" />;
  }

  const connectUrl = `/api/integrations/uber/connect?tripId=${tripId}`;
  const notConnectedNote = planState.organiserConnected ? null : planState.viewerIsOrganiser ? (
    <a href={connectUrl} className="text-accent hover:underline">
      Connect Uber to check real rides
    </a>
  ) : (
    <span>Waiting on {planState.organiserName} to connect Uber.</span>
  );

  async function refresh() {
    setPlanState(await getTransportPlanState(transportPlanId));
  }

  // Once a confirmation attempt has happened, the plan's own status (not
  // local step state) is the source of truth — always show live ride
  // status, never let a stale local `step` re-show the request flow.
  const showLiveStatus = status === "CONFIRMED" || ["CONFIRMED", "PARTIAL", "FAILED"].includes(planState.plan.status) && planState.rideOrders.length > 0;

  if (showLiveStatus) {
    return (
      <ClockwiseActionCard type="TRANSPORT" title={title} context={context} status="CONFIRMED">
        <div className="mt-2.5 space-y-2">
          {planState.rideOrders.map((r) => (
            <div key={r.id} className="rounded-lg border border-border px-2.5 py-2 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-foreground">
                  {r.productName ?? "Ride"} — {r.memberNames.join(", ")}
                </span>
                <span className={`shrink-0 font-medium ${statusTint(r.status)}`}>
                  {STATUS_LABEL[r.status] ?? r.status}
                </span>
              </div>
              {r.fareEstimateLow != null && (
                <p className="mt-0.5 text-muted-foreground">
                  {r.currency}
                  {r.fareEstimateLow === r.fareEstimateHigh
                    ? r.fareEstimateLow
                    : `${r.fareEstimateLow}–${r.fareEstimateHigh}`}
                  {r.pickupEtaMinutes != null && ` · pickup ${r.pickupEtaMinutes} min`}
                </p>
              )}
              {r.errorMessage && <p className="mt-1 text-danger">{r.errorMessage}</p>}

              {planState.viewerIsOrganiser ? (
              <div className="mt-1.5 flex flex-wrap gap-3">
                {r.status === "FAILED" && (
                  <button
                    type="button"
                    disabled={rowPending === r.id}
                    onClick={() => {
                      setRowPending(r.id);
                      startTransition(async () => {
                        await retryRideOrder(r.id);
                        await refresh();
                        setRowPending(null);
                      });
                    }}
                    className="cursor-pointer font-medium text-accent hover:underline disabled:opacity-50"
                  >
                    {rowPending === r.id ? "Retrying…" : "Retry this ride"}
                  </button>
                )}
                {CANCELLABLE_STATUSES.includes(r.status) && (
                  <button
                    type="button"
                    disabled={rowPending === r.id}
                    onClick={() => {
                      setRowPending(r.id);
                      startTransition(async () => {
                        const result = await cancelRideOrder(r.id);
                        if (!result.ok) setError(result.error);
                        await refresh();
                        setRowPending(null);
                      });
                    }}
                    className="cursor-pointer font-medium text-muted-foreground hover:text-danger disabled:opacity-50"
                  >
                    {rowPending === r.id ? "Cancelling…" : "Cancel"}
                  </button>
                )}
                {planState.sandbox && !TERMINAL_STATUSES.includes(r.status) && (
                  <button
                    type="button"
                    disabled={rowPending === r.id}
                    onClick={() => {
                      const next =
                        r.status === "REQUESTING" || r.status === "PROCESSING"
                          ? "accepted"
                          : r.status === "ACCEPTED"
                            ? "arriving"
                            : r.status === "ARRIVING"
                              ? "in_progress"
                              : "completed";
                      setRowPending(r.id);
                      startTransition(async () => {
                        const result = await advanceSandboxRideOrder(r.id, next);
                        if (!result.ok) setError(result.error);
                        await refresh();
                        setRowPending(null);
                      });
                    }}
                    className="cursor-pointer font-medium text-muted-foreground hover:text-accent disabled:opacity-50"
                  >
                    Simulate next status (sandbox)
                  </button>
                )}
              </div>
              ) : (
                <p className="mt-1.5 text-muted-foreground">
                  Only {planState.organiserName} can manage this ride.
                </p>
              )}
            </div>
          ))}
        </div>
        {error && <p className="mt-2 text-xs text-danger">{error}</p>}
      </ClockwiseActionCard>
    );
  }

  if (step === "confirm" && confirmData) {
    const vehicleSummary = confirmData.vehicles
      .map((v) => `${v.memberNames.join(", ")}`)
      .join(" · ");
    return (
      <ClockwiseActionCard
        type="TRANSPORT"
        title="Confirm & request rides"
        context={`${planState.plan.pickup} → ${planState.plan.destination}`}
        status="PENDING"
        values={[
          { label: "Vehicles", value: `${confirmData.vehicles.length} × ${confirmData.displayName}` },
          {
            label: "Current estimated total",
            value: `${confirmData.currency}${confirmData.totalLow}${
              confirmData.totalLow === confirmData.totalHigh ? "" : `–${confirmData.totalHigh}`
            }`,
          },
          {
            label: "Pickup",
            value:
              confirmData.vehicles[0]?.prepared.pickupEtaMinutes != null
                ? `${confirmData.vehicles[0].prepared.pickupEtaMinutes} min`
                : "unavailable",
          },
        ]}
        primaryAction={
          planState.viewerIsOrganiser
            ? {
                label: "Confirm & request rides",
                pendingLabel: "Requesting…",
                run: async () => {
                  setError(null);
                  setNotice(null);
                  const result = await confirmRideRequest(
                    messageId,
                    transportPlanId,
                    selectedProductId!,
                    confirmData.displayName,
                    confirmData.vehicles.map((v) => v.prepared)
                  );
                  if (!result.ok) {
                    if ("expired" in result) {
                      setNotice("That fare had expired — getting a fresh one.");
                      const refreshed = await prepareRideConfirmation(transportPlanId, selectedProductId!);
                      if ("error" in refreshed) {
                        setError(refreshed.error);
                      } else {
                        setConfirmData(refreshed);
                      }
                    } else {
                      setError(result.error);
                    }
                    return;
                  }
                  setPlanState(result.state);
                },
              }
            : undefined
        }
        secondaryAction={
          planState.viewerIsOrganiser ? { label: "Change", run: async () => setStep("options") } : undefined
        }
      >
        <p className="mt-1.5 text-xs text-muted-foreground">{vehicleSummary}</p>
        {!planState.viewerIsOrganiser && (
          <p className="mt-1.5 text-xs text-muted-foreground">
            Only {planState.organiserName} can confirm and request these rides.
          </p>
        )}
        {notice && <p className="mt-1.5 text-xs text-muted-foreground">{notice}</p>}
        {error && <p className="mt-1.5 text-xs text-danger">{error}</p>}
        {planState.viewerIsOrganiser && (
          <button
            type="button"
            onClick={() => dismissActionCard(messageId)}
            className="mt-2 cursor-pointer text-xs font-medium text-muted-foreground hover:underline"
          >
            Not now
          </button>
        )}
      </ClockwiseActionCard>
    );
  }

  if (step === "options") {
    return (
      <ClockwiseActionCard
        type="TRANSPORT"
        title={`${planState.plan.partySize} travellers — real Uber options`}
        context={`${planState.plan.pickup} → ${planState.plan.destination}`}
        status="PENDING"
        primaryAction={{
          label: "Continue",
          pendingLabel: "Getting fare…",
          run: async () => {
            if (!selectedProductId) {
              setError("Pick a ride option first.");
              return;
            }
            setError(null);
            const result = await prepareRideConfirmation(transportPlanId, selectedProductId);
            if ("error" in result) {
              setError(result.error);
              return;
            }
            setConfirmData(result);
            setStep("confirm");
          },
        }}
        secondaryAction={{ label: "Back", run: async () => setStep("participants") }}
      >
        <div className="mt-2 space-y-1.5">
          {options.map((o) => (
            <button
              key={o.productId}
              type="button"
              onClick={() => setSelectedProductId(o.productId)}
              className={`block w-full cursor-pointer rounded-lg border px-2.5 py-2 text-left text-xs transition-colors ${
                selectedProductId === o.productId
                  ? "border-accent bg-accent-tint"
                  : "border-border hover:border-accent"
              }`}
            >
              <span className="font-medium text-foreground">
                {o.vehiclesNeeded} × {o.displayName}
              </span>
              <span className="ml-2 text-muted-foreground">
                {o.currency}
                {o.lowEstimate}
                {o.lowEstimate === o.highEstimate ? "" : `–${o.highEstimate}`}
                {o.surgeMultiplier > 1 && ` · ${o.surgeMultiplier}× surge`}
              </span>
            </button>
          ))}
        </div>
        {error && <p className="mt-2 text-xs text-danger">{error}</p>}
      </ClockwiseActionCard>
    );
  }

  // step === "participants"
  return (
    <ClockwiseActionCard
      type="TRANSPORT"
      title={title}
      context={context}
      status="PENDING"
      primaryAction={{
        label: "Check rides",
        pendingLabel: "Checking…",
        run: async () => {
          setError(null);
          const result = await checkTransportOptions(transportPlanId);
          if ("error" in result) {
            setError(result.error);
            return;
          }
          setOptions(result.options);
          setSelectedProductId(result.options[0]?.productId ?? null);
          setStep("options");
        },
      }}
      secondaryAction={{ label: "Not yet", run: async () => dismissActionCard(messageId) }}
    >
      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {planState.participants.map((p) => {
          const isConfirmed = p.status === "CONFIRMED";
          return (
            <button
              key={p.tripMemberId}
              type="button"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  await updateTransportParticipant(
                    transportPlanId,
                    p.tripMemberId,
                    isConfirmed ? "LEAVING_LATER" : "CONFIRMED"
                  );
                  await refresh();
                })
              }
              className={`cursor-pointer rounded-full border px-2.5 py-1 text-xs transition-colors ${
                isConfirmed
                  ? "border-accent bg-accent-tint text-accent-strong"
                  : "border-border text-muted-foreground hover:border-accent"
              }`}
            >
              {p.name} {isConfirmed ? "✓" : "· leaving later"}
            </button>
          );
        })}
      </div>
      {notConnectedNote && <p className="mt-2 text-xs text-muted-foreground">{notConnectedNote}</p>}
      {error && <p className="mt-1 text-xs text-danger">{error}</p>}
    </ClockwiseActionCard>
  );
}
