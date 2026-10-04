// Shared decisions: chat replies, decline reasons, proposal-vs-plan stages. Pure; no network, no DB.
import assert from "node:assert/strict";
import { classifyReply } from "../../src/lib/chat-vote";
import { readDeclineByRules, toHHMM } from "../../src/lib/reschedule-counter";
import { stageOf } from "../../src/lib/decisions";

let n = 0;
const ok = (name: string, fn: () => void) => {
  fn();
  n++;
  console.log(`PASS ${name}`);
};

ok("plain yes replies are understood", () => {
  for (const t of ["yes", "Yeah!", "works", "that works", "I'm in", "sounds good", "works for me", "sure", "ok", "count me in"]) assert.equal(classifyReply(t), "YES", t);
});
ok("plain no replies are understood", () => {
  for (const t of ["no", "can't do 10", "nope", "cant", "I have to leave by 10:30", "no, I need to be back by 10:30"]) assert.equal(classifyReply(t), "NO", t);
});
ok("a counter-suggestion is not a vote of yes", () => {
  assert.equal(classifyReply("make it 9:30"), "COUNTER");
  assert.equal(classifyReply("how about 9"), "COUNTER");
});
ok("ordinary chatter is left alone", () => {
  for (const t of ["lol the traffic here", "who's bringing the speaker?", "no way, that's hilarious", "yes please remind me what time the flight lands tomorrow", "ok so who is booking the cab", ""]) assert.equal(classifyReply(t), null, t);
});
ok("evening proposals read unmarked times as PM", () => {
  assert.equal(toHHMM("10:30", "22:00"), "22:30");
  assert.equal(toHHMM("9", "20:00"), "21:00");
  assert.equal(toHHMM("10:30 am", "22:00"), "10:30");
  assert.equal(toHHMM("12", "20:00"), "12:00");
});
ok("'leave by 10:30' is a latest-end limit", () => {
  const r = readDeclineByRules("I have to leave by 10:30", "22:00");
  assert.equal(r.kind, "LATEST_END");
  assert.equal(r.time, "22:30");
});
ok("'can't before 9' is an earliest-start limit", () => {
  const r = readDeclineByRules("not before 9 pm, I'm at work till then", "22:00");
  assert.equal(r.kind, "EARLIEST_START");
  assert.equal(r.time, "21:00");
});
ok("'make it 9:30' is a preference, not a limit", () => {
  const r = readDeclineByRules("make it 9:30", "22:00");
  assert.equal(r.preferred, "21:30");
  assert.equal(r.kind, null);
});
ok("proposal, agreed and confirmed are never the same stage", () => {
  assert.equal(stageOf("AWAITING_APPROVAL"), "PROPOSED");
  assert.equal(stageOf("APPROVED"), "AGREED");
  assert.equal(stageOf("EXECUTED"), "CONFIRMED");
  assert.equal(stageOf("REJECTED"), "NOT_AGREED");
});
console.log(`${n} decision regression checks passed`);
