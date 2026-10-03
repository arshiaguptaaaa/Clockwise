// Builds the agent trace shown at /trips/[tripId]/agent/trace by merging
// REAL rows from four existing tables into one chronological timeline —
// deliberately not a new logging table. Every field shown here already
// exists for its own operational reason (Message.toolCalls, Decision,
// EscalationEvent's real request/response fields, AuditLog); this module
// only merges and sorts, it never invents a "reasoning" string that
// isn't backed by an actual row. There is no chain-of-thought here —
// only the concise, factual outcome of what happened.
import { formatMoney } from "@/lib/budget/money";
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
function money(minor: unknown, currency: unknown): string {
  return formatMoney(Number(minor ?? 0), String(currency ?? "INR"));
}

function describeEvent(kind: string, p: Record<string, unknown>): { understanding: string; state: string | null } {
  const str = (v: unknown) => (v == null ? "" : String(v));
  switch (kind) {
    case "DESTINATION_ADDED":
    case "DESTINATION_REMOVED":
    case "DESTINATION_MOVED":
    case "DESTINATION_REPLACED": {
      const before = Array.isArray(p.routeBefore) ? (p.routeBefore as string[]).join(" → ") : "";
      const after = Array.isArray(p.routeAfter) ? (p.routeAfter as string[]).join(" → ") : "";
      const impact = (p.impact ?? {}) as {
        commitments?: string[];
        transportPlans?: number;
        bookings?: number;
        decisionsSuperseded?: number;
        tripRenamed?: { from: string; to: string } | null;
      };
      const extra = [
        impact.tripRenamed ? `Trip title "${impact.tripRenamed.from}" → "${impact.tripRenamed.to}"` : null,
        impact.decisionsSuperseded ? `${impact.decisionsSuperseded} earlier claim(s) about the old stop marked SUPERSEDED (agent no longer uses them)` : null,
        impact.commitments?.length ? `Meetings still naming the old stop (not auto-changed): ${impact.commitments.join(", ")}` : null,
        impact.transportPlans ? `${impact.transportPlans} transport plan(s) still naming it` : null,
        impact.bookings ? `${impact.bookings} booking(s) still naming it` : null,
      ].filter(Boolean);
      const what =
        kind === "DESTINATION_REPLACED"
          ? `A decided destination change: ${str(p.replaced)} → ${str(p.destination)}`
          : `A decided route change (${kind.replace("DESTINATION_", "").toLowerCase()} ${str(p.destination)}${p.after ? ` after ${str(p.after)}` : ""})`;
      return {
        understanding: `${what}, classified GROUP-scoped.`,
        state: after ? `Route: ${before || "(empty)"}  ⇒  ${after}${extra.length ? `\n${extra.join("\n")}` : ""}` : null,
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
    case "INVITE_CREATED":
      return { understanding: `Invitation created for ${str(p.invitee)}${p.callConsent ? " (reminder call consented)" : ""}.`, state: "Invite row PENDING; unique link generated." };
    case "INVITE_EMAIL_SENT":
    case "INVITE_EMAIL_RESENT":
      return {
        understanding: `Invitation email ${kind === "INVITE_EMAIL_RESENT" ? "re-sent" : "sent"} to ${str(p.invitee)} via ${str(p.provider)} — provider accepted it (message ${str(p.providerMessageId)}).`,
        state: `Intended: ${str(p.intendedRecipient)} · delivered to: ${str(p.deliveryRecipient)}${p.overridden ? " (sandbox override — Resend has no verified domain yet)" : ""}`,
      };
    case "INVITE_EMAIL_FAILED":
      return { understanding: `Invitation email to ${str(p.invitee)} was NOT sent: ${str(p.reason)}`, state: null };
    case "INVITE_FOLLOWUP_SCHEDULED":
      return {
        understanding: `Waiting for a RESPONSE (joining), not an email open. Follow-up due ${str(p.dueAt)} (${str(p.delayMinutes)} min deadline)${p.escalationCall ? "; reminder call also queued" : ""}.`,
        state: "Persistent scheduled job(s) created — no timers.",
      };
    case "INVITE_RESPONSE_OVERDUE":
      return { understanding: `${str(p.invitee)} did not join within the deadline.`, state: "Reminder job claimed by the worker." };
    case "INVITE_REMINDER_EMAIL_SENT":
      return {
        understanding: `Reminder email sent to ${str(p.invitee)} via ${str(p.provider)} (message ${str(p.providerMessageId)}).`,
        state: `Delivered to: ${str(p.deliveryRecipient)}${p.overridden ? " (sandbox override)" : ""}`,
      };
    case "ESCALATION_CALL_PLACED":
      return { understanding: `Gnani outbound call placed to ${str(p.invitee)} (request ${str(p.providerRequestId)}).`, state: null };
    case "ESCALATION_CALL_BLOCKED":
      return { understanding: `A reminder call to ${str(p.invitee)} was due but NOT placed: ${str(p.reason)}.`, state: "No call was made; nothing is simulated." };
    case "INVITE_ACCEPTED":
      return {
        understanding: `${str(p.invitee)} accepted the invitation — the response the follow-ups were waiting for.`,
        state: `Reminder jobs resolved: ${str(p.followUpsResolved)} · escalation calls cancelled: ${str(p.escalationsCancelled)}`,
      };
    case "AGENT_TURN_STARTED":
      return { understanding: "An agent turn started and has NOT finished — it was killed by a time limit or is still running. Nothing it did after this point is recorded.", state: null };
    case "AGENT_TURN_COMPLETED":
      return { understanding: `Agent turn finished in ${Math.round(Number(p.totalMs) / 100) / 10}s.`, state: null };
    case "AGENT_TURN_FAILED":
      return {
        understanding: `The agent turn threw an exception (${str(p.name)}: ${str(p.message)}). Nothing was acted on; the user was told to resend.`,
        state: null,
      };
    case "MODEL_REQUEST_FAILED": {
      const sh = (p.shape ?? {}) as Record<string, unknown>;
      return {
        understanding: `The model request was rejected: ${str(p.category)} (HTTP ${str(p.status)}), round ${str(p.round)}. Shape: ${str(sh.messageCount)} messages, roles ${Array.isArray(sh.roles) ? (sh.roles as string[]).join(">") : "?"}, last role ${str(sh.lastRole)}, ${str(sh.emptyParts)} empty part(s), ${str(sh.consecutiveSameRole)} consecutive same-role, ${str(sh.toolDeclarations)} tools, ${str(sh.functionCalls)} calls / ${str(sh.functionResponses)} responses. Google said: ${str(sh.googleMessage)}`,
        state: "The turn was not retried automatically (a 400 is not retryable). No content is stored here.",
      };
    }
    case "AGENT_STAYED_SILENT":
      return {
        understanding: `Read, and deliberately not acted on (${str(p.by) === "GATE" ? "deterministic filter, no model call" : "model judged it normal conversation"}): ${str(p.reason)}`,
        state: null,
      };
    case "VOICE_ESCALATION_PLACED":
      return { understanding: `A voice-escalation call was placed (${str(p.mode)} mode) for ${str(p.commitment)}.`, state: null };
    case "VOICE_CALL_OUTCOME":
      return {
        understanding: `Call result interpreted as ${str(p.outcome)}${p.estimatedDelayMinutes != null ? ` (${str(p.estimatedDelayMinutes)} min)` : ""} (${str(p.mode)} mode). Transcript is not shown here.`,
        state: "Fed into the readiness engine for this traveller.",
      };
    case "VOICE_CAPTURED":
      return { understanding: `Voice captured${p.audioMs ? ` (${(Number(p.audioMs) / 1000).toFixed(1)}s)` : ""}, ${str(p.language)}. Recording kept only long enough to transcribe.`, state: null };
    case "GNANI_STT_STARTED":
      return { understanding: `Audio sent from Clockwise's server to ${str(p.provider)} for transcription (${str(p.language)}).`, state: null };
    case "GNANI_STT_COMPLETED":
      return {
        understanding: p.ok
          ? `${str(p.provider)} returned a transcript (${str(p.transcriptChars)} characters) in ${str(p.latencyMs)} ms, request ${str(p.requestId) || "n/a"}. The text went to the composer for you to edit — nothing was sent automatically.`
          : `${str(p.provider)} could not transcribe (${str(p.reason)}${p.httpStatus ? `, HTTP ${str(p.httpStatus)}` : ""}) after ${str(p.latencyMs)} ms. No other provider was substituted.`,
        state: null,
      };
    case "PLACES_SEARCH_COMPLETED": {
      const when = p.retrievedAt ? new Date(String(p.retrievedAt)).toISOString().replace("T", " ").slice(0, 19) + " UTC" : "n/a";
      return {
        understanding: `PLACES_SEARCH_COMPLETED — provider ${str(p.provider)}, query ${str(p.category ?? p.tool)}${p.diet ? ` (provider ${str(p.diet)} search)` : ""}, anchor ${str(p.near)}, ${str(p.resultCount)} result(s), retrieved ${when}.`,
        state: "Places and ids come from the provider; the model only narrated them.",
      };
    }
    case "ROUTE_COMPLETED": {
      const snapped = Array.isArray(p.snapped) && p.snapped.length ? ` (${(p.snapped as string[]).join("; ")})` : "";
      return {
        understanding: `ROUTE_COMPLETED — provider ${str(p.provider)}: ${str(p.from)} → ${str(p.to)} by ${str(p.mode)}, ${(Number(p.distanceMeters) / 1000).toFixed(1)} km, ${Math.round(Number(p.durationSeconds) / 60)} min${snapped}. Provider-returned numbers.`,
        state: "Shown as a route card; no model estimate involved.",
      };
    }
    case "ROUTE_PLAUSIBILITY_FAILED":
      return { understanding: `ROUTE_PLAUSIBILITY_FAILED — ${str(p.from)} → ${str(p.to)} (provider measured ${(Number(p.distanceMeters) / 1000).toFixed(0)} km): ${str(p.reason)}.`, state: "Route withheld; the user was asked to confirm the places. No substitute number was produced." };
    case "STAY_PROPOSED":
      return { understanding: `A stay was proposed: ${str(p.name)} (${str(p.provider)} place ${str(p.providerPlaceId)}). Provider facts only — no rate or availability exists.`, state: "Opened a group vote. The Plan is unchanged." };
    case "STAY_APPROVED":
      return { understanding: `The group's vote and the organiser's approval chose ${str(p.name)}.`, state: "Stay is APPROVED but not booked — it is not yet the plan." };
    case "STAY_CONFIRMED":
      return { understanding: `${str(p.name)} was marked booked by the organiser.`, state: "Now authoritative: Plan, My Clockwise, \"our hotel\" routing and reminders read this one record." };
    case "EXPENSE_PROPOSED":
      return { understanding: `Money statement understood from chat: ${str(p.title)} — ${money(p.amountMinor, p.currency)}, paid by ${str(p.paidBy)}.`, state: "Held as a proposal. Nothing is on the ledger until the speaker confirms." };
    case "EXPENSE_ADDED": {
      const shares = Array.isArray(p.shares) ? (p.shares as { name: string; shareMinor: number }[]).map((x) => `${x.name} ${money(x.shareMinor, p.currency)}`).join(", ") : "";
      return { understanding: `Expense recorded: ${str(p.title)} — ${money(p.amountMinor, p.currency)} (${str(p.stage)}, ${str(p.splitMethod)} split).`, state: `Shares computed by code: ${shares}. Balances recalculated.` };
    }
    case "EXPENSE_UPDATED":
      return { understanding: `Expense edited: ${str(p.title)} — ${money(p.amountMinor, p.currency)}.`, state: "Shares and balances recalculated from the ledger." };
    case "EXPENSE_VOIDED":
      return { understanding: `Expense removed: ${str(p.title)}.`, state: "Balances recalculated; the original is kept as VOID for audit." };
    case "EXPENSE_PAID":
      return { understanding: `Committed spend became PAID: ${str(p.title)} — ${money(p.amountMinor, p.currency)}. Payment status was verified by fetching it from Pine Labs.`, state: p.needsPayer ? "Waiting for someone to say who paid — no balance created yet." : "Now counts toward balances." };
    case "SETTLEMENT_RECORDED":
      return { understanding: `${str(p.from)} paid ${str(p.to)} ${money(p.amountMinor, p.currency)} (${str(p.method)}). Recorded, not moved — Clockwise doesn't transfer money.`, state: "Balances recalculated." };
    case "BALANCES_RECALCULATED":
      return { understanding: "Balances recomputed from the ledger (integer arithmetic, per currency).", state: "Simplified settlement suggestions refreshed; underlying expenses untouched." };
    case "BUDGET_SET":
      return { understanding: `Group budget set${p.totalMinor ? `: ${money(p.totalMinor, p.currency)}` : ""}.`, state: "Budget bars and thresholds updated." };
    case "BUDGET_THRESHOLD_REACHED":
      return { understanding: `${str(p.level)}% of the group budget is planned (${money(p.plannedMinor, p.currency)} of ${money(p.totalMinor, p.currency)}).`, state: "Group notified once." };
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
