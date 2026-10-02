// Builds the agent trace shown at /trips/[tripId]/agent/trace by merging
// REAL rows from four existing tables into one chronological timeline —
// deliberately not a new logging table. Every field shown here already
// exists for its own operational reason (Message.toolCalls, Decision,
// EscalationEvent's real request/response fields, AuditLog); this module
// only merges and sorts, it never invents a "reasoning" string that
// isn't backed by an actual row. There is no chain-of-thought here —
// only the concise, factual outcome of what happened.
import { prisma } from "@/lib/prisma";
import { excludePrivateSourced } from "@/lib/decision-visibility";

// One link in a causal chain: INPUT -> SOURCE -> UNDERSTANDING -> EVENT ->
// STATE -> PROPAGATION -> NOTIFICATION.
export type TraceStepLabel = "INPUT" | "SOURCE" | "UNDERSTANDING" | "EVENT" | "STATE" | "PROPAGATION" | "NOTIFICATION";
export type TraceStep = { label: TraceStepLabel; text: string };

export type TraceEntry = {
  timestamp: Date;
  kind: "TRIP_EVENT" | "MESSAGE_ACTION" | "UNDERSTANDING" | "REMINDER" | "ESCALATION" | "ESCALATION_RESULT" | "AUDIT";
  title: string;
  detail: string;
  // Present for typed events: the full chain, rendered as labelled steps.
  steps?: TraceStep[];
};

const SOURCE_LABEL: Record<string, string> = {
  GROUP: "group chat",
  PRIVATE: "private room",
  LOCATION: "live-location update",
  GNANI_CALL: "Clockwise voice call",
  PINELABS: "Pine Labs",
  DOCUMENT: "uploaded document",
  AGENT: "Clockwise agent",
  HUMAN: "a person's action",
  SYSTEM: "system",
};

function parseJson<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

// Kind-specific "what changed" and "what it did to shared state".
function describeEvent(kind: string, p: Record<string, unknown>): { understanding: string; state: string | null } {
  const str = (v: unknown) => (v == null ? "" : String(v));
  switch (kind) {
    case "DESTINATION_ADDED":
    case "DESTINATION_REMOVED":
    case "DESTINATION_MOVED": {
      const before = Array.isArray(p.routeBefore) ? (p.routeBefore as string[]).join(" → ") : "";
      const after = Array.isArray(p.routeAfter) ? (p.routeAfter as string[]).join(" → ") : "";
      return {
        understanding: `A decided route change (${kind.replace("DESTINATION_", "").toLowerCase()} ${str(p.destination)}${p.after ? ` after ${str(p.after)}` : ""}), classified GROUP-scoped.`,
        state: after ? `Route: ${before || "(empty)"}  ⇒  ${after}` : null,
      };
    }
    case "TRAVELLER_CONSTRAINT_SET":
      return {
        understanding: `A personal time limit (${str(p.constraintKind)} ${str(p.localTime)}${p.onDate ? ` on ${str(p.onDate)}` : ""}) — structured personal state, not free text.`,
        state: `Traveller limit saved${p.replacedPrevious ? " (replaced an earlier one)" : ""}; group sees only a neutral "unavailable" line.`,
      };
    case "READINESS_CHANGED":
      return {
        understanding: `Readiness recomputed deterministically from signals: ${(Array.isArray(p.signals) ? (p.signals as string[]) : []).join(", ") || "none"}.`,
        state: `${str(p.commitment)}: ${str(p.from)} → ${str(p.to)}${p.bufferMinutes != null ? ` (buffer ${str(p.bufferMinutes)} min)` : ""}. Shown as: "${str(p.line)}"`,
      };
    case "VOICE_ESCALATION_PLACED":
      return { understanding: `A voice-escalation call was placed (${str(p.mode)} mode) for ${str(p.commitment)}.`, state: null };
    case "VOICE_CALL_OUTCOME":
      return {
        understanding: `Call result interpreted as ${str(p.outcome)}${p.estimatedDelayMinutes != null ? ` (${str(p.estimatedDelayMinutes)} min)` : ""} (${str(p.mode)} mode). Transcript is not shown here.`,
        state: "Fed into the readiness engine for this traveller.",
      };
    case "PAYMENT_LINK_CREATED":
      return { understanding: "A payment link was created. A link is not a payment.", state: `Payment request ${str(p.status)} — paid: false` };
    case "PAYMENT_LINK_STATUS":
      return { understanding: `Pine Labs status re-fetched: ${str(p.from)} → ${str(p.to)}.`, state: `Payment request is now ${str(p.to)}.` };
    case "PAYMENT_CONFIRMED":
      return { understanding: "Payment confirmed — status was fetched from Pine Labs' API, not taken from a callback body.", state: "Payment request PROCESSED; group card posted." };
    case "DOCUMENT_EXTRACTED": {
      const f = (p.facts ?? {}) as Record<string, unknown>;
      return {
        understanding: `Journey facts read from your private document: ${str(f.documentKind)}${f.origin ? ` ${str(f.origin)} → ${str(f.destination)}` : ""}${f.departureLocal ? `, departs ${str(f.departureLocal)}` : ""}. Names, PNR, seat and fare are never extracted.`,
        state: "Kept as personal state; may yield a private availability limit.",
      };
    }
    default:
      return { understanding: `Recorded as ${kind}.`, state: null };
  }
}

