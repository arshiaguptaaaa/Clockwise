// Agent behaviour that must not drift: plan commands, @mentions, passive pointers, place-search intent.
// Pure; no network, no DB. (Persistence and multi-user sync are proved against production, not here.)
import assert from "node:assert/strict";
import { localNow, parseDay, parseTime, humanMoment } from "../../src/lib/when";
import { parsePlanCommand, type PlanCtx } from "../../src/lib/plan/parse";
import { parseMentions, mentionOptions, classifyMessage, isAgentRequest, splitMentions } from "../../src/lib/mentions";
import { extractPointers, isAgreement } from "../../src/lib/pointers/extract";
import { parsePlaceIntent, isPlaceSearch } from "../../src/lib/travel/place-intent";

let n = 0;
const ok = (name: string, fn: () => void) => {
  fn();
  n++;
  console.log(`PASS ${name}`);
};

// Sunday 4 Oct 2026, 15:00 IST.
const NOW = localNow(new Date("2026-10-04T09:30:00Z"));
const people = [
  { userId: "u-arshia", name: "Arshia Gupta" },
  { userId: "u-ridhima", name: "Ridhima Kapoor" },
  { userId: "u-harnoor", name: "Harnoor Singh" },
];
const ctx = (commitments: PlanCtx["commitments"] = [], window: PlanCtx["window"] = { start: "2026-10-05", end: "2026-10-11" }): PlanCtx => ({ now: NOW, window, speakerId: "u-arshia", members: people, commitments, defaultLocation: "Bengaluru" });
const dinner = { id: "c1", name: "Birthday dinner", target: "2026-10-05T20:00", participantIds: [] as string[] };

ok("local now is read in IST", () => {
  assert.equal(NOW.date, "2026-10-04");
  assert.equal(NOW.time, "15:00");
  assert.equal(NOW.weekday, 0);
});
ok("tomorrow and weekdays resolve to exact dates", () => {
  assert.equal(parseDay("birthday dinner tomorrow at 8", NOW)?.date, "2026-10-05");
  assert.equal(parseDay("Cubbon Park Saturday at 4", NOW, { start: "2026-10-05" })?.date, "2026-10-10");
  assert.equal(parseDay("on 12 Dec", NOW)?.date, "2026-12-12");
  assert.equal(parseDay("hello", NOW), null);
});
ok("a weekday before the trip starts means the trip's weekday", () => {
  assert.equal(parseDay("saturday", NOW, { start: "2026-12-12" })?.date, "2026-12-12");
});
ok("times take the meaning of the activity", () => {
  assert.equal(parseTime("at 8 PM")?.time, "20:00");
  assert.equal(parseTime("dinner at 8", "dinner")?.time, "20:00");
  assert.equal(parseTime("breakfast at 8", "breakfast")?.time, "08:00");
  assert.equal(parseTime("coffee at 5", "coffee")?.time, "17:00");
  assert.equal(parseTime("at 4", "Cubbon Park")?.time, "16:00");
  assert.equal(parseTime("20:30")?.time, "20:30");
  assert.equal(parseTime("hello"), null);
  assert.equal(humanMoment("2026-10-05T20:00"), "Mon 5 Oct, 8:00 PM");
});

ok("'@Clockwise add birthday dinner tomorrow at 8 PM' creates dinner for everyone", () => {
  const c = parsePlanCommand("@Clockwise add birthday dinner tomorrow at 8 PM.", ctx());
  assert.equal(c?.kind, "create");
  if (c?.kind !== "create") return;
  assert.equal(c.name, "Birthday dinner");
  assert.equal(c.date, "2026-10-05");
  assert.equal(c.time, "20:00");
  assert.equal(c.participantIds, null);
});
ok("'Clockwise add Cubbon Park Saturday at 4' lands on the trip's Saturday at 16:00", () => {
  const c = parsePlanCommand("Clockwise add Cubbon Park Saturday at 4", ctx());
  assert.equal(c?.kind, "create");
  if (c?.kind !== "create") return;
  assert.equal(c.name, "Cubbon Park");
  assert.equal(c.date, "2026-10-10");
  assert.equal(c.time, "16:00");
});
ok("'Let's do dinner at 9 instead' moves the matching commitment", () => {
  const c = parsePlanCommand("@Clockwise let's do dinner at 9 instead.", ctx([dinner]));
  assert.equal(c?.kind, "move");
  if (c?.kind !== "move") return;
  assert.equal(c.commitmentId, "c1");
  assert.equal(c.date, "2026-10-05");
  assert.equal(c.time, "21:00");
});
ok("'Move birthday dinner to 10' reads 10 as 10 PM", () => {
  const c = parsePlanCommand("@Clockwise move birthday dinner to 10", ctx([dinner]));
  assert.equal(c?.kind, "move");
  if (c?.kind !== "move") return;
  assert.equal(c.time, "22:00");
});
ok("'Cancel tomorrow's breakfast' finds that breakfast", () => {
  const b = { id: "c2", name: "Breakfast", target: "2026-10-05T08:30", participantIds: [] };
  const c = parsePlanCommand("@Clockwise cancel tomorrow's breakfast", ctx([dinner, b]));
  assert.equal(c?.kind, "cancel");
  if (c?.kind !== "cancel") return;
  assert.equal(c.commitmentId, "c2");
});
ok("'Ridhima and I are doing coffee at 5' is a two-person plan item", () => {
  const c = parsePlanCommand("Clockwise, Ridhima and I are doing coffee at 5", ctx());
  assert.equal(c?.kind, "create");
  if (c?.kind !== "create") return;
  assert.equal(c.name, "Coffee");
  assert.equal(c.time, "17:00");
  assert.deepEqual(c.participantIds?.sort(), ["u-arshia", "u-ridhima"]);
});
ok("things that aren't plan commands are left to the model", () => {
  for (const t of ["add some fun to the trip", "move the car", "book flights to Delhi", "cancel my subscription", "find dosa places in Bengaluru", "lol"]) assert.equal(parsePlanCommand(t, ctx([dinner])), null, t);
});
ok("an ambiguous target asks instead of guessing", () => {
  const d2 = { id: "c3", name: "Farewell dinner", target: "2026-10-09T20:00", participantIds: [] };
  const c = parsePlanCommand("move dinner to 10", ctx([dinner, d2]));
  assert.equal(c?.kind, "ambiguous");
});

