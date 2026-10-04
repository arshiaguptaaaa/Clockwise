import { prisma } from "@/lib/prisma";
import { buildGroupContext, buildPrivateContext, type AgentContext } from "./context";
import { AGENT_TOOLS, executeTool } from "./tools";
import { GeminiAgentProvider } from "./providers/gemini";
import { acknowledgeOpenReminders } from "@/lib/readiness";
import { isObviousNonTripChatter, isDirectlyAddressed, mentionsClockwise, mentionsOwnJourneyChange, QUIET_CAPTURE_TOOLS } from "./intervention-gate";
import { classifyMessage } from "@/lib/mentions";
import { routeAddressed, observePassive } from "./router";
import type { AgentModelProvider, AgentMessage, AgentToolSchema } from "./provider";

const MAX_TOOL_ROUNDS = 4;

// The one place that knows which model backs Clockwise today. Swapping
// providers later means writing a new class in providers/ and changing
// this single line — clockwise-agent.ts and tools.ts never touch a
// provider SDK directly.
function getAgentProvider(): AgentModelProvider {
  return new GeminiAgentProvider();
}

export type AgentTurnResult = {
  spoke: boolean;
  replyText?: string;
  failed?: boolean;
  toolCalls: { name: string; input: unknown }[];
};

// Exported for direct testing against the real model (see verification
// scripts) without needing a full AgentContext/DB round trip — these are
// pure functions with no side effects, safe to call in isolation.
export function toolsForMode(mode: AgentContext["mode"]): AgentToolSchema[] {
  return AGENT_TOOLS.filter((t) => {
    if (t.name === "stay_silent") return mode === "GROUP"; // private room: every message deserves a reply
    if (t.name === "update_participation_window") return mode === "PRIVATE";
    if (t.name === "update_trip_route") return mode === "GROUP"; // shared route only changes where the group can see it
    return true;
  });
}

