"use client";

import { useState, useTransition } from "react";
import { PhoneCall, Loader2 } from "lucide-react";
import { triggerEscalation, simulateEscalationResponse } from "@/app/escalation-actions";
import { SIMULATED_RESPONSE_LABELS, type SimulatedResponseKey } from "@/lib/voice-escalation/simulated-responses";

export type EscalationEventView = {
  id: string;
  travellerId: string;
  status: string;
  mode: string;
  callDisposition: string | null;
  failureReason: string | null;
};

export type CommitmentView = {
  id: string;
  name: string;
  location: string;
  targetTime: string; // ISO
  status: "ON_TRACK" | "AT_RISK" | "MISSED";
  participants: { userId: string; name: string; voiceEscalationOptIn: boolean; hasPhone: boolean }[];
  events: EscalationEventView[];
};

const STATUS_TINT: Record<string, string> = {
  AT_RISK: "text-warning",
  MISSED: "text-danger",
};

export function CommitmentEscalation({
  commitments,
  viewerIsOrganiser,
}: {
  commitments: CommitmentView[];
  viewerIsOrganiser: boolean;
}) {
  const atRisk = commitments.filter((c) => c.status === "AT_RISK" || c.status === "MISSED");
  if (atRisk.length === 0) return null;

  return (
    <div className="mb-6 flex flex-col gap-3">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Commitments needing attention
      </p>
      {atRisk.map((c) => (
        <CommitmentRow key={c.id} commitment={c} viewerIsOrganiser={viewerIsOrganiser} />
      ))}
    </div>
  );
}

function CommitmentRow({
  commitment,
  viewerIsOrganiser,
}: {
  commitment: CommitmentView;
  viewerIsOrganiser: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="rounded-xl border border-border px-3.5 py-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-foreground">{commitment.name}</p>
        <span className={`text-xs font-medium ${STATUS_TINT[commitment.status] ?? ""}`}>
          {commitment.status.replace("_", " ")}
        </span>
      </div>
      <p className="mt-0.5 text-xs text-muted-foreground">
        {commitment.location} · {new Date(commitment.targetTime).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
      </p>

      <div className="mt-2.5 flex flex-col gap-2">
        {commitment.participants.map((p) => {
          const event = commitment.events.find((e) => e.travellerId === p.userId);
          return (
            <div key={p.userId} className="flex items-center justify-between gap-2 text-xs">
              <span className="text-foreground">{p.name}</span>

              {event && event.status === "RESOLVED" ? (
                <span className="text-muted-foreground">
                  {event.mode === "DEMO" ? "Demo call" : "Call"} result: {event.callDisposition ?? "unknown"}
                </span>
              ) : event && event.status === "CALLED" ? (
                <span className="text-muted-foreground">
                  {event.mode === "DEMO" ? "GNANI — DEMO MODE · " : ""}Calling…
                </span>
              ) : event && event.status === "FAILED" ? (
                <span className="text-danger">Call failed: {event.failureReason}</span>
              ) : viewerIsOrganiser ? (
                p.voiceEscalationOptIn ? (
                  p.hasPhone ? (
                    <button
                      type="button"
                      disabled={isPending}
                      onClick={() =>
                        startTransition(async () => {
                          setError(null);
                          const result = await triggerEscalation(commitment.id, p.userId);
                          if (!result.ok) setError(result.error);
                        })
                      }
                      className="flex cursor-pointer items-center gap-1 rounded-full border border-border px-2.5 py-1 font-medium text-foreground transition-colors hover:border-accent hover:text-accent disabled:opacity-50"
                    >
                      {isPending ? <Loader2 className="size-3 animate-spin" /> : <PhoneCall className="size-3" />}
                      Call
                    </button>
                  ) : (
                    <span className="text-muted-foreground">No phone on file</span>
                  )
                ) : (
                  <span className="text-muted-foreground">Alerts off</span>
                )
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
            </div>
          );
        })}
      </div>

      {commitment.events.some((e) => e.mode === "DEMO" && e.status === "CALLED") && viewerIsOrganiser && (
        <div className="mt-2 rounded-lg border border-warning-tint bg-warning-tint px-2.5 py-2">
          <p className="text-[11px] font-medium text-warning">GNANI — DEMO MODE. Simulate the traveller&apos;s response:</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {commitment.events
              .filter((e) => e.mode === "DEMO" && e.status === "CALLED")
              .map((e) => (
                <div key={e.id} className="flex flex-wrap gap-1.5">
                  {(Object.keys(SIMULATED_RESPONSE_LABELS) as SimulatedResponseKey[]).map((key) => (
                    <button
                      key={key}
                      type="button"
                      disabled={isPending}
                      onClick={() =>
                        startTransition(async () => {
                          await simulateEscalationResponse(e.id, key);
                        })
                      }
                      className="cursor-pointer rounded-full border border-border bg-surface px-2 py-1 text-[11px] text-foreground hover:border-accent hover:text-accent disabled:opacity-50"
                    >
                      {SIMULATED_RESPONSE_LABELS[key]}
                    </button>
                  ))}
                </div>
              ))}
          </div>
        </div>
      )}

      {error && <p className="mt-1.5 text-xs text-danger">{error}</p>}
    </div>
  );
}
