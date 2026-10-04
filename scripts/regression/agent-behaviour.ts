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
console.log(`\n${n} agent-behaviour checks passed`);

import { classifyClashAnswer } from "../../src/lib/disruption";
ok("a reply to a clash question is understood without @Clockwise", () => {
  for (const t of ["Yeah.", "yes", "yeah please", "do it", "propose it", "sure"]) assert.equal(classifyClashAnswer(t), "AGREE", t);
  assert.equal(classifyClashAnswer("inform them"), "INFORM");
  assert.equal(classifyClashAnswer("cancel it"), "CANCEL");
  assert.equal(classifyClashAnswer("move it later"), "LATER");
  assert.equal(classifyClashAnswer("leave it"), "LEAVE");
  assert.equal(classifyClashAnswer("no"), "LEAVE");
  assert.equal(classifyClashAnswer("lol who's bringing the speaker"), null);
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