export function buildSystemPrompt(ctx: AgentContext): string {
  const shared = [
    `You are Clockwise, the coordination, execution and recovery agent for a group trip called "${ctx.trip.name}".`,
    "Core rules:",
    "- Ask the smallest necessary question — at most ONE focused question per reply, and only after checking whether the structured trip state below, recent conversation, bookings, or commitments already answer it. Never ask a multi-part question (e.g. destination+dates+budget+airport all at once) — pick the single most blocking unknown.",
    "- A preference is not a hard constraint. Silence does not mean consent. The organiser does not automatically speak for the group — do not treat one person's agreement as the whole group's.",
    "- People-scoping: a statement concerns only the people it's actually about, not the whole group by default. 'I can't leave before 5' concerns that one traveller. 'Vasudha and I will take a separate cab' concerns exactly those two. Only a genuinely group-wide matter (core trip dates, the destination itself, a shared booking) concerns everyone. When you call record_trip_understanding, pass affectedTravellerNames narrowly — omit it entirely for a personal statement rather than naming everyone. Never ask travellers who aren't affected to weigh in on something that doesn't concern them.",
    "- When the structured trip state shows a claim or decision already 'concerns' specific people, treat the group's convergence as being about those people only — not every traveller on the trip.",
    "- Never fabricate travellers, dates, bookings, or facts that aren't in the structured state or conversation below.",
    "- The trip's ROUTE (which cities/regions, in what order) lives in the saved structured state above. When the group states a route change as decided — \"we'll go to Udaipur after Jaipur\" — call update_trip_route; never describe the route as changed unless that tool succeeded, and never treat a question or a maybe as a change. After it succeeds, answer from its result (e.g. the new route), not from memory.",
    "- Time-of-day limits are structured personal state, not free-text memory: when someone says they must be back/finished by a time, or can't start before one, call record_personal_constraint (convert to 24-hour HH:MM yourself). Never use record_trip_understanding for those. Before proposing or agreeing a specific time several people attend, call check_group_feasibility and speak only from its neutral result — it already hides private reasons. Never say or imply WHY a traveller is unavailable unless they said it in the group room themselves, and never state that a traveller is free just because no conflict is on record.",
    "- When a traveller says THEY will be late for a logged commitment (\"I'll be 20 minutes late\"), call report_delay with the minutes; answer from its result. The group sees only a status, never the reason — do not repeat the reason in the group room.",
    "- Call record_trip_understanding whenever the conversation reveals a preference, constraint, emerging/confirmed decision, conflict, participation change, or booking intent worth remembering past this conversation — this is how facts persist for future turns, not a reply to the user. Classify honestly: do not mark something CONFIRMED_DECISION unless the group has actually, explicitly agreed.",
    "- Consequential actions (transport, payment) are only ever PREPARED via tools, producing a pending card a human must confirm — never claim something is booked or charged unless a tool result says so.",
    "- For anything time/status related (readiness, ETA), always call the relevant tool rather than judging it yourself — you narrate the deterministic result, you don't invent it.",
    "- Readiness escalation is YOUR decision, never a human's instruction to wait for. If check_readiness shows a commitment is AT_RISK/MISSED and a specific traveller hasn't checked in, first call send_readiness_reminder and nudge them yourself in-chat (low-friction, short, in character — e.g. 'Arjun, alive? 👀 We leave in 30'). Only call escalate_via_voice_call later, once there has genuinely been no response from them since — never as your first move, and never because a human told you to call someone. escalate_via_voice_call will refuse itself if the preconditions (an unacknowledged reminder, opt-in, a phone on file) aren't actually met, so attempt it honestly rather than second-guessing whether it'll work.",
    "- You have two kinds of knowledge. TRIP KNOWLEDGE (travellers, dates, bookings, commitments, decisions — already in the structured state below) you can answer directly. LIVE WORLD KNOWLEDGE (hotels, places, addresses, distances, travel time, weather) you do NOT know yourself — you MUST call search_places/search_hotels/search_nearby/get_route/get_weather and answer only from what the tool actually returned. Never guess a hotel name, address, distance, or fare — if a live tool isn't configured or fails, say so honestly and still answer whatever part of the question trip state alone can cover.",
    "- Places and time windows. A traveller may search ANY named place, in any city, whether or not it is the trip's destination (they may be planning from Gurgaon or exploring somewhere else): 'coffee in Gurgaon', 'shopping in Jaipur', 'things to do in Goa' are all valid. Never refuse because the place isn't the trip destination; call search_nearby with category cafe / shopping / attraction / restaurant and near set to the place they named. 'Things to do' means category attraction; 'coffee' means cafe. These searches never depend on the traveller's preferences or Vibe Check. Any real café, restaurant, pharmacy, ATM, shop, park, museum or attraction you name must come from a search_nearby / free_time_options result this turn; never from memory, and never a rating, opening hour, website, phone number or 'best/amazing/locals love it' claim. 'Near me' is the traveller's CURRENT location, which only exists if they press USE MY LOCATION in Around You: search_nearby with anchor user_location tells them how; never substitute the hotel or destination for it unless they ask. 'Our hotel' and 'near us / around us' mean the group's CONFIRMED stay (anchor hotel; if there is no stay, say so). 'Near ME' alone is the traveller's current location. For 'within N minutes' pass maxMinutes; for 'what can we do in the next 90 minutes / before dinner' call free_time_options. For tickets or city-to-city travel ('tickets Delhi to Amritsar') call travel_options; an airport origin does NOT mean a flight, so offer FLIGHT · TRAIN · BUS, and never invent fares, timetables or availability. For 'can we do X before dinner?' about ONE named place call does_this_fit. Never judge what fits or convert distance to minutes yourself.",
    "- THE PLAN IS ONE SYSTEM. Chat, the Plan, Around and notifications all read the same saved state. To add, move or cancel a plan item you MUST call create_commitment / move_commitment / cancel_commitment and answer ONLY from the sentence the tool returns (it has been read back from the database). If a tool says it could not update the Plan, say exactly that; never say something was added, moved or cancelled unless a tool reported it. Pass days and times as the traveller said them ('tomorrow', 'saturday', '8 PM'): the tools compute the date, you never do.",
    "- Four levels, never collapsed: PICKED UP (a passing comment: memory only), IDEA (you connected comments into a possible plan: a suggestion), PROPOSAL (the group was formally asked and votes), CONFIRMED PLAN. A casual 'Cubbon Park also pls' is only ever picked up; it never becomes a plan item, and you never turn an idea into a proposal yourself — the card's PROPOSE TO GROUP button does. For 'what should we do Saturday afternoon?' call build_idea.",
    "- For ANY request for places ('dosa places in Bengaluru', 'coffee near our hotel', 'things to do around Cubbon Park', 'shopping near where Ridhima lands') call find_places with the traveller's words verbatim. The place, the dish and the anchor are read from the words in code; an explicit place in the message always wins over where anyone currently is. Never answer a place request with a paraphrase of the question or with names you remember.",
    "- Reply in 1-3 short, conversational sentences. No headings, no bullet lists, no markdown formatting — the tool result is already shown to the user as a card, so don't repeat it verbatim, just add the reasoning/recommendation on top of it.",
    "- Facts about the world come only from tools: never state a travel time, distance, restaurant, hotel, price or opening hour from memory. For any \"how long / how far\" question call get_route; for places call the search tools. If a tool fails or returns nothing, say you couldn't get it — do not substitute your own answer. A search request (\"find hotels in Udaipur\") is never a decision and never changes the trip route.",
    "- update_my_arrival: when the SPEAKER says THEIR OWN arrival changed (a delay, an earlier flight — \"my flight is delayed, I'll reach around 8:15\"), call it with the new time in 24-hour form. It updates only their own journey. If it's unclear whether they mean morning or evening, or which day, ask ONE short question and do not call it. It also reports which shared commitments are now at risk.",
    "- propose_commitment_reschedule: when update_my_arrival reports a shared commitment at risk, call this with the suggested time it gave you. Never move a commitment yourself and never state that it moved: it only posts a group proposal, and the Plan changes only after the group votes and the organiser confirms. After posting it, say so in one short line.",
    "- Commitment times are wall-clock local to the destination, written with a trailing Z and no timezone conversion (e.g. dinner at 8 PM on 12 Dec 2026 is 2026-12-12T20:00:00Z).",
    "- propose_expense: when someone states money they spent/paid for the trip with a clear amount (\"I paid 6k for dinner, split between us\"), call it — it only posts a confirmation card; you never record or settle money yourself, and you never do arithmetic on balances (the Budget tab computes them). Do not call it for future costs, hotel/booking proposals, or private budgets (\"my budget is 20k\" is personal and stays private).",
    "- propose_itinerary_change and propose_uber_ride post a card EVERY member of the group will see, from either room. Only call one when the idea genuinely needs the group's agreement — never for something that only affects the speaker personally (a dietary restriction, a budget limit, wanting their own room — those stay in this conversation, never become a group proposal). The `summary`/`title` you write become the ENTIRE group-visible content — write them fresh, describing only the proposal itself (what, who it affects, when, cost if relevant). Never quote, paraphrase, or hint at anything else from this conversation, and never include a private reason behind a public ask (e.g. propose \"look at a cheaper hotel option\" — never \"...because Priya said she's on a tight budget\").",
  ].join("\n");

  const modeBlock =
    ctx.mode === "GROUP"
      ? [
          "You are in Trip Room, the SHARED group conversation — all travellers see everything here.",
          "Never reveal any individual traveller's private data (budget figures, passport/visa specifics, personal reasons) even if you have it — speak only in consequences, e.g. \"this conflicts with one traveller's hard constraint\", never naming who or the value.",
          "Stay quiet on ordinary chatter between travellers — call stay_silent instead of replying unless: you're asked directly, clarification is needed, a decision was just reached worth a brief acknowledgement, an action is now relevant, or a risk/deadline materially affects the trip.",
          "A message that STATES A CHANGE TO TRIP STATE is never chatter, even with no @Clockwise: a new/changed destination (\"actually let's do Udaipur instead\", \"change Jaipur to Goa\" — with a single-stop route this is update_trip_route REPLACE), a route change, new dates, a meeting time or place (\"we'll leave at 6 instead\"), someone's availability or arrival. Apply it with the matching tool (update_trip_route, record_personal_constraint, create_commitment, report_delay, record_trip_understanding) and then confirm in one short sentence. Only a QUESTION or a maybe (\"should we do Udaipur?\") is not a change.",
          "'Asked directly' is broad: any message starting with @Clockwise or addressed to you by name is ALWAYS a direct ask and must get a real answer — this includes plain trip-data questions ('who's on this trip', 'how many travellers', 'what are our dates') just as much as travel/logistics questions ('where is our hotel', 'how far is dinner'). Only fall back to stay_silent for messages that are clearly travellers talking to EACH OTHER, not to you — e.g. 'lol', 'yes', an emoji, or banter with no @Clockwise/name address.",
          "A direct address is not a blank check: even when addressed by name, you only answer trip-coordination requests (timing, logistics, decisions, readiness, transport, payments, trip-relevant questions). You are not a general assistant — politely decline homework help, writing tasks, general trivia, or entertainment requests even if directly asked, in one short sentence, and stay focused on the trip.",
        ].join("\n")
      : [
          `You are in ${ctx.actingUserName}'s private "My Clockwise" room. Only ${ctx.actingUserName} and you see this conversation.`,
          `You may discuss ${ctx.actingUserName}'s own data freely. You must still never reveal another traveller's private data here.`,
          `${ctx.actingUserName}'s private profile:\n${ctx.privateProfileSummary ?? "(nothing on file yet)"}`,
          `This conversation itself is never copied anywhere. If ${ctx.actingUserName} raises something that genuinely needs the whole group's agreement, use propose_itinerary_change/propose_uber_ride to post ONLY the minimum structured proposal the group needs to decide — not what ${ctx.actingUserName} told you or why. If it's personal and doesn't need group agreement (their own preference, constraint, or situation), just handle it here and don't propose anything.`,
          `This room is still trip-scoped, not a general assistant — if ${ctx.actingUserName} asks for something unrelated to this trip (homework, unrelated writing, general knowledge, entertainment), politely decline and redirect to the trip in one short sentence, e.g. "I'll stick to this trip — I can help with the itinerary, timings, transport, or anything else around ${ctx.trip.name}." Never do the unrelated task itself.`,
        ].join("\n");

  return [shared, modeBlock, `Structured trip state:\n${ctx.stateSummary}`].join("\n\n");
}

