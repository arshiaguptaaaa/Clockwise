// Builds the agent trace shown at /trips/[tripId]/agent/trace by merging
// REAL rows from four existing tables into one chronological timeline —
// deliberately not a new logging table. Every field shown here already
// exists for its own operational reason (Message.toolCalls, Decision,
// EscalationEvent's real request/response fields, AuditLog); this module
// only merges and sorts, it never invents a "reasoning" string that
// isn't backed by an actual row. There is no chain-of-thought here —
// only the concise, factual outcome of what happened.
import { prisma } from "@/lib/prisma";

export type TraceEntry = {
  timestamp: Date;
  kind: "MESSAGE_ACTION" | "UNDERSTANDING" | "REMINDER" | "ESCALATION" | "ESCALATION_RESULT" | "AUDIT";
  title: string;
  detail: string;
};

type RawToolCall = { name: string; input: unknown };

export async function buildAgentTrace(tripId: string): Promise<TraceEntry[]> {
  const [messages, decisions, escalations, auditLogs] = await Promise.all([
    prisma.message.findMany({
      where: { tripId, toolCalls: { not: null } },
      orderBy: { timestamp: "asc" },
    }),
    prisma.decision.findMany({ where: { tripId }, orderBy: { createdAt: "asc" } }),
    prisma.escalationEvent.findMany({
      where: { tripId },
      include: { traveller: true, commitment: true },
      orderBy: { triggeredAt: "asc" },
    }),
    prisma.auditLog.findMany({ where: { tripId }, orderBy: { confirmedAt: "asc" } }),
  ]);

  const entries: TraceEntry[] = [];

  for (const m of messages) {
    let calls: RawToolCall[] = [];
    try {
      calls = JSON.parse(m.toolCalls!);
    } catch {
      continue; // malformed JSON from an older row shape — skip rather than crash the trace
    }
    for (const call of calls) {
      entries.push({
        timestamp: m.timestamp,
        kind: "MESSAGE_ACTION",
        title: `Tool call: ${call.name}`,
        detail: JSON.stringify(call.input).slice(0, 300),
      });
    }
  }

  for (const d of decisions) {
    entries.push({
      timestamp: d.createdAt,
      kind: "UNDERSTANDING",
      title: `Recorded [${d.type}] — ${d.status}`,
      detail: d.value,
    });
  }

  for (const e of escalations) {
    const travellerName = e.traveller.name;
    const commitmentName = e.commitment.name;
    if (e.reminderSentAt) {
      entries.push({
        timestamp: e.reminderSentAt,
        kind: "REMINDER",
        title: `Reminder sent to ${travellerName}`,
        detail: `Commitment: "${commitmentName}"${e.acknowledgedAt ? ` — acknowledged ${e.acknowledgedAt.toISOString()}` : " — not yet acknowledged"}`,
      });
    }
    if (e.triggeredAt) {
      entries.push({
        timestamp: e.triggeredAt,
        kind: "ESCALATION",
        title: `${e.mode === "REAL" ? "Real" : "Demo"} voice escalation triggered — ${travellerName}`,
        detail: `Commitment: "${commitmentName}". Provider: ${e.provider ?? "(not yet placed)"}.`,
      });
    }
    if (e.status === "CALLED" || e.status === "RESOLVED" || e.status === "FAILED") {
      entries.push({
        timestamp: e.resolvedAt ?? e.triggeredAt ?? e.reminderSentAt ?? new Date(0),
        kind: "ESCALATION_RESULT",
        title: `Escalation result — ${travellerName}: ${e.status}`,
        detail: [
          e.providerConversationId ? `conversationId=${e.providerConversationId}` : null,
          e.callStatus ? `callStatus=${e.callStatus}` : null,
          e.callDisposition ? `disposition=${e.callDisposition}` : null,
          e.estimatedDelayMinutes != null ? `estimatedDelayMinutes=${e.estimatedDelayMinutes}` : null,
          e.failureReason ? `failureReason=${e.failureReason}` : null,
        ]
          .filter(Boolean)
          .join(", ") || "(no further detail recorded)",
      });
    }
  }

  for (const a of auditLogs) {
    entries.push({
      timestamp: a.confirmedAt,
      kind: "AUDIT",
      title: a.actionType,
      detail: a.payloadSummary,
    });
  }

  return entries.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
}