ok("@ menu offers Clockwise, all and every member, and fuzzy matches", () => {
  const all = mentionOptions("", people, "u-arshia").map((o) => o.label);
  assert.deepEqual(all, ["Clockwise", "all", "Ridhima", "Harnoor"]);
  assert.deepEqual(mentionOptions("rid", people, "u-arshia").map((o) => o.label), ["Ridhima"]);
  assert.equal(mentionOptions("clk", people)[0]?.label, "Clockwise");
});
ok("mentions combine and do not decide behaviour by themselves", () => {
  const m = parseMentions("@Ridhima @Clockwise can we fit Cubbon Park before dinner?", people);
  assert.equal(m.clockwise, true);
  assert.deepEqual(m.userIds, ["u-ridhima"]);
  assert.equal(parseMentions("@all dinner moved to 9?", people).all, true);
  assert.equal(classifyMessage("@Ridhima what do you think?", people).mode, "PASSIVE");
  assert.equal(classifyMessage("@Clockwise find dosa near our hotel", people).mode, "EXPLICIT");
  assert.equal(classifyMessage("HAHAHA Arshia 😭", people).mode, "PASSIVE");
});
ok("a request that never says Clockwise is still recognised, banter is not", () => {
  assert.equal(isAgentRequest("Find me good dosa places in Bengaluru."), true);
  assert.equal(isAgentRequest("show us coffee near the hotel"), true);
  assert.equal(isAgentRequest("where should we eat tonight"), true);
  assert.equal(isAgentRequest("find me a boyfriend lol"), true); // narrow, not perfect: the model then declines it
  assert.equal(isAgentRequest("Now show coffee around our stay"), true);
  assert.equal(isAgentRequest("ok so find dosa near Indiranagar"), true);
  assert.equal(isAgentRequest("HAHAHA Arshia 😭"), false);
  assert.equal(isAgentRequest("I'm vegetarian btw"), false);
  assert.equal(isAgentRequest("did you find the charger"), false);
});
ok("mentions are split for highlighting", () => {
  const parts = splitMentions("@Ridhima @Clockwise hi @nobody", people);
  assert.deepEqual(parts.filter((p) => p.mention).map((p) => p.text), ["@Ridhima", "@Clockwise"]);
});

ok("passive pointers: diet, wants, likes, must-haves, windows", () => {
  const d = extractPointers("I'm vegetarian btw.");
  assert.deepEqual(d.map((p) => [p.kind, p.subject]), [["DIET", "vegetarian"]]);
  assert.deepEqual(extractPointers("I really want to have dosa when we're in Bangalore.").map((p) => [p.kind, p.subject]), [["WANT", "dosa"]]);
  assert.deepEqual(extractPointers("Bangalore finally 😭 I need proper dosa at some point.").map((p) => [p.kind, p.subject]), [["WANT", "dosa"]]);
  assert.deepEqual(extractPointers("Cubbon Park is non-negotiable.").map((p) => [p.kind, p.subject]), [["MUST", "cubbon park"]]);
  assert.deepEqual(extractPointers("Cubbon Park also pls").map((p) => [p.kind, p.subject]), [["WANT", "cubbon park"]]);
  assert.deepEqual(extractPointers("Cubbon Park?").map((p) => [p.kind, p.subject]), [["WANT", "cubbon park"]]);
  assert.deepEqual(extractPointers("I love South Indian food").map((p) => [p.kind, p.subject]), [["LIKE", "south indian food"]]);
  const both = extractPointers("I'm vegetarian btw and I really like cute coffee places.");
  assert.deepEqual(both.map((p) => p.kind).sort(), ["DIET", "LIKE"]);
  assert.deepEqual(extractPointers("Saturday evening let's keep free").map((p) => [p.kind, p.subject]), [["WINDOW", "saturday evening"]]);
});
ok("banter and passing moods capture nothing", () => {
  for (const t of ["HAHAHA Arshia 😭", "lol", "I love coffee right now", "ok", "who's bringing the speaker?", "Guys my flight is delayed, I'll reach at 9:15", "Cubbon Park looks cute"]) assert.deepEqual(extractPointers(t), [], t);
});
ok("agreement is recognised but never becomes a pointer of its own", () => {
  for (const t of ["YES", "same", "Yesss!", "me too", "100%", "count me in"]) assert.equal(isAgreement(t), true, t);
  for (const t of ["yes the flight lands at 9", "no", "lol"]) assert.equal(isAgreement(t), false, t);
  assert.deepEqual(extractPointers("YES"), []);
});