// Gemini rejects any request that ENDS on a model turn ("Requests ending with a
// model turn are not supported", HTTP 400 — reproduced with synthetic
// conversations in /api/integrations/gemini/probe). Group chat can legitimately
// end on a Clockwise message: a card or notice posted just after the human
// message that triggered this turn. So the converted history is guaranteed to end
// on a user turn, and turns with no text (card-only rows) are dropped.
export function toAgentMessages(history: AgentContext["history"]): AgentMessage[] {
  const merged: { role: "user" | "assistant"; lines: string[] }[] = [];
  for (const turn of history) {
    if (!turn.content || !turn.content.trim()) continue;
    const role: "user" | "assistant" = turn.isClockwise ? "assistant" : "user";
    const text = turn.isClockwise ? turn.content : `${turn.senderName}: ${turn.content}`;
    const last = merged[merged.length - 1];
    if (last && last.role === role) {
      last.lines.push(text);
    } else {
      merged.push({ role, lines: [text] });
    }
  }
  if (merged.length > 0 && merged[0].role !== "user") {
    merged.unshift({ role: "user", lines: ["(conversation continues)"] });
  }
  if (merged.length > 0 && merged[merged.length - 1].role !== "user") {
    merged.push({ role: "user", lines: ["(Respond to the most recent human message above.)"] });
  }
  return merged.map((m) => ({ role: m.role, content: m.lines.join("\n") }));
}

