// The deterministic front door of a group turn. Plan edits, place searches and "what should we do Saturday" are
// understood in code and executed by the same checked functions the tools use, so they work the same whether or
// not the model behaves. The model still handles everything the router doesn't recognise.
//
// Three modes (see lib/mentions.ts):
//   EXPLICIT / REQUEST  "@Clockwise add dinner…", "find me dosa…"      -> act, and answer from what was PERSISTED
//   PASSIVE             "I'm vegetarian btw", "my flight is delayed"   -> notice quietly, never reply
//   HUMAN               "HAHAHA Arshia 😭", "@Ridhima thoughts?"        -> nothing
import { prisma } from "@/lib/prisma";
import { postActionCard } from "@/lib/action-cards";
import { runPlanCommand, buildPlanCtx, moveCommitmentChecked } from "@/lib/plan/apply";
import { parsePlanCommand } from "@/lib/plan/parse";
import { parsePlaceIntent, isPlaceSearch } from "@/lib/travel/place-intent";
import { searchForIntent, groupDietFor, type PlaceSearchOutcome } from "@/lib/travel/place-search";
import { buildIdea, maybeSurfaceIdea, tripDayWindow } from "@/lib/ideas";
import { observeMessage, loadPointers, pointerLine } from "@/lib/pointers/store";
import { parseOwnArrival } from "@/lib/traveller/arrival-parse";
import { parseTravellerStatus } from "@/lib/traveller/status-parse";
import { handleTravellerStatus } from "@/lib/traveller/status";
import { parseConditionalYes, parsePayDirective, parseSelfReportedPayment, parseFitQuestion } from "@/lib/reply-talk";
import { payDirectiveOutcome, selfReportedReply } from "./money-talk";
import { rupees } from "@/lib/private-tell";
import { attachCondition } from "@/lib/proposal-conditions";
import { parseTransientAvoid, recordMealMood } from "@/lib/pointers/mood";
import { handleArrivalChange, evaluateConsequences, answerClashFromChat } from "@/lib/disruption";
import { recomputeRendezvous } from "@/lib/rendezvous";
import { executeTool } from "./tools";
import { doesThisFit } from "@/lib/travel/fit";
import { anchorsFor } from "@/lib/travel/around";
import { hoursNote } from "@/lib/travel/hours";
import { matchCommitment } from "@/lib/plan/parse";
import { searchPlaceByText } from "@/lib/travel/geoapify-provider";
import { localNow } from "@/lib/when";
import { getOpenDecisions } from "@/lib/decisions";
import { timeLabel } from "@/lib/traveller/journey";
import type { AgentContext, ConversationTurn } from "./context";
import type { MessageMode } from "@/lib/mentions";

export type Routed = { handled: true; reply: string | null; calls: { name: string; input: unknown }[] } | { handled: false };

const first = (n: string) => n.split(/\s+/)[0] ?? n;

// ---- places ---------------------------------------------------------------------------------------------