const intent = (s: string) => parsePlaceIntent(s);
ok("place intent: explicit city beats everything (dosa in Bengaluru / Bangalore)", () => {
  for (const q of ["Find me good dosa places in Bengaluru.", "dosa places in Bangalore", "@Clockwise show us good dosa places in Bengaluru"]) {
    const i = intent(q);
    assert.equal(i.what, "dosa", q);
    assert.equal(i.category, "restaurant", q);
    assert.equal(i.anchor.kind, "explicit", q);
    assert.match((i.anchor as { text: string }).text, /^beng?alu?ru$|^bangalore$/i, q);
    assert.equal(isPlaceSearch(q), true, q);
  }
});
ok("place intent: stay, arrival, me, destination, neighbourhood", () => {
  assert.equal(intent("coffee near our hotel").anchor.kind, "stay");
  assert.equal(intent("Now show coffee around our stay").anchor.kind, "stay");
  assert.equal(intent("coffee around our hotel").category, "cafe");
  const air = intent("food near Bengaluru airport").anchor;
  assert.equal(air.kind, "arrival");
  assert.equal(intent("shopping near where Ridhima lands").anchor.kind, "arrival");
  assert.equal((intent("shopping near where Ridhima lands").anchor as { person: string | null }).person, "Ridhima");
  assert.equal(intent("cafes near me").anchor.kind, "me");
  assert.equal(intent("what's near me?").anchor.kind, "me");
  assert.equal(intent("what's near our destination?").anchor.kind, "destination");
  const v = intent("vegetarian dosa in Indiranagar");
  assert.equal(v.diet, "vegetarian");
  assert.equal(v.what, "dosa");
  assert.equal((v.anchor as { text: string }).text, "Indiranagar");
  const t = intent("things to do around Cubbon Park");
  assert.equal(t.category, "attraction");
  assert.equal((t.anchor as { text: string }).text, "Cubbon Park");
  assert.equal(intent("restaurants in Indiranagar").anchor.kind, "explicit");
});
ok("place intent: a statement is not a search", () => {
  assert.equal(isPlaceSearch("I love coffee"), false);
  assert.equal(isPlaceSearch("I need proper dosa at some point"), false);
  assert.equal(isPlaceSearch("lol"), false);
});

import { parseOwnArrival } from "../../src/lib/traveller/arrival-parse";
ok("own arrival is read from a casual delay message", () => {
  const a = parseOwnArrival("Guys, my flight's delayed. I'll reach around 9:15 tonight.", NOW);
  assert.deepEqual(a, { kind: "time", arrivalTime: "21:15" });
  assert.deepEqual(parseOwnArrival("landing at 8:15 pm instead", NOW), { kind: "time", arrivalTime: "20:15" });
  assert.deepEqual(parseOwnArrival("my train gets in at 22:10 tomorrow", NOW), { kind: "time", arrivalTime: "22:10", arrivalDate: "2026-10-05" });
  assert.deepEqual(parseOwnArrival("I'll reach at 9", NOW), { kind: "ambiguous" });
  assert.equal(parseOwnArrival("Ridhima will reach at 9 pm", NOW), null);
  assert.equal(parseOwnArrival("lol my flight is so boring", NOW), null);
  assert.equal(parseOwnArrival("I'm vegetarian btw", NOW), null);
});