// Safe to log unconditionally: tripId, mode, round counts and millisecond
// durations only — never message content, tool arguments, or anything
// that could carry a secret. This is the one place the whole turn's
// latency is visible end to end; before this, nothing measured where
// time in a Gemini turn actually went.
function logAgentTiming(ctx: AgentContext, timing: { contextBuildMs?: number; geminiMs: number[]; toolMs: number[]; totalMs: number }) {
  console.log(
    `[AgentTiming] trip=${ctx.trip.id} mode=${ctx.mode} rounds=${timing.geminiMs.length} ` +
      (timing.contextBuildMs !== undefined ? `contextBuildMs=${timing.contextBuildMs} ` : "") +
      `geminiMs=[${timing.geminiMs.join(",")}] toolMs=[${timing.toolMs.join(",")}] totalMs=${timing.totalMs}`
  );
}

async function runAgentTurnTimed(ctx: AgentContext, contextBuildMs?: number, addressed = true): Promise<AgentTurnResult> {
  const geminiMs: number[] = [];
  const toolMs: number[] = [];
  const turnStart = Date.now();
  try {
    return await runAgentTurn(ctx, geminiMs, toolMs, addressed);
  } finally {
    logAgentTiming(ctx, { contextBuildMs, geminiMs, toolMs, totalMs: Date.now() - turnStart });
  }
}

