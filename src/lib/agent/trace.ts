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
        understanding: p.parsed
          ? `PLACES_SEARCH_COMPLETED — asked "${str(p.request)}". Read as WHAT ${str((p.parsed as { what?: unknown }).what) || "—"} · CATEGORY ${str((p.parsed as { category?: unknown }).category)} · ANCHOR ${str((p.parsed as { anchor?: unknown }).anchor)}${(p.parsed as { anchorText?: unknown }).anchorText ? ` "${str((p.parsed as { anchorText?: unknown }).anchorText)}"` : ""} → resolved to ${str((p.anchor as { label?: unknown } | undefined)?.label)}. Chain: ${Array.isArray(p.chain) ? (p.chain as { step: string; provider: string; status: string }[]).map((c) => `${c.step} ${c.provider}:${c.status}`).join(", ") : "n/a"}. ${str(p.resultCount)} result(s), ${str(p.keywordMatches)} tagged/named for the dish${p.diet ? `, ${str(p.diet)} filter` : ""}, retrieved ${when}.${p.error ? ` Error: ${str(p.error)}` : ""}`
          : `PLACES_SEARCH_COMPLETED — provider ${str(p.provider)}, query ${str(p.category ?? p.tool)}${p.diet ? ` (provider ${str(p.diet)} search)` : ""}, anchor ${p.anchorType ? `${str(p.anchorType)} (${str(p.anchor)})` : str(p.near)}, ${str(p.resultCount)} result(s), retrieved ${when}.`,
        state: "Places and ids come from the provider; the model only narrated them.",
      };
    }
    case "ROUTE_COMPLETED": {
      if (Array.isArray(p.modes)) {
        const legs = (p.modes as { mode: string; distanceMeters: number; durationMinutes: number }[]).map((m) => `${m.mode} ${m.durationMinutes} min / ${(m.distanceMeters / 1000).toFixed(1)} km`).join(", ");
        return { understanding: `ROUTE_COMPLETED — provider ${str(p.provider)}: ${str(p.from)} → ${str(p.to)} (anchor ${str(p.anchorType)}): ${legs}. Provider-returned numbers.`, state: "Shown in Around You; no model estimate involved. No exact user coordinates are recorded." };
      }
      const snapped = Array.isArray(p.snapped) && p.snapped.length ? ` (${(p.snapped as string[]).join("; ")})` : "";
      return {
        understanding: `ROUTE_COMPLETED — provider ${str(p.provider)}: ${str(p.from)} → ${str(p.to)} by ${str(p.mode)}, ${(Number(p.distanceMeters) / 1000).toFixed(1)} km, ${Math.round(Number(p.durationSeconds) / 60)} min${snapped}. Provider-returned numbers.`,
        state: "Shown as a route card; no model estimate involved.",
      };
    }
    case "ARRIVAL_ROUTE_COMPLETED":
    case "DELHIVERY_ROUTE_COMPLETED":
      return {
        understanding: `${kind} — ${str(p.traveller)}: ${str(p.from)} → ${str(p.to)}, ${str(p.km)} km, ${str(p.minutes)} min${p.trafficAware ? ` (traffic-aware estimate for a ${str(p.departure).slice(11)} departure, hour-of-day model, not live traffic)` : ""}${p.fellBackFrom ? `; Delhivery wasn't available (${str(p.fellBackFrom)}) so ${str(p.provider)} answered` : ""}. Provider-returned numbers. Exact request and response: Developer Evidence${p.evidenceId ? ` (${str(p.evidenceId)})` : ""}.`,
        state: "Stored on the traveller's journey as arrival → stay time; feeds the earliest-at-stay time used for every shared commitment.",
      };
    case "RENDEZVOUS_CONFLICT_DETECTED":
      return { understanding: `RENDEZVOUS_CONFLICT_DETECTED — ${str(p.traveller)} can't be at the stay before ${str(p.hotelBy).slice(11)}, but ${str(p.commitment)} is at ${str(p.target).slice(11)}.`, state: "Deterministic comparison of the provider route time with the commitment time. The organiser was told; a reschedule proposal may follow." };
    case "GROUP_APPROVED":
      return { understanding: `GROUP_APPROVED — every traveller accepted "${str(p.title)}" (${str(p.approved)} of ${str(p.voters)}).`, state: "The Plan is still unchanged: the organiser makes it official." };
    case "LOCATION_REVERSE_GEOCODED":
      return { understanding: `A traveller pressed ME; their position was turned into a place name by ${str(p.provider) || "no provider"} (${p.resolved ? "resolved" : "not resolved"}).`, state: "Coordinates and the resulting locality were not stored, and no location trail is kept." };
    case "ANYWHERE_RESOLVED":
      return { understanding: `ANYWHERE — the traveller picked "${str(p.label)}" (${str(p.provider)}) as the place to search around.`, state: "Delhivery resolves the place first; Geoapify then finds the real cafés, restaurants and sights around it." };
    case "FIT_CHECKED":
      return { understanding: `FIT_CHECKED — "${str(p.place)}": ${str(p.verdict)}${p.commitment ? ` before ${str(p.commitment)}` : ""}${p.whatIf ? " (what-if departure, labelled as such)" : ""}. ${str(p.toMin)} min there, ${str(p.onMin)} min back${p.spareMin != null ? `, ${str(p.spareMin)} min spare` : ""}. Routes: ${str(p.routeProvider)}. IsoSuite reachability: ${p.reachChecked ? (p.reachInside ? "inside" : "outside") + ` (${str(p.reachProvider)})` : "not checked"}.`, state: "Deterministic: provider travel times + the Plan's next commitment + a stated time-at-place assumption. No coordinates recorded." };
    case "MEETUP_RANKED":
      return { understanding: `MEETUP_RANKED — ${str(p.candidates)} real places compared for ${str(p.travellers)} travellers using the ${str(p.provider)} distance matrix; best: ${str(p.best)} (longest journey ${str(p.bestWorstMinutes)} min).`, state: "Ranked by the longest single journey, then the total — not a geometric midpoint. No one's position is recorded here." };
    case "TRAVEL_BOOKING_HANDOFF":
      return { understanding: `TRAVEL_BOOKING_HANDOFF — ${str(p.origin)} → ${str(p.destination)}${p.date ? ` on ${str(p.date)}` : ""}: handed the traveller to ${Array.isArray(p.modes) ? (p.modes as string[]).join(", ") : "the provider"}'s own booking page.`, state: "No live fare, timetable or seat feed is connected, so none was shown or claimed; nothing was booked by Clockwise." };
    case "PAYMENT_COLLECTION_CREATED": {
      const ob = Array.isArray(p.obligations) ? (p.obligations as { name: string; amountMinor: number; alreadyPaid: boolean }[]) : [];
      return { understanding: `PAYMENT_COLLECTION_CREATED — "${str(p.title)}", ${(Number(p.totalMinor) / 100).toLocaleString("en-IN")} ${str(p.currency)}: ${ob.map((o) => `${o.name} ${(o.amountMinor / 100).toLocaleString("en-IN")}${o.alreadyPaid ? " (already paid)" : ""}`).join(", ")}.`, state: "One obligation per traveller. No Pine Labs link exists yet: each person's own link is created when they press PAY. Nothing is marked paid." };
    }
    case "PAYMENT_OBLIGATION_PAID":
      return { understanding: `PAYMENT_OBLIGATION_PAID — ${str(p.traveller)} paid ${(Number(p.amountMinor) / 100).toLocaleString("en-IN")} for "${str(p.title)}"; ${str(p.paidCount)} of ${str(p.of)} paid (${(Number(p.collectedMinor) / 100).toLocaleString("en-IN")} / ${(Number(p.totalMinor) / 100).toLocaleString("en-IN")}).`, state: `Applied once, from a status Clockwise fetched from Pine Labs (${str(p.verifiedBy)}). Only this traveller's obligation changed; Budget recorded their share.` };
    case "COMMITMENT_ADDED":
      return { understanding: `COMMITMENT_ADDED — "${str(p.name)}" at ${str(p.at).replace("T", " ")}${p.location ? `, ${str(p.location)}` : ""}, ${p.via === "chat" ? `added from chat by ${str(p.by)}; the saved row was read back before anything was acknowledged` : "picked in the calendar"}.`, state: "Shared Plan item; every traveller's clock is checked against it." };
    case "LOCATION_REQUESTED":
      return { understanding: "A traveller pressed USE MY LOCATION; the browser was asked for permission.", state: "Private. Nothing is tracked in the background and no coordinates are recorded here." };
    case "LOCATION_PERMISSION_GRANTED":
      return { understanding: "The browser granted location for one search.", state: "The position stays in the traveller's own session memory; it is not stored, logged or shown to the group." };
    case "LOCATION_PERMISSION_DENIED":
      return { understanding: "The traveller declined (or the browser blocked) location.", state: "Clockwise offered hotel/destination search instead; nothing else changed." };
    case "LOCATION_SEARCH_COMPLETED":
      return { understanding: `A location-anchored place search finished — provider ${str(p.provider)}, ${str(p.category)}, ${str(p.resultCount)} result(s), retrieved ${p.retrievedAt ? new Date(String(p.retrievedAt)).toISOString().slice(0, 19).replace("T", " ") + " UTC" : "n/a"}.`, state: "Coordinates were used for the request only (not stored)." };
    case "DEMO_SCENARIO_READY": {
      const steps = (Array.isArray(p.steps) ? p.steps : []) as { step: string; ok: boolean; detail?: string }[];
      return {
        understanding: `Demo scenario background set up before the demo started. ${steps.map((x) => `${x.step}: ${x.ok ? "ok" : "FAILED"}${x.detail ? ` (${x.detail})` : ""}`).join("; ")}.`,
        state: "Provider facts (destination, stay, airport, routes) were fetched from Open-Meteo and Geoapify at setup time; the travellers' choices (dinner at 8 PM, arrival times, vibes) are scripted background, not provider data.",
      };
    }
    case "DEMO_SCENARIO_STARTED":
      return { understanding: "Demo scenario setup started.", state: null };
    case "FREE_TIME_COMPUTED":
      return { understanding: `Free-time options computed: ${str(p.windowMinutes)}-minute window (${str(p.windowSource)}), anchor ${str(p.anchorType)}; ${str(p.considered)} real Geoapify places routed on foot, ${str(p.fitting)} fit${p.rainyMode ? "; rain in the window (Open-Meteo), so indoor-type categories only" : ""}.`, state: "Deterministic: provider places + provider walking routes + a stated time-at-place assumption. The model did not decide what fits." };
    case "PLACE_PROPOSED":
      return { understanding: `A real place (${str(p.name)}, ${str(p.provider)} id ${str(p.providerPlaceId)}) was proposed to the group.`, state: "Group proposal opened; nothing is booked or scheduled." };
    case "PLACE_AGREED":
      return { understanding: `The group agreed on ${str(p.name)} (${str(p.provider)} id ${str(p.providerPlaceId)}). Booked: ${str(p.booked)}.`, state: "Appears in the Plan as an agreed place. Not a booking, not a scheduled activity." };
    case "PLACE_OVERLAP_DETECTED":
      return { understanding: `${str(p.savedBy)} of ${str(p.members)} travellers saved the same real place (${str(p.name)}, ${str(p.provider)} id ${str(p.providerPlaceId)}).`, state: "A count only: who saved it is not recorded here and is not shown to anyone." };
    case "ROUTE_PLAUSIBILITY_FAILED":
      return { understanding: `ROUTE_PLAUSIBILITY_FAILED — ${str(p.from)} → ${str(p.to)} (provider measured ${(Number(p.distanceMeters) / 1000).toFixed(0)} km): ${str(p.reason)}.`, state: "Route withheld; the user was asked to confirm the places. No substitute number was produced." };
    case "TRAVELLER_ARRIVAL_UPDATED": {
      const aff = Array.isArray(p.affectedCommitments) ? (p.affectedCommitments as { name: string; at: string; suggested: string }[]) : [];
      return {
        understanding: `${str(p.traveller)} changed THEIR OWN arrival: ${str(p.oldArrival).replace("T", " ") || "none"} → ${str(p.newArrival).replace("T", " ")} (${Number(p.movedMinutes) >= 0 ? "+" : ""}${str(p.movedMinutes)} min). No transcript or reason is stored here. Commitments now at risk: ${aff.length ? aff.map((a) => `${a.name} at ${a.at.replace("T", " ")} (suggested ${a.suggested.replace("T", " ")})`).join("; ") : "none"}.`,
        state: `Journey updated; provider routes recomputed${p.routeKnown ? "" : " (route unknown — nothing was assumed)"}; Plan arrivals, Ready? and rendezvous refreshed.`,
      };
    }
    case "TRAVELLER_DELAY_DETECTED":
      return { understanding: `TRAVELLER_DELAY_DETECTED — ${str(p.traveller)} said their arrival moved ${str(p.direction)} by ${Math.abs(Number(p.movedMinutes))} min (${str(p.from).replace("T", " ")} → ${str(p.to).replace("T", " ")}). Recognised from ${str(p.recognisedFrom)}.`, state: "Stage: TRIP_STATE_UPDATE. Nothing in the shared Plan has moved." };
    case "JOURNEY_UPDATED":
      return { understanding: p.change ? `JOURNEY_UPDATED — ${str(p.traveller)}'s arrival point changed to ${str(p.to)}.` : `JOURNEY_UPDATED — ${str(p.traveller)}: scheduled ${str(p.scheduledArrival).replace("T", " ")}, now expected ${str(p.expectedArrival).replace("T", " ")}.`, state: str(p.note) || "The ticket's scheduled arrival is kept separately from the expected one." };
    case "NEXT_ANCHOR_RESOLVED":
      return { understanding: `NEXT_ANCHOR_RESOLVED — ${str(p.traveller)} needs to get to: ${p.anchor ? `${str(p.anchor)} (${str(p.anchorKind)})` : "no usable anchor yet"}. Order tried: ${Array.isArray(p.order) ? (p.order as string[]).join(" → ") : ""}.`, state: str(p.note) };
    case "ANCHOR_QUESTION_ASKED":
      return { understanding: `${str(p.traveller)} was asked where they are heading after the airport${p.forCommitment ? ` (needed to check ${str(p.forCommitment)})` : ""}.`, state: "No hotel or city centre was invented." };
    case "ROUTE_CALCULATED":
      return { understanding: p.ok ? `ROUTE_CALCULATED — ${str(p.traveller)}: ${str(p.from)} → ${str(p.to)}, ${str(p.minutes)} min / ${str(p.km)} km, measured by ${str(p.provider)}.` : `ROUTE_CALCULATED — no provider route for ${str(p.traveller)} (${str(p.reason)}). Nothing was guessed.`, state: "Route minutes come from the routing provider." };
    case "REALISTIC_READY_TIME_UPDATED":
      return { understanding: `REALISTIC_READY_TIME_UPDATED — ${str(p.traveller)} LANDS ${str(p.landsAt).replace("T", " ")} ≠ AVAILABLE ${str(p.readyAt).replace("T", " ")} (+${str(p.allowanceMin)} min bags & exits, +${str(p.routeMinutes)} min via ${str(p.routeProvider)}).`, state: "Lands at ≠ available at. The allowance is a stated assumption, kept apart from the route." };
    case "COMMITMENT_CONFLICT_DETECTED":
      return { understanding: `COMMITMENT_CONFLICT_DETECTED — ${str(p.traveller)} can't be ready until ${str(p.readyAt).replace("T", " ")}, but "${str(p.commitment)}" is at ${str(p.target).replace("T", " ")} (${str(p.slackMinutes)} min).`, state: "Read from the stored Plan, not from the chat." };
    case "AFFECTED_TRAVELLERS_IDENTIFIED":
      return { understanding: `AFFECTED_TRAVELLERS_IDENTIFIED — "${str(p.commitment)}" involves ${Array.isArray(p.affected) ? (p.affected as string[]).join(", ") : ""} (${str(p.ofTrip)} on the trip).`, state: str(p.note) };
    case "RESOLUTION_SUGGESTED":
      return { understanding: `RESOLUTION_SUGGESTED — "${str(p.commitment)}": ${p.suggested ? `${str(p.suggested).replace("T", " ")}` : "no time fits everyone's stated limits"}${Array.isArray(p.options) && (p.options as string[]).length ? `, other options ${(p.options as string[]).map((o) => o.slice(11)).join(", ")}` : ""}.`, state: "Stage: SUGGESTION. Nothing has moved; a human decides." };
    case "GROUP_PROPOSAL_CREATED":
      return { understanding: `GROUP_PROPOSAL_CREATED — move "${str(p.commitment)}" ${str(p.from).replace("T", " ")} → ${str(p.to).replace("T", " ")}; voters: ${Array.isArray(p.voters) ? (p.voters as string[]).join(", ") : ""}.`, state: "Stage: PROPOSAL. Only the people the commitment involves vote." };
    case "AFFECTED_INFORMED":
      return { understanding: `AFFECTED_INFORMED — ${Array.isArray(p.informed) ? (p.informed as string[]).join(", ") : ""} were told about the clash on "${str(p.commitment)}".`, state: str(p.note) };
    case "CLASH_LEFT_AS_IS":
      return { understanding: `A human chose to leave "${str(p.commitment)}" as it is.`, state: str(p.note) };
    case "PLAN_UPDATED":
      return { understanding: `PLAN_UPDATED — "${str(p.commitment)}" ${str(p.change)}${p.from ? ` ${str(p.from).replace("T", " ")} → ${str(p.to).replace("T", " ")}` : ""}. Saved row read back.`, state: "Canonical Plan changed; every traveller's view refreshed." };
    case "COMMITMENT_CANCELLED":
      return { understanding: `COMMITMENT_CANCELLED — "${str(p.commitment)}" (${str(p.at).replace("T", " ")}) taken out of the Plan${p.via === "proposal" ? " after the group agreed" : " by the organiser from chat"}. Read back from the database: status CANCELLED.`, state: "Canonical Plan changed; every traveller's view refreshed; group notified." };
    case "POINTER_CAPTURED":
      return { understanding: `PASSIVE POINTER — ${str(p.label)} ("${str(p.subject)}", ${str(p.kind)}), mentioned ${str(p.mentions)}×. Noticed in ordinary chat; no reply was sent.`, state: "Memory only. This is not a plan item, not a suggestion and not a proposal." };
    case "POINTER_SUPPORTED":
      return { understanding: `PASSIVE POINTER — "${str(p.subject)}" got agreement from another traveller (${str(p.supporters)} now). Interest, not permission.`, state: "Still memory only. Nothing was added to the Plan." };
    case "POINTER_FORGOTTEN":
      return { understanding: `A traveller removed what Clockwise had picked up ("${str(p.subject)}").`, state: "Memory edited by the person it was about." };
    case "SUGGESTION_CREATED":
      return { understanding: `SUGGESTION — Clockwise connected pointers into an idea: ${str(p.title)}. Window ${str((p.window as { start?: unknown } | undefined)?.start).replace("T", " ")} → ${str((p.window as { end?: unknown } | undefined)?.end).replace("T", " ")}.`, state: "Stage 2 of 4. Nothing is in the Plan and nobody has been asked to vote." };
    case "SUGGESTION_PROPOSED":
      return { understanding: `PROPOSAL — ${str(p.proposedBy)} pressed PROPOSE TO GROUP on "${str(p.title)}". The group is now being asked.`, state: "Stage 3 of 4. The Plan changes only after every vote and the organiser's confirmation." };
    case "SUGGESTION_DISMISSED":
      return { understanding: `"${str(p.title)}" was dismissed (NOT NOW).`, state: "Pointers stay as memory; the idea is not offered again right now." };
    case "COMMITMENT_RESCHEDULE_PROPOSED":
      return { understanding: `Clockwise proposed moving "${str(p.commitment)}" ${str(p.oldTime).replace("T", " ")} → ${str(p.proposedTime).replace("T", " ")} because ${str(p.because)}.`, state: "Group proposal opened. The Plan is unchanged until the group votes and the organiser confirms." };
    case "COMMITMENT_RESCHEDULED": {
      const a = (p.approvals ?? {}) as { approved?: number; rejected?: number; total?: number };
      return { understanding: `"${str(p.commitment)}" moved ${str(p.oldTime).replace("T", " ")} → ${str(p.newTime).replace("T", " ")}. Why: ${str(p.why)}. Votes: ${str(a.approved)} approved, ${str(a.rejected)} rejected of ${str(a.total)}; organiser confirmed.`, state: "Canonical commitment changed; rendezvous recomputed; group told once." };
    }
    case "VIBE_CHECK_COMPLETED":
      return { understanding: `Vibe check completed (${Array.isArray(p.answered) ? (p.answered as string[]).length : 0} questions answered). Answers are stored as private structured preferences — they are not shown here and never went to the group.`, state: "Feeds Around You ordering and Ready?; nothing posted to group chat." };
    case "AROUND_YOU_REFRESHED":
      return { understanding: `Around You — provider ${str(p.provider)}, ${p.brand ? `brand search "${str(p.brand)}" (found ${str(p.found)}, closest alternatives ${str(p.alternatives)})` : `category ${str(p.category)}${p.diet ? ` (provider ${str(p.diet)} search)` : ""}, ${str(p.resultCount)} result(s), walking times from provider routes for ${str(p.walkMinutesFromProvider)}`}; anchor ${str(p.anchorType)}: ${str(p.anchor)}; retrieved ${p.retrievedAt ? new Date(String(p.retrievedAt)).toISOString().slice(0, 19).replace("T", " ") + " UTC" : "n/a"}.`, state: "Places and minutes are provider data; the model was not involved." };
    case "SAVED_PLACE_ADDED":
      return { understanding: `A place was saved privately (${str(p.kind)}, ${str(p.provider)} id ${str(p.providerPlaceId)}).`, state: "Private. The Plan and group are unchanged." };
    case "TRAVELLER_JOURNEY_CONFIRMED":
      return { understanding: `${str(p.name)} confirmed their journey: ${str(p.mode)}${p.arriveLocal ? `, arriving ${str(p.arriveLocal).replace("T", " ")}` : ""}${p.arrivalPlace ? ` at ${str(p.arrivalPlace)}` : ""}${p.resolvedArrival ? "" : " (arrival point not resolved)"}. Ticket identifiers are not stored or shown.`, state: "Updated: My Clockwise journey, Plan arrivals, Ready?, rendezvous, notifications." };
    case "RENDEZVOUS_COMPUTED":
      return { understanding: `Rendezvous recomputed from ${str(p.journeys)} confirmed journey(s) against ${p.stay ? str(p.stay) : "no confirmed stay yet"}; ${str(p.routedNow)} new provider route(s) (${str(p.provider)}), ${str(p.bufferMinutes)}-minute arrival allowance.`, state: "Plan shows each traveller's clock and any clash with shared commitments." };
    case "RENDEZVOUS_AT_RISK":
      return { understanding: `${str(p.traveller)} can't be at the stay before ${str(p.hotelBy).replace("T", " ")}, but "${str(p.commitment)}" is at ${str(p.target).replace("T", " ")}.`, state: "Organiser notified once." };
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
    case "PRIVATE_AGENT_MESSAGE_RECEIVED":
      return { understanding: `A private message to Clockwise was read as: ${str(p.intent)}${p.scope ? `, ${str(p.scope)} scope, ${str(p.recipientCount)} recipient(s)` : ""}. The words are not recorded here.`, state: "Nothing posted to the group chat." };
    case "RECIPIENT_NOTIFICATION_REQUESTED":
      return { understanding: `A note from you was handed to ${str(p.recipientCount)} traveller(s) (${str(p.visibility ?? "PRIVATE_TO_RECIPIENTS")}). The sender is named on it. The words are not recorded here.`, state: "Delivery rails are listed below." };
    case "RECIPIENT_NOTIFICATION_DELIVERED":
      return { understanding: `The note appeared on the recipient's screen (${str(p.surface)}).`, state: "Delivered in-app. Browser/OS push is only reported when it actually sent." };
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