export async function runPlaceRequest(ctx: AgentContext, text: string, channel: "GROUP" | "PRIVATE", me?: { lat: number; lng: number } | null): Promise<{ reply: string; outcome: PlaceSearchOutcome }> {
  const intent = parsePlaceIntent(text);
  const groupDiet = await groupDietFor(ctx.trip.id);
  const outcome = await searchForIntent({ tripId: ctx.trip.id, userId: ctx.actingUserId, intent, me: me ?? null, groupDiet });
  const parsed = { what: intent.what, category: intent.category, anchor: intent.anchor.kind, anchorText: intent.anchor.kind === "explicit" ? intent.anchor.text : null, diet: intent.diet, defaulted: intent.defaulted };

  await prisma.tripEvent
    .create({
      data: {
        tripId: ctx.trip.id,
        kind: "PLACES_SEARCH_COMPLETED",
        scope: channel === "PRIVATE" ? "PERSONAL" : "GROUP",
        actorUserId: ctx.actingUserId,
        subjectUserId: channel === "PRIVATE" ? ctx.actingUserId : null,
        sourceChannel: channel,
        confidence: "HIGH",
        payload: JSON.stringify(
          outcome.ok
            ? { tool: "find_places", request: text.slice(0, 160), parsed, anchor: { kind: outcome.anchor.kind, label: outcome.anchor.label, why: outcome.anchorWhy }, chain: outcome.chain, provider: outcome.provider, retrievedAt: outcome.retrievedAt, resultCount: outcome.places.length, keywordMatches: outcome.keywordMatches, diet: outcome.diet, dietWhy: outcome.dietWhy, providerPlaceIds: outcome.places.map((p) => p.providerPlaceId) }
            : { tool: "find_places", request: text.slice(0, 160), parsed, error: outcome.error, chain: outcome.chain ?? [] }
        ),
        propagation: JSON.stringify(["chat-card"]),
      },
    })
    .catch(() => undefined);

  if (!outcome.ok) return { reply: outcome.error, outcome };
  if (outcome.places.length === 0) {
    if (outcome.mealMood?.leftNothing) return { reply: `${outcome.context} I haven't listed them. Want a wider area, or should I include them anyway?`, outcome };
    return { reply: `${outcome.context} I haven't named anything, since nothing real came back. Try a wider area.`, outcome };
  }

  const top = outcome.places[0];
  const what = intent.what ?? outcome.category;
  const lead = outcome.keywordMatches >= 1 && intent.keyword ? `${outcome.keywordMatches} of these ${outcome.keywordMatches === 1 ? "matches" : "match"} ${what} on Geoapify's cuisine tags or names` : `Real places from Geoapify`;
  const why = top.why ? ` WHY THIS WORKS ✦ ${top.why}.` : "";
  const dietNote = outcome.dietWhy ? ` Ranked with ${outcome.dietWhy} in mind.` : "";
  const moodNote = outcome.mealMood ? ` Left out ${outcome.mealMood.avoid} places, since ${outcome.mealMood.by} wanted a break from them for this meal.` : "";
  return { reply: `Found ${outcome.places.length} around ${outcome.anchor.label}: ${lead}. Top pick is ${top.name}.${why}${dietNote}${moodNote} Full list is in the card.`, outcome };
}

// ---- ideas ----------------------------------------------------------------------------------------------