async function runAgentTurn(ctx: AgentContext, geminiMs: number[], toolMs: number[], addressed: boolean): Promise<AgentTurnResult> {
  const provider = getAgentProvider();
  const lastHuman = [...ctx.history].reverse().find((h) => !h.isClockwise);
  // Group chat is human-first: an unaddressed message gets quiet capture only.
  const quiet = ctx.mode === "GROUP" && !addressed;
  const system =
    buildSystemPrompt(ctx) +
    (quiet
      ? "\n\nQUIET MODE: nobody addressed Clockwise in the latest message. People are talking to each other. Use a tool ONLY to capture a consequential fact that was stated as decided (route change, personal time limit, delay, money spent). Otherwise call stay_silent. Never reply with text, never search or suggest. The ONE exception: if the speaker says their own arrival changed but the time is unclear (morning or evening? which day?), ask ONE short clarifying question instead of guessing."
      : "");
  // Directly addressed => a reply is mandatory, so silence isn't an option.
  const tools = toolsForMode(ctx.mode)
    .filter((t) => !(t.name === "stay_silent" && (addressed || (lastHuman && isDirectlyAddressed(lastHuman.content)))))
    .filter((t) => !quiet || QUIET_CAPTURE_TOOLS.has(t.name));
  let messages = toAgentMessages(ctx.history);
  const executedTools: { name: string; input: unknown }[] = [];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const genStart = Date.now();
    const result = await provider.generate({ system, tools, messages });
    geminiMs.push(Date.now() - genStart);

    if (result.error) {
      // Provider call failed after exhausting its own retries (or wasn't
      // retryable at all). This can only happen before any tool in this
      // turn has executed — tool calls are only dispatched below, after a
      // *successful* generate() — so surfacing this immediately and
      // tagging it `failed` is always safe to retry from scratch later.
      await prisma.tripEvent
        .create({
          data: {
            tripId: ctx.trip.id,
            kind: "MODEL_REQUEST_FAILED",
            scope: ctx.mode === "PRIVATE" ? "PERSONAL" : "GROUP",
            actorUserId: ctx.actingUserId,
            subjectUserId: ctx.mode === "PRIVATE" ? ctx.actingUserId : null,
            sourceChannel: ctx.mode === "PRIVATE" ? "PRIVATE" : "GROUP",
            confidence: "HIGH",
            // Structure and Google's own error text only — never message contents.
            payload: JSON.stringify({ category: result.error.category, status: result.error.status, round, shape: result.error.diagnostics ?? null }),
            propagation: "[]",
          },
        })
        .catch(() => undefined);
      return {
        spoke: true,
        replyText: result.text ?? "Something went wrong.",
        failed: true,
        toolCalls: executedTools,
      };
    }

    if (result.toolCalls.length === 0) {
      const text = result.text?.trim();
      if (text) {
        return { spoke: true, replyText: text, toolCalls: executedTools };
      }
      // A genuinely empty response (no text, no tool call) means the model
      // didn't comply with the stay_silent contract in form, but the
      // intent is the same. In GROUP mode this defaults to silence — the
      // whole point is Clockwise stays quiet unless it has something real
      // to say. In PRIVATE mode a non-reply would feel broken (the user is
      // talking directly to it), so it still gets a minimal acknowledgement.
      return ctx.mode === "GROUP"
        ? { spoke: false, toolCalls: executedTools }
        : { spoke: true, replyText: "Got it — let me know if there's more.", toolCalls: executedTools };
    }

    if (result.toolCalls.some((c) => c.name === "stay_silent")) {
      // Keep the call (and its reason) so a silent decision is auditable.
      for (const c of result.toolCalls) executedTools.push({ name: c.name, input: c.input });
      return { spoke: false, toolCalls: executedTools };
    }

    messages = [
      ...messages,
      { role: "assistant", content: result.text, toolCalls: result.toolCalls },
    ];

    const finals: string[] = [];
    for (const call of result.toolCalls) {
      executedTools.push({ name: call.name, input: call.input });
      const toolStart = Date.now();
      const toolResult = await executeTool(call.name, call.input, ctx);
      toolMs.push(Date.now() - toolStart);
      if (toolResult.finalReply) finals.push(toolResult.finalReply);
      messages = [
        ...messages,
        { role: "tool", toolCallId: call.id, name: call.name, output: toolResult.output },
      ];
    }
    // A tool that changed (or refused to change) the Plan has already said exactly what is true. That sentence is
    // the answer: the model is not given a chance to embellish it into a claim the database didn't confirm.
    if (finals.length > 0) return { spoke: true, replyText: [...new Set(finals)].join(" "), toolCalls: executedTools };
    // loop again so the model can narrate the tool result(s) in natural language
  }

  return { spoke: true, replyText: "I've noted that.", toolCalls: executedTools };
}

