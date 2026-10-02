import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getTripById } from "@/lib/trip";
import { buildAgentTrace, type TraceEntry } from "@/lib/agent/trace";

// Deliberately plain/minimal — this page exists to make the agent's
// real, checkable decision chain legible for a demo recording, not to
// be a polished product surface. Every row comes from buildAgentTrace,
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
  const [trip, entries] = await Promise.all([getTripById(tripId), buildAgentTrace(tripId)]);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5">
      <Link
        href={`/trips/${tripId}/plan`}
        className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" /> Back to Plan
      </Link>

      <p className="mt-3 text-base font-medium text-foreground">Agent trace — {trip.name}</p>
      <p className="mt-1 text-xs text-muted-foreground">
        Every tool call, recorded understanding, reminder, escalation, and audited action, in the order it
        actually happened. Real rows only — nothing on this page is reconstructed or invented.
      </p>

      {entries.length === 0 ? (
        <p className="mt-8 text-center text-sm text-muted-foreground">
          No agent activity recorded yet for this trip.
        </p>
      ) : (
        <ol className="mt-5 flex flex-col gap-3">
          {entries.map((entry, i) => (
            <li key={i} className="rounded-xl border border-border px-3.5 py-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="rounded-full bg-surface-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  {KIND_LABEL[entry.kind]}
                </span>
                <span className="text-[11px] text-muted-foreground">{formatTimestamp(entry.timestamp)}</span>
              </div>
              <p className="mt-1.5 text-sm font-medium text-foreground">{entry.title}</p>
              <p className="mt-0.5 whitespace-pre-line break-words text-xs text-muted-foreground">{entry.detail}</p>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