const IDEA_ASK = /\b(what should we do|what can we do|what shall we do|what do we do|any ideas|plan (?:something|a day|our)|suggest (?:something|a plan)|something to do|what('?s| is) the plan for)\b/i;

async function openQuestions(ctx: AgentContext): Promise<string> {
  const [decisions, suggestions, pointers] = await Promise.all([getOpenDecisions(ctx.trip.id, ctx.actingUserId), prisma.tripSuggestion.findMany({ where: { tripId: ctx.trip.id, status: "OPEN" } }), loadPointers(ctx.trip.id, ["ACTIVE"])]);
  const bits: string[] = [];
  if (decisions.length) bits.push(`${decisions.length} waiting for votes: ${decisions.slice(0, 3).map((d) => d.headline).join(", ")}`);
  if (suggestions.length) bits.push(`${suggestions.length} idea${suggestions.length === 1 ? "" : "s"} I haven't proposed yet: ${suggestions.slice(0, 2).map((s) => s.title).join("; ")}`);
  const loose = pointers.filter((p) => ["WANT", "MUST"].includes(p.kind)).slice(0, 3);
  if (loose.length) bits.push(`picked up but not planned: ${loose.map((p) => `${p.userName} ${p.label}`).join("; ")}`);
  return bits.length ? `Still open: ${bits.join(". ")}.` : "Nothing is waiting on a decision right now.";
}

// ---- feasibility of ONE named place ------------------------------------------------------------------------
// Used for "can we fit Cubbon Park before dinner?" AND for "Let's do Cubbon before dinner?". It only ever ANSWERS: it
// adds nothing to the Plan, and a yes to the question is a separate, explicit step.
async function runFitQuestion(ctx: AgentContext, placeName: string): Promise<Routed> {
  const a = await anchorsFor(ctx.trip.id, ctx.actingUserId);
  const origin = a.stay ?? a.destination;
  const found = origin ? await searchPlaceByText(placeName, origin.point).catch(() => []) : [];
  if (!origin || !found[0]) return { handled: true, reply: origin ? `I couldn't find "${placeName}" on the map, so I can't say whether it fits. I haven't guessed.` : "There's no stay or destination to measure from yet, so I can't say whether it fits.", calls: [{ name: "does_this_fit", input: { placeName, found: false } }] };
  const kind = /park|garden/i.test(placeName) ? "park" : "attraction";
  const r = await doesThisFit({ tripId: ctx.trip.id, userId: ctx.actingUserId, place: { name: found[0].name, lat: found[0].latitude, lng: found[0].longitude }, kind, origin: { label: origin.kind === "stay" ? "the hotel" : origin.label, point: origin.point } });
  if (!r.ok) return { handled: true, reply: r.error, calls: [{ name: "does_this_fit", input: { placeName, error: r.error } }] };
  await prisma.tripEvent.create({ data: { tripId: ctx.trip.id, kind: "FIT_CHECKED", scope: "GROUP", actorUserId: ctx.actingUserId, sourceChannel: "GROUP", confidence: "HIGH", payload: JSON.stringify({ place: r.place, verdict: r.verdict, routeProvider: r.routeProvider, reachChecked: r.reach.checked, reachInside: r.reach.inside, reachProvider: r.reach.provider, toMin: r.toMin, onMin: r.onMin, spareMin: r.spareMin, commitment: r.commitment?.name ?? null, whatIf: r.whatIf, evidenceIds: r.evidenceIds, tool: "does_this_fit" }), propagation: JSON.stringify(["chat"]) } }).catch(() => undefined);
  const t = (l: string) => timeLabel(l);
  const provider = r.routeProvider === "delhivery" ? "Delhivery" : "Geoapify";
  const reply = `${r.verdict === "YES" ? "Yes" : r.verdict === "TIGHT" ? "It's tight, but" : "No"}: ${r.place} ${r.verdict === "NO" ? "doesn't fit" : "fits"}${r.commitment ? ` before ${r.commitment.name} (${t(r.commitment.targetLocal)})` : ""}. ${r.toMin != null ? `${r.toMin} min there from ${r.originLabel}${r.onMin != null ? `, ${r.onMin} min back` : ""} (${provider}), about ${r.stayMin} min at the place. ` : ""}${r.verdict !== "NO" && r.leaveByLocal ? `Leave by ${t(r.leaveByLocal)}. ` : ""}${r.whatIf ? `That's a what-if for setting off at ${t(r.leaveLocal)}. ` : ""}${r.reason} ${hoursNote(found[0].openingHours, r.leaveLocal, r.toMin)}Nothing has been added to the Plan.`;
  return { handled: true, reply, calls: [{ name: "does_this_fit", input: { placeName } }] };
}

// ---- a conditional yes ------------------------------------------------------------------------------------------
// "I'm fine with 10, but only if we're back by 11." is kept on the proposal it answers and is not an approval (see
// proposal-conditions.ts).
async function conditionalReply(ctx: AgentContext, cond: { accepts: string; condition: string }, messageId: string | null): Promise<string | null> {
  return attachCondition({ tripId: ctx.trip.id, userId: ctx.actingUserId, accepts: cond.accepts, condition: cond.condition, messageId });
}

// ---- the router -------------------------------------------------------------------------------------------

export async function routeAddressed(ctx: AgentContext, last: ConversationTurn, mode: Exclude<MessageMode, "PASSIVE" | "HUMAN">): Promise<Routed> {
  const text = last.content;

  const plan = await runPlanCommand(ctx.trip.id, ctx.actingUserId, text, last.id);
  if (plan) {
    const c = plan.command;
    return { handled: true, reply: plan.result?.reply ?? null, calls: [{ name: `plan_${c.kind}`, input: c }] };
  }

  // "I'm still at baggage claim", "I'll join you directly at dinner", "8:15 is take-off, not landing", "kal subah aaungi".
  const clockStatus = parseTravellerStatus(text, localNow());
  if (clockStatus) {
    const r = await handleTravellerStatus({ tripId: ctx.trip.id, userId: ctx.actingUserId, messageId: last.id, status: clockStatus });
    return { handled: true, reply: r.reply, calls: r.calls };
  }

  if (/\bwhat('?s| is| are)\b.*\b(still )?(undecided|left to decide|open|pending|waiting)\b/i.test(text)) {
    return { handled: true, reply: await openQuestions(ctx), calls: [{ name: "open_questions", input: {} }] };
  }

  // "can we fit Cubbon Park before dinner?" is a feasibility question about ONE named place, not a search.
  const fitAsk = /\b(?:can|could|will|would|do|should)\s+(?:we|i)\s+(?:actually\s+|really\s+)?(?:fit|squeeze(?:\s+in)?|do|visit|see|make|manage|get to|go to|add)\s+(.+?)\s+(?:before|ahead of|prior to|between)\b/i.exec(text);
  if (fitAsk) return runFitQuestion(ctx, fitAsk[1].replace(/\s+in$/i, "").replace(/^(the|a)\s+/i, "").trim());

  // Words that look like instructions but are not: a conditional yes, a payment directive, "I already paid her".
  const names = ctx.trip.members.map((m) => first(m.user.name));
  const cond = parseConditionalYes(text);
  if (cond) return { handled: true, reply: await conditionalReply(ctx, cond, last.id), calls: [{ name: "conditional_approval_noted", input: { counted: false } }] };
  const pay = parsePayDirective(text, names);
  if (pay) {
    const out = await payDirectiveOutcome(ctx.trip.id, ctx.actingUserId, pay);
    if (out.settlement) {
      const s = out.settlement;
      await postActionCard({
        tripId: ctx.trip.id,
        channel: "GROUP",
        type: "DECISION",
        status: "PENDING",
        data: {
          title: "PAYMENT TO CONFIRM ✦",
          context: `${s.fromName} owes ${s.toName} ${s.currency === "INR" ? rupees(s.amountMinor) : `${s.currency} ${(s.amountMinor / 100).toFixed(2)}`} on confirmed expenses${s.basis.length ? ` (${s.basis.join(", ")})` : ""}. Tap only after you've actually paid ${s.toName} outside Clockwise: it records the settlement and tells ${s.toName}. It moves no money and adds no expense.`,
          values: [{ label: "From", value: s.fromName }, { label: "To", value: s.toName }, { label: "Amount", value: s.currency === "INR" ? rupees(s.amountMinor) : `${s.currency} ${(s.amountMinor / 100).toFixed(2)}` }],
          settlement: { fromId: s.fromId, toId: s.toId, fromName: s.fromName, toName: s.toName, amountMinor: s.amountMinor, currency: s.currency },
        },
      });
    }
    return { handled: true, reply: out.reply, calls: [{ name: "payment_directive_checked", input: { created: false, confirmationCard: Boolean(out.settlement) } }] };
  }
  const self = parseSelfReportedPayment(text, names);
  if (self) return { handled: true, reply: await selfReportedReply(ctx.trip.id, ctx.actingUserId, self, last.id), calls: [{ name: "settlement_reported", input: { confirmed: false } }] };
  const fitQ = parseFitQuestion(text);
  if (fitQ) {
    const plan = await buildPlanCtx(ctx.trip.id, ctx.actingUserId);
    if (matchCommitment(fitQ.anchor, plan.commitments).hit) return runFitQuestion(ctx, fitQ.place);
  }

  if (isPlaceSearch(text)) {
    const r = await runPlaceRequest(ctx, text, "GROUP");
    return { handled: true, reply: r.reply, calls: [{ name: "find_places", input: { request: text.slice(0, 160) } }] };
  }

  if (IDEA_ASK.test(text)) {
    const out = await buildIdea({ tripId: ctx.trip.id, userId: ctx.actingUserId, when: text, intro: null });
    if (out.ok) {
      return { handled: true, reply: `CLOCKWISE HAS AN IDEA ✦ ${out.card.title}. ${out.card.why} Want me to propose it to the group? The card has the buttons; nothing changes in the Plan unless everyone's in.`, calls: [{ name: "build_idea", input: { when: text.slice(0, 120) } }] };
    }
    return { handled: true, reply: out.reason, calls: [{ name: "build_idea", input: { when: text.slice(0, 120), refused: out.reason } }] };
  }
  void mode;
  return { handled: false };
}

const MODEL_MARKERS = /\b(let'?s|lets|we should|we'?ll|we will|actually|going to|back by|leave by|can'?t (?:do|make|before|come)|have to leave|have to go|need to leave|paid|spent|bought|rs\.?|₹|rupees|\d+\s?k\b|instead|actually let'?s|switch|change (?:it|the|our)|route|itinerary|destination|dates?|flight|train|bus|delay|late|land|arriv|reach)\b/i;

// Quiet observation of a human message nobody addressed to Clockwise. Never produces a reply. Returns whether the
// model should still look at it (journey/limit/money statements that need a tool).
export async function observePassive(ctx: AgentContext, last: ConversationTurn, opts: { mentionedAll?: boolean } = {}): Promise<{ calls: { name: string; input: unknown }[]; needsModel: boolean; reply?: string }> {
  const calls: { name: string; input: unknown }[] = [];
  const text = last.content;

  // 1. pointers + soft agreement (DB only, no model)
  const seen = await observeMessage({ tripId: ctx.trip.id, userId: ctx.actingUserId, messageId: last.id, text });
  for (const c of seen.captured) calls.push({ name: "note_trip_pointer", input: { kind: c.kind, subject: c.subject, label: c.label, mentions: c.mentions } });
  for (const s of seen.supported) calls.push({ name: "support_trip_pointer", input: { subject: s } });

  // 1b. a mood about the NEXT meal ("anything except another dosa place"): understood, expires, never stored as a
  // preference, and the model never sees it (so it cannot turn it into one).
  const mood = parseTransientAvoid(text);
  if (mood && seen.captured.length === 0) {
    await recordMealMood(ctx.trip.id, ctx.actingUserId, last.id, mood, localNow());
    calls.push({ name: "note_meal_mood", input: { avoid: mood, scope: "this meal" } });
    return { calls, needsModel: false };
  }

  // 2. A clash question is waiting and this is the answer ("Yeah", "inform them", "cancel it", "leave it").
  const answered = await answerClashFromChat(ctx.trip.id, ctx.actingUserId, text, last.id);
  if (answered) {
    calls.push({ name: "answer_clash", input: { text: text.slice(0, 60) } });
    return { calls, needsModel: false, reply: answered.reply };
  }

  // 2a. Clockwise asked "where are you heading after the airport?" and this short message is the answer.
  let reply: string | undefined;
  const asked = await prisma.tripEvent.findFirst({ where: { tripId: ctx.trip.id, kind: "ANCHOR_QUESTION_ASKED", subjectUserId: ctx.actingUserId, createdAt: { gt: new Date(Date.now() - 2 * 3600_000) } }, orderBy: { createdAt: "desc" } });
  // Only the FIRST message after the question can be its answer, and only a short bare place name (no digits, no
  // question, nothing that reads as an arrival update).
  let isAnswer = false;
  if (asked) {
    const between = await prisma.message.count({ where: { tripId: ctx.trip.id, channel: "GROUP", senderId: ctx.actingUserId, timestamp: { gt: asked.createdAt }, id: { not: last.id } } });
    isAnswer = between === 0 && text.trim().split(/\s+/).length <= 5 && /^[\p{L}][\p{L}\s.'’,-]{2,}$/u.test(text.trim().replace(/[.!]+$/, "")) && !parseOwnArrival(text, localNow(), {});
  }
  if (asked && isAnswer && !seen.captured.some((c) => c.kind === "MEET")) {
    const subject = text.replace(/^(i'?m |im |i am )?(heading|going|headed)( to)?\s+/i, "").replace(/^(the|at)\s+/i, "").replace(/[.!]+$/, "").trim();
    if (subject) {
      const { recordPointer } = await import("@/lib/pointers/store");
      await recordPointer({ tripId: ctx.trip.id, userId: ctx.actingUserId, messageId: last.id, kind: "MEET", subject, label: `is heading to ${subject}` });
      seen.captured.push({ id: "", kind: "MEET", subject, label: "", mentions: 1, isNew: true });
    }
  }
  // A named gathering place changes where everyone needs to get to: re-measure and re-check for whoever was asked.
  if (seen.captured.some((c) => c.kind === "MEET")) {
    await recomputeRendezvous(ctx.trip.id).catch(() => undefined);
    const askedAll = await prisma.tripEvent.findMany({ where: { tripId: ctx.trip.id, kind: "ANCHOR_QUESTION_ASKED", createdAt: { gt: new Date(Date.now() - 2 * 3600_000) } }, select: { subjectUserId: true } });
    for (const uid of new Set(askedAll.map((e) => e.subjectUserId).filter((x): x is string => Boolean(x)))) {
      const r = await evaluateConsequences({ tripId: ctx.trip.id, userId: uid, sourceMessageId: last.id });
      calls.push({ name: "evaluate_consequences", input: { traveller: uid, clashes: r.clashIds.length } });
      if (r.reply && !reply) reply = r.reply;
    }
  }

  // 2a'. small clock statements ("still at baggage claim", "join you directly at dinner", "8:15 is take-off", tentative or
  // historical delays, Hinglish days). Matched narrowly; anything else follows the existing path untouched.
  let handledStatus = false;
  const clockStatus = parseTravellerStatus(text, localNow());
  if (clockStatus) {
    const sr = await handleTravellerStatus({ tripId: ctx.trip.id, userId: ctx.actingUserId, messageId: last.id, status: clockStatus }).catch((err) => {
      console.error("[status] failed:", err instanceof Error ? err.message : err);
      return null;
    });
    if (sr) {
      calls.push(...sr.calls);
      handledStatus = true;
      if (sr.reply && !reply) reply = sr.reply;
    }
  }

  // 2a''. words that look like instructions but are not (see reply-talk.ts): never reach the model, never change state.
  if (!handledStatus) {
    const names = ctx.trip.members.map((m) => first(m.user.name));
    const cond = parseConditionalYes(text);
    if (cond) {
      const cr = await conditionalReply(ctx, cond, last.id);
      calls.push({ name: "conditional_approval_noted", input: { counted: false } });
      return { calls, needsModel: false, reply: cr ?? undefined };
    }
    if (parseSelfReportedPayment(text, names)) {
      await selfReportedReply(ctx.trip.id, ctx.actingUserId, parseSelfReportedPayment(text, names)!, last.id);
      calls.push({ name: "settlement_reported", input: { confirmed: false } });
      return { calls, needsModel: false };
    }
    if (parsePayDirective(text, names)) {
      calls.push({ name: "payment_directive_seen", input: { created: false } });
      return { calls, needsModel: false };
    }
    const fitQ = parseFitQuestion(text);
    if (fitQ) {
      const plan = await buildPlanCtx(ctx.trip.id, ctx.actingUserId);
      if (matchCommitment(fitQ.anchor, plan.commitments).hit) {
        const fr = await runFitQuestion(ctx, fitQ.place).catch(() => null);
        if (fr?.handled) return { calls: [...calls, ...fr.calls], needsModel: false, reply: fr.reply ?? undefined };
      }
    }
  }

  // 2b. the speaker's OWN arrival changed -> the whole consequence chain (journey, anchor, provider route, ready time, clashes)
  let handledArrival = handledStatus;
  const window = await tripDayWindow(ctx.trip.id);
  const arrival = handledStatus ? null : parseOwnArrival(text, localNow(), window);
  if (arrival && arrival.kind !== "ambiguous") {
    const r = await handleArrivalChange({
      tripId: ctx.trip.id,
      userId: ctx.actingUserId,
      sourceMessageId: last.id,
      ...(arrival.kind === "time" ? { arrivalTime: arrival.arrivalTime, arrivalDate: arrival.arrivalDate } : arrival.kind === "ready" ? { readyTime: arrival.readyTime, readyDate: arrival.readyDate } : { place: arrival.place, arrivalTime: arrival.arrivalTime }),
    });
    calls.push({ name: "handle_arrival_change", input: { kind: arrival.kind, clashes: r.clashIds.length, resolved: r.resolved.length } });
    handledArrival = true;
    if (r.reply) reply = r.reply;
  }

  // 2b. "@all dinner moved to 9?" / "let's do dinner at 9 instead": a concrete change to something already in the
  // Plan, said to the group. It becomes a PROPOSAL (never a direct edit) so the people it affects can answer.
  if (!handledArrival && (opts.mentionedAll || /\binstead\b|^\s*(@\w+\s+)*let'?s\s+(do|move|make|have)\b/i.test(text))) {
    const plan = await buildPlanCtx(ctx.trip.id, ctx.actingUserId);
    const cmd = parsePlanCommand(text, plan);
    if (cmd?.kind === "move") {
      const r = await moveCommitmentChecked({ tripId: ctx.trip.id, actorId: ctx.actingUserId, commitmentId: cmd.commitmentId, local: `${cmd.date}T${cmd.time}`, sourceMessageId: last.id, forceProposal: true });
      calls.push({ name: "propose_move", input: { commitment: cmd.commitmentName, to: `${cmd.date}T${cmd.time}`, outcome: r.ok ? r.verb : "failed" } });
      handledArrival = true;
    }
  }

  // 3. connected idea? (several people leaning the same way + a real free window)
  if (seen.captured.length || seen.supported.length) {
    const idea = await maybeSurfaceIdea(ctx.trip.id, ctx.actingUserId).catch((err) => {
      console.error("[ideas] passive surfacing failed:", err instanceof Error ? err.message : err);
      return null;
    });
    if (idea?.ok) calls.push({ name: "build_idea", input: { passive: true, title: idea.card.title } });
  }

  const onlyPointers = seen.captured.length > 0 && !MODEL_MARKERS.test(text);
  // A short remark with nothing in it that states trip state ("HAHAHA Arshia 😭") never reaches the model.
  const banter = text.length < 24 && !MODEL_MARKERS.test(text);
  return { calls, needsModel: !handledArrival && !onlyPointers && !banter && !reply, reply };
}

export { pointerLine, first };