import { classifyClashAnswer } from "../../src/lib/disruption";
ok("a reply to a clash question is understood without @Clockwise", () => {
  for (const t of ["Yeah.", "yes", "yeah please", "do it", "propose it", "sure"]) assert.equal(classifyClashAnswer(t), "AGREE", t);
  assert.equal(classifyClashAnswer("inform them"), "INFORM");
  assert.equal(classifyClashAnswer("cancel it"), "CANCEL");
  assert.equal(classifyClashAnswer("move it later"), "LATER");
  assert.equal(classifyClashAnswer("leave it"), "LEAVE");
  assert.equal(classifyClashAnswer("no"), "LEAVE");
  assert.equal(classifyClashAnswer("lol who's bringing the speaker"), null);
  // a yes is the WHOLE reply: a sentence that merely starts with one is someone saying something else
  assert.equal(classifyClashAnswer("Go ahead, I'll join you directly at dinner."), null);
  assert.equal(classifyClashAnswer("yes but only if we're back by 11"), null);
  assert.equal(classifyClashAnswer("sure, I'm out of the cab now"), null);
});
ok("arrival statements: later, earlier, hotel time, different airport", () => {
  assert.deepEqual(parseOwnArrival("Guys, my flight got delayed. I'll land around 9 PM.", NOW), { kind: "time", arrivalTime: "21:00" });
  assert.deepEqual(parseOwnArrival("flight delayed by a bit, now landing at 7:30 pm", NOW), { kind: "time", arrivalTime: "19:30" });
  assert.deepEqual(parseOwnArrival("I'll reach the hotel around 10 tonight", NOW), { kind: "ready", readyTime: "22:00" });
  const p = parseOwnArrival("Change of plan, I'm landing at Hyderabad airport now", NOW);
  assert.equal(p?.kind, "place");
  assert.deepEqual(extractPointers("Meet us at Church Street").map((x) => [x.kind, x.subject]), [["MEET", "church street"]]);
});
console.log(`\n${n} agent-behaviour checks passed`);

ok("'Update: now landing at 9:30 PM' is an arrival update, not a place answer", () => {
  assert.deepEqual(parseOwnArrival("Update: now landing at 9:30 PM", NOW), { kind: "time", arrivalTime: "21:30" });
  assert.equal(parseOwnArrival("Church Street", NOW), null);
});
console.log(`\n${n} agent-behaviour checks passed`);

ok("'dinner moved to 9?' (passive voice, said to the group) is read as a move", () => {
  const c = parsePlanCommand("@all dinner moved to 9?", ctx([dinner]));
  assert.equal(c?.kind, "move");
  if (c?.kind === "move") assert.equal(c.time, "21:00");
});
console.log(`\n${n} agent-behaviour checks passed`);

import { parsePrivateTell, noteHeadline, thirdPerson, amountIn } from "../../src/lib/private-tell";
const crew = [
  { id: "u-arshia", name: "Arshia Gupta" },
  { id: "u-ridhima", name: "Ridhima Sharma" },
  { id: "u-shreya", name: "Shreya Rao" },
  { id: "u-eva", name: "Eva Kaur" },
];
const tell = (s: string, me = "u-arshia") => parsePrivateTell(s, crew, me);
ok("private tell: TELL vs KNOW vs REMEMBER vs 'don't tell'", () => {
  const t = tell("Tell Ridhima I want vegetarian food for dinner.");
  assert.equal(t.type, "TELL");
  if (t.type === "TELL") {
    assert.deepEqual(t.recipientIds, ["u-ridhima"]);
    assert.equal(t.needsConfirm, false);
    assert.equal(noteHeadline("Arshia Gupta", t.message, t.lead, t.kind, t.amountMinor, t.subject), "Arshia wants vegetarian food for dinner.");
  }
  for (const s of ["Can you let Ridhima know I'll meet her downstairs at 7?", "Clockwise, tell @Ridhima I'll meet her downstairs at 7", "please tell ridhima I'd really like vegetarian dinner tonight"]) assert.equal(tell(s).type, "TELL", s);
  // for Clockwise only: nothing is passed on
  for (const s of ["Clockwise, just so you know, I want vegetarian food.", "Remember that I want vegetarian food", "Just remember that I like vegetarian food."]) assert.deepEqual(tell(s), { type: "KEEP", secret: false, remember: true }, s);
  assert.deepEqual(tell("Don't tell anyone, but remember that I want vegetarian food."), { type: "KEEP", secret: true, remember: true });
  assert.deepEqual(tell("Remember I want to surprise Ridhima for her birthday, don't tell her"), { type: "KEEP", secret: true, remember: true });
  // a bare "don't tell X ..." withholds and stores NOTHING, and never becomes a delivery just because it has a name and an amount
  assert.deepEqual(tell("Don't tell Ridhima she owes me ₹2,000."), { type: "KEEP", secret: true, remember: false });
  // talking to Clockwise is not a hand-off
  for (const s of ["Tell me what's near our hotel", "Remind me to call mom at 6", "what should I tell Ridhima?", "Show me coffee near the stay", "Ridhima told me she's vegetarian"]) assert.equal(tell(s).type, "NONE", s);
});
ok("private tell: a reminder keeps its meaning and the sender is always named", () => {
  const t = tell("Remind Ridhima that she has my charger", "u-arshia");
  assert.equal(t.type, "TELL");
  if (t.type === "TELL") {
    assert.equal(t.lead, "reminds");
    // 'she' / 'my' cannot be mapped safely, so the sender's own words are quoted, never rewritten
    assert.equal(noteHeadline("Arshia Gupta", t.message, t.lead, t.kind, t.amountMinor, t.subject), "Arshia is reminding you: “she has my charger”");
  }
  assert.equal(thirdPerson("Arshia Gupta", "I'll be downstairs at 7"), "Arshia will be downstairs at 7.");
  assert.equal(thirdPerson("Arshia Gupta", "dinner is at 8"), null);
});
ok("private tell: money is the sender's claim, never a fact, never a Pine payment", () => {
  const t = tell("Tell Ridhima she owes me ₹2,000 for the hotel.");
  assert.equal(t.type, "TELL");
  if (t.type === "TELL") {
    assert.equal(t.kind, "MONEY_TO_SENDER");
    assert.equal(t.amountMinor, 200000);
    const line = noteHeadline("Arshia Gupta", t.message, t.lead, t.kind, t.amountMinor, t.subject);
    assert.equal(line, "Arshia says your share of the hotel is ₹2,000.");
    assert.ok(!/you owe/i.test(line));
  }
  const p = tell("Tell @Ridhima I'll pay her ₹2,000 tonight");
  if (p.type === "TELL") { assert.equal(p.kind, "MONEY_PLEDGE"); assert.equal(noteHeadline("Arshia Gupta", p.message, p.lead, p.kind, p.amountMinor, p.subject), "Arshia says they'll pay you ₹2,000 tonight."); } else assert.fail("pledge");
  assert.equal(amountIn("2k for cab"), null);
  assert.equal(amountIn("Rs 1,500 for cab"), 150000);
  assert.equal(amountIn("it was 2000 rupees"), 200000);
});
ok("private tell: group scopes are confirmed, names are never guessed", () => {
  const all = tell("Tell @all I'll be downstairs at 7");
  assert.equal(all.type, "TELL");
  if (all.type === "TELL") { assert.equal(all.scope, "ALL"); assert.deepEqual(all.recipientIds.sort(), ["u-eva", "u-ridhima", "u-shreya"]); assert.equal(all.needsConfirm, true); }
  const ex = tell("Let everyone except Ridhima know we're getting her a cake");
  assert.equal(ex.type, "TELL");
  if (ex.type === "TELL") { assert.equal(ex.scope, "EXCEPT"); assert.ok(!ex.recipientIds.includes("u-ridhima")); assert.deepEqual(ex.excludedIds, ["u-ridhima"]); assert.equal(ex.needsConfirm, true); }
  assert.deepEqual(tell("Tell Priya I'm running late"), { type: "PROBLEM", reason: "UNKNOWN_NAME", names: ["Priya"] });
  assert.equal(tell("Tell Arshia I'm running late").type, "PROBLEM");
  const sat = tell("Tell Ridhima Saturday is free");
  assert.equal(sat.type, "TELL");
  assert.equal(tell("yes").type, "CONFIRM");
  assert.equal(tell("cancel").type, "CANCEL");
  const two = tell("Tell Ridhima and Shreya we leave at 6");
  if (two.type === "TELL") assert.deepEqual(two.recipientIds, ["u-ridhima", "u-shreya"]); else assert.fail("two");
});
console.log(`\n${n} agent-behaviour checks passed`);

