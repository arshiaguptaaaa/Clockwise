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

      {entries.length === 0 ? (
        <p className="mt-10 text-center text-sm text-muted-foreground">No agent activity recorded yet for this trip.</p>
      ) : (
        <ol className="mt-8 border-l border-border">
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
      )}
    </div>
  );
}