export async function respondToGroupMessage(
  tripId: string,
  actingUserId: string
): Promise<AgentTurnResult> {
  // Deterministic, not Gemini's call: the sender just speaking in the
  // group room acknowledges any reminder outstanding for them — this is
  // what lets escalate_via_voice_call's gate (checkEscalationReadiness)
  // tell "reminded and genuinely unresponsive" apart from "reminded, but
  // then said something else in chat".
  await acknowledgeOpenReminders(tripId, actingUserId);

  const contextStart = Date.now();
  const ctx = await buildGroupContext(tripId, actingUserId);

  const lastHumanTurn = [...ctx.history].reverse().find((h) => !h.isClockwise);
  const people = ctx.trip.members.map((m) => ({ userId: m.userId, name: m.user.name }));
  const klass = lastHumanTurn ? classifyMessage(lastHumanTurn.content, people) : null;
  const addressed = klass ? klass.mode === "EXPLICIT" || klass.mode === "REQUEST" : false;

  // PASSIVE: Clockwise listens without answering. Pointers and soft agreement are captured, the speaker's own
  // arrival change is applied, and a connected idea may surface. Nothing here posts a chat reply.
  let passiveCalls: { name: string; input: unknown }[] = [];
  let needsModel = true;
  if (lastHumanTurn && !addressed) {
    const obs = await observePassive(ctx, lastHumanTurn, { mentionedAll: Boolean(klass?.mentions.all) }).catch((err) => {
      console.error("[observe] failed:", err instanceof Error ? err.message : err);
      return { calls: [], needsModel: true };
    });
    passiveCalls = obs.calls;
    needsModel = obs.needsModel;
  } else if (lastHumanTurn) {
    // "@Clockwise I'm vegetarian" - still remember it.
    const { observeMessage } = await import("@/lib/pointers/store");
    await observeMessage({ tripId, userId: actingUserId, messageId: lastHumanTurn.id, text: lastHumanTurn.content }).catch(() => undefined);
  }

  if (lastHumanTurn && !addressed && (!needsModel || isObviousNonTripChatter(lastHumanTurn.content))) {
    await recordSilence(tripId, lastHumanTurn.id, "GATE", passiveCalls.length ? `Noticed quietly: ${passiveCalls.map((c) => c.name).join(", ")}.` : "Ordinary conversation between travellers.");
    return { spoke: false, toolCalls: passiveCalls };
  }

  // EXPLICIT / REQUEST: understood in code first (plan edits, place searches, ideas), answered from what was persisted.
  if (lastHumanTurn && addressed && klass) {
    const routed = await routeAddressed(ctx, lastHumanTurn, klass.mode as "EXPLICIT" | "REQUEST").catch((err) => {
      console.error("[router] failed:", err instanceof Error ? err.message : err);
      return { handled: false as const };
    });
    if (routed.handled) {
      if (routed.reply) {
        await prisma.message.create({
          data: { tripId, senderId: ctx.clockwiseUserId, channel: "GROUP", content: routed.reply, toolCalls: routed.calls.length ? JSON.stringify(routed.calls) : null },
        });
      }
      return { spoke: Boolean(routed.reply), replyText: routed.reply ?? undefined, toolCalls: routed.calls };
    }
  }

  const rawResult = await runAgentTurnTimed(ctx, Date.now() - contextStart, addressed);
  rawResult.toolCalls = [...passiveCalls, ...rawResult.toolCalls];
  // Unaddressed group message: whatever the model said is dropped; only its captures (tool effects, which post
  // their own cards) remain.
  const unaddressed = !addressed;
  const allowQuestion = Boolean(lastHumanTurn && mentionsOwnJourneyChange(lastHumanTurn.content)) && /\?\s*$/.test(rawResult.replyText ?? "");
  const result = unaddressed && rawResult.spoke && !rawResult.failed && !allowQuestion ? { ...rawResult, spoke: false, replyText: undefined } : rawResult;
  if (!result.spoke && lastHumanTurn) {
    const silent = result.toolCalls.find((c) => c.name === "stay_silent");
    await recordSilence(
      tripId,
      lastHumanTurn.id,
      "MODEL",
      (silent?.input as { reason?: string } | undefined)?.reason ?? (result.toolCalls.length ? "Acted via tools without replying." : "No reply needed.")
    );
  }

  if (result.spoke && result.replyText) {
    await prisma.message.create({
      data: {
        tripId,
        senderId: ctx.clockwiseUserId,
        channel: "GROUP",
        content: result.replyText,
        toolCalls: result.toolCalls.length > 0 ? JSON.stringify(result.toolCalls) : null,
        failed: result.failed ?? false,
      },
    });
  }

  return result;
}

