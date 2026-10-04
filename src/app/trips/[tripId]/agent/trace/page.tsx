import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getTripById } from "@/lib/trip";
import { buildAgentTrace, type TraceEntry } from "@/lib/agent/trace";
import { getCurrentUserId } from "@/lib/session";

// This page makes the agent's real, checkable decision chain legible. Every row comes from buildAgentTrace,
// which only merges real rows (Message.toolCalls, Decision,
// EscalationEvent, AuditLog) — nothing here is synthesized or
// reconstructed chain-of-thought.
const KIND_LABEL: Record<TraceEntry["kind"], string> = {
  TRIP_EVENT: "EVENT",
  MESSAGE_ACTION: "ACTION",
  UNDERSTANDING: "UNDERSTANDING",
  REMINDER: "REMINDER",
  ESCALATION: "ESCALATION",
  ESCALATION_RESULT: "RESULT",
  AUDIT: "AUDIT",
};

// The causal chain the product is built to show, in order. Each row is the latest REAL event of that kind;
// a step that hasn't happened yet shows as pending, never as made up.
const CHAIN: { kind: string; alt?: string; label: string }[] = [
  { kind: "GNANI_STT_COMPLETED", label: "Voice → words" },
  { kind: "TRAVELLER_DELAY_DETECTED", alt: "TRAVELLER_ARRIVAL_UPDATED", label: "Delay noticed" },
  { kind: "JOURNEY_UPDATED", alt: "TRAVELLER_ARRIVAL_UPDATED", label: "Journey updated" },
  { kind: "NEXT_ANCHOR_RESOLVED", label: "Where they need to be" },
  { kind: "ROUTE_CALCULATED", alt: "DELHIVERY_ROUTE_COMPLETED", label: "Route measured" },
  { kind: "REALISTIC_READY_TIME_UPDATED", label: "Lands ≠ available" },
  { kind: "COMMITMENT_CONFLICT_DETECTED", alt: "RENDEZVOUS_CONFLICT_DETECTED", label: "Clash caught" },
  { kind: "AFFECTED_TRAVELLERS_IDENTIFIED", label: "Who it affects" },
  { kind: "RESOLUTION_SUGGESTED", label: "Option suggested" },
  { kind: "GROUP_PROPOSAL_CREATED", alt: "COMMITMENT_RESCHEDULE_PROPOSED", label: "Proposed to group" },
  { kind: "GROUP_APPROVED", label: "Group approved" },
  { kind: "PLAN_UPDATED", alt: "COMMITMENT_RESCHEDULED", label: "Plan updated" },
];

function formatTimestamp(date: Date): string {
  return date.toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZone: "UTC",
  });
}

export default async function AgentTracePage({
  params,
}: {
  params: Promise<{ tripId: string }>;
}) {
  const { tripId } = await params;
  const viewerId = await getCurrentUserId();
  const [trip, entries] = await Promise.all([getTripById(tripId), buildAgentTrace(tripId, viewerId)]);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-12 pt-6">
      <div className="flex items-center gap-5">
        <Link href={`/trips/${tripId}/plan`} className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-3.5" /> Plan
        </Link>
        {viewerId === trip.createdBy && (
          <Link href={`/trips/${tripId}/agent/trace/evidence`} className="text-xs font-semibold text-accent underline-offset-2 hover:underline">
            Developer evidence (rail calls) →
          </Link>
        )}
      </div>

      <p className="eyebrow mt-6">Agent trace</p>
      <h1 className="headline headline-xl mt-2">{trip.name}</h1>
      <p className="lede mt-2 max-w-[22rem]">
        Every tool call, understanding, reminder, escalation and audited action, in the order it actually happened. Real rows only. Nothing here is reconstructed or invented.
      </p>

      {entries.length > 0 && (
        <section className="mt-8" data-chain>
          <p className="eyebrow">The chain</p>
          <ol className="mt-3">
            {CHAIN.map((step, i) => {
              const hit = [...entries].reverse().find((e) => e.title.startsWith(step.kind) || (step.alt ? e.title.startsWith(step.alt) : false));
              return (
                <li key={step.kind} className="relative grid grid-cols-[1.5rem_1fr] gap-x-3 pb-5 last:pb-0">
                  {i < CHAIN.length - 1 && <span aria-hidden className="absolute bottom-0 left-[0.55rem] top-5 w-px bg-border" />}
                  <span aria-hidden className={`mt-1 flex size-[1.1rem] items-center justify-center rounded-full text-[10px] ${hit ? "bg-accent text-accent-foreground" : "border border-border text-transparent"}`}>✓</span>
                  <div className={hit ? "" : "opacity-45"}>
                    <p className="font-display text-[19px] leading-tight tracking-[-0.01em]">{step.label}</p>
                    <p className="mt-0.5 font-mono text-[11px] tracking-tight text-muted-foreground">{hit && step.alt && hit.title.startsWith(step.alt) ? step.alt : step.kind}{hit ? ` · ${formatTimestamp(hit.timestamp)}` : " · not yet"}</p>
                  </div>
                </li>
              );
            })}
          </ol>
        </section>
      )}

      {entries.length === 0 ? (
        <p className="mt-10 text-center text-sm text-muted-foreground">No agent activity recorded yet for this trip.</p>
      ) : (
        <details className="mt-10 border-t border-border pt-2">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between text-[12px] uppercase tracking-[0.14em] text-muted-foreground [&::-webkit-details-marker]:hidden">
          Full trace · {entries.length} events <span aria-hidden>▾</span>
        </summary>
        <ol className="mt-6 border-l border-border">
          {entries.map((entry, i) => (
            <li key={i} className="relative pb-7 pl-5">
              <span className="absolute -left-[4.5px] top-1.5 size-2 rounded-full bg-accent" />
              <div className="flex items-baseline justify-between gap-2">
                <span className="eyebrow !text-accent-strong">{KIND_LABEL[entry.kind]}</span>
                <span className="text-[11px] tabular-nums text-muted-foreground">{formatTimestamp(entry.timestamp)}</span>
              </div>
              <p className="mt-1.5 font-display text-[19px] leading-snug tracking-[-0.01em] text-foreground">{entry.title}</p>
              {entry.steps ? (
                <ol className="mt-2.5 flex flex-col gap-2">
                  {entry.steps.map((step, j) => (
                    <li key={j} className="flex items-start gap-3 text-[12.5px] leading-snug">
                      <span className="w-24 shrink-0 text-[10px] font-semibold uppercase tracking-[0.12em] text-accent">{step.label}</span>
                      <span className="min-w-0 break-words text-muted-foreground">{step.text}</span>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="mt-1 whitespace-pre-line break-words text-[12.5px] leading-snug text-muted-foreground">{entry.detail}</p>
              )}
            </li>
          ))}
        </ol>
        </details>
      )}
    </div>
  );
}
