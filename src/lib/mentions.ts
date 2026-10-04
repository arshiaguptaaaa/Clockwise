// @mentions in the Trip Room, WhatsApp/Slack style. A mention is SOCIAL: it says who a message is for. It is not a
// switch. Clockwise listens to the whole room either way (see agent/intervention-gate.ts), with different
// thresholds:
//   EXPLICIT  "@Clockwise find dosa", "Clockwise, move dinner"   -> answers
//   REQUEST   "find me dosa places in Bengaluru" (no name)       -> an unmistakable ask of the agent -> answers
//   PASSIVE   "I'm vegetarian btw", "my flight is delayed, 9:15" -> quietly notices state, may act on it
//   HUMAN     "HAHAHA Arshia 😭", "@Ridhima what do you think?"   -> stays out of it
export type Person = { userId: string; name: string };
export type Mentions = { clockwise: boolean; all: boolean; userIds: string[]; names: string[] };

const first = (name: string) => name.trim().split(/\s+/)[0] ?? name;
const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");

export const ALL_WORDS = ["all", "everyone", "everybody", "guys"];

// Who the message names after an "@". Matches a first name, case-insensitively, as a whole word.
export function parseMentions(text: string, people: Person[]): Mentions {
  const out: Mentions = { clockwise: false, all: false, userIds: [], names: [] };
  const re = /(^|[\s(])@([\p{L}][\p{L}'’-]*)/gu;
  for (const m of text.matchAll(re)) {
    const word = norm(m[2]);
    if (word === "clockwise") {
      out.clockwise = true;
      continue;
    }
    if (ALL_WORDS.includes(word) || word === "here") {
      out.all = true;
      continue;
    }
    const p = people.find((x) => norm(first(x.name)) === word) ?? people.find((x) => norm(first(x.name)).startsWith(word) && word.length >= 3);
    if (p && !out.userIds.includes(p.userId)) {
      out.userIds.push(p.userId);
      out.names.push(first(p.name));
    }
  }
  // Plain "Clockwise, ..." / "hey clockwise" is a mention too: people don't always use the picker.
  if (/(^|[\s,.!?])clockwise\b/i.test(text)) out.clockwise = true;
  return out;
}

// What the composer's @ menu offers, filtered as you type. Clockwise and everyone first; then the travellers.
export type MentionOption = { id: string; label: string; hint: string; kind: "clockwise" | "all" | "person" };

export function mentionOptions(query: string, people: Person[], selfId?: string | null): MentionOption[] {
  const all: MentionOption[] = [
    { id: "clockwise", label: "Clockwise", hint: "ask the trip agent", kind: "clockwise" },
    { id: "all", label: "all", hint: "everyone on the trip", kind: "all" },
    ...people.filter((p) => p.userId !== selfId).map((p): MentionOption => ({ id: p.userId, label: first(p.name), hint: p.name, kind: "person" })),
  ];
  const q = norm(query);
  if (!q) return all;
  const score = (o: MentionOption) => {
    const l = norm(o.label);
    if (l.startsWith(q)) return 0;
    if (norm(o.hint).split(/\s+/).some((w) => w.startsWith(q))) return 1;
    // fuzzy: letters of the query appear in order
    let i = 0;
    for (const ch of l) if (ch === q[i]) i++;
    return i === q.length ? 2 : 9;
  };
  return all.filter((o) => score(o) < 9).sort((a, b) => score(a) - score(b));
}

// An unmistakable request to the agent that never used its name: an imperative aimed at "us/me" for the world's
// facts ("find me…", "show us…", "where should we eat"). Deliberately narrow: ordinary talk between travellers
// must never be taken for a request.
export function isAgentRequest(text: string): boolean {
  const t = text.trim().replace(/^(@\w+\s*)+/, "").trim();
  if (/^(please\s+|pls\s+)?(find|show|search|suggest|recommend|look up|look for|get)\s+(me|us)\b/i.test(t)) return true;
  if (/^(please\s+|pls\s+)?(find|show|search|suggest|recommend)\s+(good|great|best|nice|some|any|the best|top)\b/i.test(t)) return true;
  if (/^(where|what)\s+(should|can|do|shall)\s+(we|i)\s+(eat|go|do|see|visit|stay|grab|get)\b/i.test(t)) return true;
  if (/^what('?s| is| are)\s+(still\s+)?(undecided|left to decide|open|pending)\b/i.test(t)) return true;
  if (/^(what('?s| is)|anything)\s+(good\s+)?(near|around|close to)\b/i.test(t)) return true;
  return false;
}

export type MessageMode = "EXPLICIT" | "REQUEST" | "PASSIVE" | "HUMAN";

// EXPLICIT / REQUEST / PASSIVE-or-HUMAN. The split between the last two is decided by whether anything in the
// message states trip state (pointers, arrival changes); that is the agent's own call, so here an
// un-addressed message is PASSIVE and the passive pipeline decides whether there was anything to notice.
export function classifyMessage(text: string, people: Person[]): { mode: MessageMode; mentions: Mentions } {
  const mentions = parseMentions(text, people);
  if (mentions.clockwise) return { mode: "EXPLICIT", mentions };
  if (isAgentRequest(text)) return { mode: "REQUEST", mentions };
  return { mode: "PASSIVE", mentions };
}

// Splits a message into plain and @mention segments so the thread can highlight them.
export function splitMentions(text: string, people: Person[]): { text: string; mention?: "clockwise" | "all" | "person" }[] {
  const out: { text: string; mention?: "clockwise" | "all" | "person" }[] = [];
  const re = /(^|[\s(])(@[\p{L}][\p{L}'’-]*)/gu;
  let last = 0;
  for (const m of text.matchAll(re)) {
    const start = (m.index ?? 0) + m[1].length;
    const word = norm(m[2].slice(1));
    const kind = word === "clockwise" ? "clockwise" : ALL_WORDS.includes(word) || word === "here" ? "all" : people.some((p) => norm(first(p.name)) === word) ? "person" : null;
    if (!kind) continue;
    if (start > last) out.push({ text: text.slice(last, start) });
    out.push({ text: m[2], mention: kind });
    last = start + m[2].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out.length ? out : [{ text }];
}