// ---- hardening pass: subtle conversations -------------------------------------------------------------------
import { parseTravellerStatus } from "../../src/lib/traveller/status-parse";
import { parseConditionalYes, parsePayDirective, parseSelfReportedPayment, parseFitQuestion } from "../../src/lib/reply-talk";
import { pickTarget, namedPhrase } from "../../src/lib/reply-target";
import { parseTransientAvoid, mealSlot, moodApplies } from "../../src/lib/pointers/mood";
import { validateModelPointer } from "../../src/lib/pointers/extract";
import { reconcilePayment } from "../../src/lib/payments/reconcile";
import { verifyPineLabsSignature } from "../../src/lib/payments/webhook-signature";
import { splitWithheld, splitAlsoKeep, statedAmounts } from "../../src/lib/private-tell";
import { createHmac } from "node:crypto";

ok("private tell: 'but don't mention why' sends only the intended part; 'also remember' stays private", () => {
  const t = tell("Tell Ridhima I need ten minutes, but don't mention why.");
  assert.equal(t.type, "TELL");
  if (t.type === "TELL") {
    assert.equal(t.withheld, true);
    assert.equal(t.message, "I need ten minutes");
    assert.equal(noteHeadline("Arshia Gupta", t.message, t.lead, t.kind, t.amountMinor, t.subject), "Arshia needs ten minutes.");
    assert.ok(!/why|mention/i.test(t.message));
  }
  const both = tell("Tell Ridhima I'm vegetarian. Also remember I hate crowded places.");
  assert.equal(both.type, "TELL");
  if (both.type === "TELL") {
    assert.equal(both.message, "I'm vegetarian.");
    assert.equal(both.keep, "I hate crowded places");
    assert.ok(!/crowded/i.test(noteHeadline("Arshia Gupta", both.message, both.lead, both.kind, both.amountMinor, both.subject)));
  }
  assert.deepEqual(splitWithheld("we leave at 6"), { message: "we leave at 6", withheld: false });
  assert.equal(splitAlsoKeep("we leave at 6").keep, null);
});
ok("private tell: duplicate first names are asked about, never guessed", () => {
  const dup = [...crew, { id: "u-priya2", name: "Priya Nair" }, { id: "u-priya1", name: "Priya Rao" }];
  const r = parsePrivateTell("Tell Priya I'm running late", dup, "u-arshia");
  assert.equal(r.type, "PROBLEM");
  if (r.type === "PROBLEM") { assert.equal(r.reason, "AMBIGUOUS_NAME"); assert.deepEqual(r.names.sort(), ["Priya Nair", "Priya Rao"]); }
});
ok("private tell: money amounts parse exactly (₹2,000, 2k, Rs 1,500.50)", () => {
  assert.deepEqual(statedAmounts("owes me ₹2,000 for the hotel"), [200000]);
  assert.deepEqual(statedAmounts("2k for the cab"), [200000]);
  assert.ok(!statedAmounts("Pay her the remaining amount.").length);
});
ok("clock statements: baggage claim, join directly, take-off vs landing, tentative, historical, Hinglish", () => {
  const n = localNow(new Date("2026-10-05T14:00:00Z"));
  assert.deepEqual(parseTravellerStatus("I'm still at baggage claim.", n), { kind: "AT_AIRPORT", stage: "baggage" });
  assert.deepEqual(parseTravellerStatus("Go ahead, I'll join you directly at dinner.", n), { kind: "JOIN_DIRECT", target: "dinner" });
  const to = parseTravellerStatus("Actually, 8:15 is take-off, not landing.", n);
  assert.equal(to?.kind, "TAKEOFF_NOT_LANDING");
  assert.deepEqual(parseTravellerStatus("Flight might be delayed, nothing confirmed yet.", n), { kind: "TENTATIVE_DELAY" });
  assert.deepEqual(parseTravellerStatus("My flight was delayed last time too.", n), { kind: "HISTORICAL_DELAY" });
  assert.deepEqual(parseTravellerStatus("Kal subah aaungi, aaj nahi.", n), { kind: "REL_DAY", date: "2026-10-06", part: "morning", time: null, notToday: true });
  // a real update with a firm time is NOT swallowed as tentative; plain arrivals are not statuses
  assert.equal(parseTravellerStatus("my flight is delayed, landing 9:15 pm, might slip more", n), null);
  assert.equal(parseTravellerStatus("I'll land at 9:15 PM", n), null);
  assert.equal(parseTravellerStatus("I'm at the airport", n), null);
  // none of the tentative / historical / join-directly lines is read as a new arrival time
  for (const s of ["Flight might be delayed, nothing confirmed yet.", "My flight was delayed last time too.", "Go ahead, I'll join you directly at dinner.", "I'm still at baggage claim."]) assert.equal(parseOwnArrival(s, n), null, s);
});
ok("a bare yes: one thing waiting -> that; named -> that; two or more and unnamed -> ask. Recency never decides", () => {
  const P = { kind: "proposal" as const, id: "p1", label: "Move dinner to 9:30", cardMessageId: "m1" };
  const Q = { kind: "proposal" as const, id: "p2", label: "museum tickets", cardMessageId: "m2" };
  const C = { kind: "clash" as const, id: "c1", label: "the clash on dinner (8:00 PM)", cardMessageId: "m0" };
  assert.deepEqual(pickTarget([P]), { kind: "proposal", id: "p1" });
  assert.deepEqual(pickTarget([C]), { kind: "clash", id: "c1" });
  assert.equal(pickTarget([P, Q]).kind, "ambiguous");
  assert.equal(pickTarget([P, Q, C]).kind, "ambiguous");
  assert.deepEqual(pickTarget([P, Q], namedPhrase("yes to the museum tickets")), { kind: "proposal", id: "p2" });
  assert.deepEqual(pickTarget([P, Q], namedPhrase("yeah the dinner one")), { kind: "proposal", id: "p1" });
  assert.equal(pickTarget([P, Q], namedPhrase("yes to lunch")).kind, "ambiguous");
  assert.equal(pickTarget([P, Q], namedPhrase("yes")).kind, "ambiguous");
  assert.equal(pickTarget([], []).kind, "none");
  assert.deepEqual(namedPhrase("yes"), []);
});
ok("conditional yes, payment directive, self-reported payment, fit question", () => {
  const c = parseConditionalYes("I'm fine with 10, but only if we're back by 11.");
  assert.deepEqual(c, { accepts: "I'm fine with 10", condition: "we're back by 11" });
  assert.equal(parseConditionalYes("I'm fine with 10"), null);
  const names = ["Arshia", "Ridhima"];
  assert.deepEqual(parsePayDirective("Pay her the remaining amount.", names), { recipientWord: "her", amountMinor: null, remaining: true });
  assert.equal(parsePayDirective("Pay for the cab", names), null);
  assert.deepEqual(parseSelfReportedPayment("I already paid her outside Clockwise.", names), { recipientWord: "her", amountMinor: null, outside: true });
  assert.equal(parseSelfReportedPayment("I paid for dinner", names), null);
  assert.deepEqual(parseFitQuestion("Let's do Cubbon before dinner?"), { place: "Cubbon", relation: "before", anchor: "dinner" });
  assert.equal(parseFitQuestion("Let's do Cubbon before dinner"), null); // a statement, not a question
  assert.equal(parseFitQuestion("shall we move dinner before the flight?"), null); // a plan command, not a place
});
ok("a mood about the next meal is understood but never stored; the model cannot store a guess about someone else", () => {
  assert.equal(parseTransientAvoid("Anything except another dosa place 😭"), "dosa");
  assert.equal(parseTransientAvoid("I want dosa"), null);
  const others = ["Ridhima", "Shreya"];
  assert.equal(validateModelPointer("Ridhima's vegetarian, I think.", "DIET", "vegetarian", others).ok, false);
  assert.equal(validateModelPointer("I'm vegetarian btw", "DIET", "vegetarian", others).ok, true);
  assert.equal(validateModelPointer("Anything except another dosa place 😭", "AVOID", "dosa places", others).ok, false);
  assert.equal(validateModelPointer("Cubbon Park looks cute.", "WANT", "cubbon park", others).ok, false);
  assert.equal(validateModelPointer("Shreya wants to see Lalbagh", "WANT", "lalbagh", others).ok, false);
  assert.equal(validateModelPointer("I'd love to see Cubbon Park", "WANT", "cubbon park", others).ok, true);
});
ok("payments: a provider answer must be about THIS payment (link, reference, amount, currency)", () => {
  const exp = { paymentLinkId: "pl-1", amountMinor: 10000, currency: "INR", references: ["CW-abc-xyz"] };
  assert.deepEqual(reconcilePayment(exp, { paymentLinkId: "pl-1", merchantReference: "CW-abc-xyz", amountMinorUnits: 10000, currency: "INR" }), { ok: true });
  assert.deepEqual(reconcilePayment(exp, { paymentLinkId: "pl-1", merchantReference: "CW-abc-xyz-2", amountMinorUnits: 10000, currency: "INR" }), { ok: true }); // retry suffix
  assert.equal(reconcilePayment(exp, { paymentLinkId: "pl-1", merchantReference: "CW-abc-xyz", amountMinorUnits: 9000, currency: "INR" }).ok, false);
  assert.equal(reconcilePayment(exp, { paymentLinkId: "pl-2", merchantReference: "CW-abc-xyz", amountMinorUnits: 10000, currency: "INR" }).ok, false);
  assert.equal(reconcilePayment(exp, { paymentLinkId: "pl-1", merchantReference: "CW-other", amountMinorUnits: 10000, currency: "INR" }).ok, false);
  assert.equal(reconcilePayment(exp, { paymentLinkId: "pl-1", merchantReference: "CW-abc-xyz", amountMinorUnits: 10000, currency: "USD" }).ok, false);
});
ok("payments: webhook signature accepts only the exact signed body, in time, with the right secret", () => {
  const secret = Buffer.from("super-secret-key").toString("base64");
  const body = JSON.stringify({ payment_link_id: "pl-1" });
  const id = "evt_1";
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = createHmac("sha256", Buffer.from(secret, "base64")).update(`${id}.${ts}.${body}`).digest("base64");
  const base = { secret, id, timestamp: ts, signatureHeader: `v1,${sig}`, rawBody: body };
  assert.equal(verifyPineLabsSignature(base), true);
  assert.equal(verifyPineLabsSignature({ ...base, rawBody: body.replace("pl-1", "pl-2") }), false);
  assert.equal(verifyPineLabsSignature({ ...base, secret: Buffer.from("other").toString("base64") }), false);
  assert.equal(verifyPineLabsSignature({ ...base, timestamp: String(Number(ts) - 3600) }), false);
  assert.equal(verifyPineLabsSignature({ ...base, signatureHeader: null }), false);
});
ok("'add Birthday Dinner on Monday 5 Oct at 8pm' names it Birthday Dinner, not '... on Monday'", () => {
  const c = parsePlanCommand("add Birthday Dinner on Monday 5 Oct at 8pm", ctx());
  assert.equal(c?.kind, "create");
  if (c?.kind === "create") { assert.equal(c.name.toLowerCase(), "birthday dinner"); assert.equal(c.date, "2026-10-05"); assert.equal(c.time, "20:00"); }
});
console.log(`\n${n} agent-behaviour checks passed`);