type RawToolCall = { name: string; input: unknown };

// viewerId scopes what may be shown: another traveller's private-room tool
// calls, private-sourced Decisions and PERSONAL events never appear — the
// trace is evidence of what the AGENT did for the group, not a window into
// anyone's private conversation.
export async function buildAgentTrace(tripId: string, viewerId: string | null): Promise<TraceEntry[]> {
  const [messages, decisions, escalations, auditLogs, tripEvents] = await Promise.all([
    prisma.message.findMany({
      where: {
        tripId,
        toolCalls: { not: null },
        OR: [{ channel: "GROUP" }, ...(viewerId ? [{ channel: "PRIVATE" as const, recipientId: viewerId }] : [])],
      },
      orderBy: { timestamp: "asc" },
    }),
    prisma.decision.findMany({ where: { tripId }, orderBy: { createdAt: "asc" } }).then((rows) => excludePrivateSourced(rows, viewerId)),
    prisma.escalationEvent.findMany({
      where: { tripId },
      include: { traveller: true, commitment: true },
      orderBy: { triggeredAt: "asc" },
    }),
    prisma.auditLog.findMany({ where: { tripId }, orderBy: { confirmedAt: "asc" } }),
    prisma.tripEvent.findMany({ where: { tripId }, orderBy: { createdAt: "asc" } }),
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


  // Typed events: the full chain for a consequential change. The source
  // quote is shown only when it came from the shared group room — a
  // PRIVATE/PERSONAL-scoped event never has its input echoed here.
  const sourceIds = tripEvents
    .filter((e) => e.scope === "GROUP" && e.sourceChannel === "GROUP" && e.sourceMessageId)
    .map((e) => e.sourceMessageId as string);
  const sourceMessages = sourceIds.length
    ? await prisma.message.findMany({ where: { id: { in: sourceIds } }, include: { sender: true } })
    : [];
  const sourceById = new Map(sourceMessages.map((m) => [m.id, m]));

  const notifications = await prisma.notification.findMany({
    where: { tripId, eventId: { not: null } },
    orderBy: { createdAt: "asc" },
  });
  const recipientNames = new Map(
    (await prisma.user.findMany({ where: { id: { in: [...new Set(notifications.map((n) => n.userId))] } }, select: { id: true, name: true } })).map((u) => [u.id, u.name])
  );
  const notesByEvent = new Map<string, typeof notifications>();
  for (const n of notifications) notesByEvent.set(n.eventId!, [...(notesByEvent.get(n.eventId!) ?? []), n]);

  for (const e of tripEvents) {
    const personal = e.scope === "PERSONAL";
    if (personal && (!viewerId || e.subjectUserId !== viewerId)) continue;
    const payload = parseJson<Record<string, unknown>>(e.payload, {});
    const surfaces = parseJson<string[]>(e.propagation, []);
    const source = e.sourceMessageId ? sourceById.get(e.sourceMessageId) : undefined;
    const { understanding, state } = describeEvent(e.kind, payload);

    const steps: TraceStep[] = [
      {
        label: "INPUT",
        text: source
          ? `${source.sender?.name ?? "Someone"}: "${source.content}"`
          : personal || e.sourceChannel === "PRIVATE"
            ? "(private source — not shown)"
            : `${SOURCE_LABEL[e.sourceChannel] ?? e.sourceChannel} (no chat message)`,
      },
      { label: "SOURCE", text: `${SOURCE_LABEL[e.sourceChannel] ?? e.sourceChannel} · ${personal ? "PERSONAL scope" : "GROUP scope"}${e.confidence ? ` · confidence ${e.confidence}` : ""}` },
      { label: "UNDERSTANDING", text: understanding },
      { label: "EVENT", text: e.kind },
    ];
    if (state) steps.push({ label: "STATE", text: state });
    if (surfaces.length) steps.push({ label: "PROPAGATION", text: `${surfaces.join(", ")} — these read the saved state directly` });
    for (const n of notesByEvent.get(e.id) ?? []) {
      const rails = parseJson<{ rail: string; status: string; detail?: string }[]>(n.deliveries, [])
        .map((d) => `${d.rail.toLowerCase().replace("_", "-")} ${d.status === "SENT" ? "✓" : d.status === "SKIPPED" ? `skipped (${d.detail ?? "n/a"})` : `failed (${d.detail ?? "unknown"})`}`)
        .join(", ");
      steps.push({ label: "NOTIFICATION", text: `${recipientNames.get(n.userId) ?? "A traveller"} · ${n.severity} · ${rails}${n.readAt ? " · read" : ""}` });
    }

    entries.push({
      timestamp: e.createdAt,
      kind: "TRIP_EVENT",
      title: `${e.kind} · ${personal ? "PRIVATE — only you can see this" : e.scope}`,
      detail: steps.map((x) => `${x.label} — ${x.text}`).join("\n"),
      steps,
    });
  }

  return entries.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
}
