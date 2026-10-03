// Regression lock for the Gemini "Requests ending with a model turn are not
// supported" 400. Pure functions only — no network, no keys. Run: npm run test:regression
import assert from "node:assert/strict";
import { toAgentMessages } from "../../src/lib/agent/clockwise-agent";
import { describeRequestShape, toGeminiContents } from "../../src/lib/agent/providers/gemini";
import type { AgentMessage } from "../../src/lib/agent/provider";

const turn = (id: string, who: string, content: string, isClockwise = false) => ({ id, senderName: who, content, isClockwise });
const lastRole = (m: AgentMessage[]) => m[m.length - 1].role;
let n = 0;
const ok = (name: string, fn: () => void) => {
  fn();
  n++;
  console.log(`PASS ${name}`);
};

ok("alternating history ending on a user turn is unchanged in shape", () => {
  const m = toAgentMessages([turn("1", "A", "hi"), turn("2", "C", "hello", true), turn("3", "A", "what is 2+2?")] as never);
  assert.deepEqual(m.map((x) => x.role), ["user", "assistant", "user"]);
});

ok("history ending on a Clockwise turn is normalised to end on a user turn", () => {
  const m = toAgentMessages([turn("1", "A", "hi"), turn("2", "C", "hello", true)] as never);
  assert.equal(lastRole(m), "user");
});

ok("two consecutive Clockwise turns merge and still end on user", () => {
  const m = toAgentMessages([turn("1", "A", "hi"), turn("2", "C", "card", true), turn("3", "C", "reply", true)] as never);
  assert.deepEqual(m.map((x) => x.role), ["user", "assistant", "user"]);
});

ok("card-only (empty content) assistant rows are dropped", () => {
  const m = toAgentMessages([turn("1", "A", "hi"), turn("2", "C", "", true), turn("3", "C", "   ", true), turn("4", "A", "next")] as never);
  assert.deepEqual(m.map((x) => x.role), ["user"]);
  assert.ok(!m.some((x) => x.role === "assistant" && !x.content));
});

ok("an empty user message is dropped rather than sent as an empty part", () => {
  const m = toAgentMessages([turn("1", "A", "hi"), turn("2", "C", "hello", true), turn("3", "A", "")] as never);
  assert.equal(lastRole(m), "user");
  const shape = describeRequestShape("m", "sys", toGeminiContents(m), 0);
  assert.equal(shape.emptyParts, 0);
});

ok("history starting on a Clockwise turn gets an opening user turn", () => {
  const m = toAgentMessages([turn("1", "C", "welcome", true), turn("2", "A", "hi")] as never);
  assert.equal(m[0].role, "user");
});

ok("tool calls and responses are preserved and paired", () => {
  const msgs: AgentMessage[] = [
    { role: "user", content: "A: find hotels" },
    { role: "assistant", content: null, toolCalls: [{ id: "c1", name: "search_hotels", input: { near: "Udaipur" } }] },
    { role: "tool", toolCallId: "c1", name: "search_hotels", output: "Posted 5 stays" },
  ];
  const shape = describeRequestShape("m", "sys", toGeminiContents(msgs), 3);
  assert.equal(shape.functionCalls, 1);
  assert.equal(shape.functionResponses, 1);
  assert.equal(shape.unpairedCalls, 0);
});

ok("diagnostics contain structure only — no message text", () => {
  const secret = "PRIVATE-MESSAGE-CONTENT-12345";
  const shape = describeRequestShape("m", `system ${secret}`, toGeminiContents([{ role: "user", content: secret }]), 0);
  assert.ok(!JSON.stringify(shape).includes(secret));
});

console.log(`\n${n} regression checks passed`);