import { hoursNote } from "../../src/lib/travel/hours";
ok("a route that works is not the same as a venue that is open: travel and hours are reported separately", () => {
  assert.match(hoursNote(null, "2026-10-05T19:00", 20), /travel time only.*haven't checked it is open/);
  assert.match(hoursNote("Mo-Su 09:00-17:00", "2026-10-05T19:00", 20), /closed at that time/);
  assert.match(hoursNote("Mo-Su 09:00-22:00", "2026-10-05T19:00", 20), /open at that time/);
  assert.match(hoursNote("garbage ???", "2026-10-05T19:00", 20), /travel time only/);
});
console.log(`\n${n} agent-behaviour checks passed`);

import { flightMinutes } from "../../src/lib/traveller/flight-time";
import { groundedTitle } from "../../src/lib/budget/titles";
ok("a meal mood belongs to its meal and day, with no clock-based expiry", () => {
  assert.equal(mealSlot("08:30"), "breakfast");
  assert.equal(mealSlot("13:00"), "lunch");
  assert.equal(mealSlot("16:00"), "snacks");
  assert.equal(mealSlot("20:15"), "dinner");
  assert.equal(mealSlot("01:00"), "late");
  assert.equal(moodApplies({ slot: "dinner", date: "2026-10-05" }, { date: "2026-10-05", time: "21:45" }), true);
  assert.equal(moodApplies({ slot: "dinner", date: "2026-10-05" }, { date: "2026-10-05", time: "13:00" }), false); // a different meal
  assert.equal(moodApplies({ slot: "dinner", date: "2026-10-05" }, { date: "2026-10-06", time: "20:00" }), false); // another day
});
ok("flight time reads each end in its own zone and date; no zone or no time means no answer", () => {
  assert.deepEqual(flightMinutes({ departLocal: "2026-10-05T07:00", departTz: "Asia/Kolkata", arriveLocal: "2026-10-05T15:30", arriveTz: "Asia/Singapore" }), { ok: true, minutes: 360, crossesZones: true });
  assert.deepEqual(flightMinutes({ departLocal: "2026-10-05T07:00", departTz: "Asia/Kolkata", arriveLocal: "2026-10-05T10:00", arriveTz: "Asia/Kolkata" }), { ok: true, minutes: 180, crossesZones: false });
  // an overnight flight that lands the next calendar day (Delhi 23:00 IST = 17:30 UTC; London 07:30 BST = 06:30 UTC)
  assert.deepEqual(flightMinutes({ departLocal: "2026-10-05T23:00", departTz: "Asia/Kolkata", arriveLocal: "2026-10-06T07:30", arriveTz: "Europe/London" }), { ok: true, minutes: 780, crossesZones: true });
  assert.equal(flightMinutes({ departLocal: "2026-10-05T07:00", departTz: null, arriveLocal: "2026-10-05T10:00", arriveTz: "Asia/Kolkata" }).ok, false);
  assert.equal(flightMinutes({ departLocal: null, departTz: "Asia/Kolkata", arriveLocal: "2026-10-05T10:00", arriveTz: "Asia/Kolkata" }).ok, false);
  assert.equal(flightMinutes({ departLocal: "2026-10-05T10:00", departTz: "Asia/Kolkata", arriveLocal: "2026-10-05T10:05", arriveTz: "Asia/Kolkata" }).ok, false); // 5 minutes is not a flight
});
ok("an expense is titled from the speaker's own words", () => {
  assert.deepEqual(groundedTitle("Ridhima paid ₹2,000 for the cab", "Cab", "Ridhima"), { title: "Cab", grounded: true });
  assert.equal(groundedTitle("Ridhima paid ₹2,000 for both of us.", "Tickets for two", "Ridhima").grounded, false);
  assert.equal(groundedTitle("Pay her the remaining amount.", "Dinner", "Ridhima").title, "Expense paid by Ridhima");
});
console.log(`\n${n} agent-behaviour checks passed`);

import { parseOwes } from "../../src/lib/reply-talk";
ok("a speech engine's '08:15 tonight' is the evening hour; a morning cue or an explicit am/pm still wins", () => {
  const n = localNow(new Date("2026-10-05T14:00:00Z"));
  assert.deepEqual(parseOwnArrival("guys my flight got delayed by two hours i'll reach around 08:15 tonight", n), { kind: "time", arrivalTime: "20:15" });
  assert.deepEqual(parseOwnArrival("guys my flight got delayed by two hours i'll reach around 8:15 pm tonight", n), { kind: "time", arrivalTime: "20:15" });
  assert.deepEqual(parseOwnArrival("I'll land around 08:15 tomorrow morning", n), { kind: "time", arrivalTime: "08:15", arrivalDate: "2026-10-06" });
  assert.equal(parseOwnArrival("@Arshia my flight got delayed by 2 hours. I'll reach around 8:15 pm now.", n)?.kind, "time");
});
ok("'X owes me ₹N' is one debt with a direction; nothing here is a split", () => {
  const names = ["Arshia", "Ridhima"];
  assert.deepEqual(parseOwes("Ridhima owes me ₹1,000.", names), { debtorWord: "Ridhima", creditorWord: "me", amountMinor: 100000 });
  assert.deepEqual(parseOwes("I owe Ridhima ₹500", names), { debtorWord: "me", creditorWord: "Ridhima", amountMinor: 50000 });
  assert.equal(parseOwes("Ridhima owes me", names), null); // no amount: nothing invented
  assert.equal(parseOwes("Priya owes me ₹100", names), null); // not on the trip
  assert.deepEqual(parsePayDirective("@Clockwise pay Ridhima ₹1,000.", names), { recipientWord: "Ridhima", amountMinor: 100000, remaining: false });
});
console.log(`\n${n} agent-behaviour checks passed`);