// Silence is a decision, so it leaves a record: the Agent Trace can show that a
// message was read and deliberately not acted on (and by which layer), instead
// of leaving a gap that looks like a failure.
async function recordSilence(tripId: string, messageId: string, by: "GATE" | "MODEL", reason: string) {
  await prisma.tripEvent
    .create({
      data: {
        tripId,
        kind: "AGENT_STAYED_SILENT",
        scope: "GROUP",
        sourceChannel: "GROUP",
        sourceMessageId: messageId,
        confidence: "MEDIUM",
        payload: JSON.stringify({ by, reason: reason.slice(0, 200) }),
        propagation: "[]",
      },
    })
    .catch(() => undefined);
}

export async function respondToPrivateMessage(
  tripId: string,
  actingUserId: string
): Promise<AgentTurnResult> {
  const contextStart = Date.now();
  const ctx = await buildPrivateContext(tripId, actingUserId);
  const result = await runAgentTurnTimed(ctx, Date.now() - contextStart);

  if (result.spoke && result.replyText) {
    await prisma.message.create({
      data: {
        tripId,
        senderId: ctx.clockwiseUserId,
        channel: "PRIVATE",
        recipientId: actingUserId,
        content: result.replyText,
        toolCalls: result.toolCalls.length > 0 ? JSON.stringify(result.toolCalls) : null,
        failed: result.failed ?? false,
      },
    });
  }

  return result;
}
