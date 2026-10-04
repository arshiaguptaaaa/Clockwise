// Reads a plan command out of plain chat: "add birthday dinner tomorrow at 8 PM", "move dinner to 10",
// "let's do dinner at 9 instead", "cancel tomorrow's breakfast", "Ridhima and I are doing coffee at 5".
// Pure and deterministic: the date, the time and WHICH commitment are all settled here, never by the model, so
// the same words always produce the same change. Anything it can't read with confidence returns null and the
// message goes to the model as before.
import { parseDay, parseTime, stripMatched, type LocalNow, type DayWindow } from "@/lib/when";
import type { Person } from "@/lib/mentions";

export type PlanCommitment = { id: string; name: string; target: string; participantIds: string[] };

export type PlanCtx = {
  now: LocalNow;
  window: DayWindow;
  speakerId: string;
  members: Person[];
  commitments: PlanCommitment[];
  defaultLocation: string;
};

export type PlanCommand =
  | { kind: "create"; name: string; date: string; time: string; location: string; participantIds: string[] | null; guessed: boolean; dayAssumed: boolean }
  | { kind: "move"; commitmentId: string; commitmentName: string; from: string; date: string; time: string; guessed: boolean }
  | { kind: "cancel"; commitmentId: string; commitmentName: string; at: string }
  | { kind: "clarify"; question: string }
  | { kind: "ambiguous"; question: string };

const first = (n: string) => n.trim().split(/\s+/)[0] ?? n;
const lc = (s: string) => s.toLowerCase();

// The message without the address ("@Clockwise", "Clockwise,", "hey clockwise") and without @mention tokens.
export function stripAddress(text: string): string {
  return text
    .replace(/(^|\s)@[\p{L}][\p{L}'’-]*/gu, " ")
    .replace(/^\s*(hey|hi|hello|ok|okay|so|also|and)?[\s,]*clockwise[\s,:-]*/i, "")
    .replace(/\bclockwise\b[,:]?/i, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const STOP = new Set(["the", "a", "an", "my", "our", "that", "this", "it", "plan", "event", "thing", "one", "to", "of", "for", "on", "at", "in", "s", "tomorrow", "today", "tonight", "tmrw"]);
const tokens = (s: string) =>
  lc(s)
    .replace(/['’]s\b/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !STOP.has(w))
    .map((w) => w.replace(/s$/, ""));

// Which existing commitment does this phrase mean? Every word of the phrase must appear in the commitment's name
// ("dinner" -> "Birthday dinner"). A phrase that fits two is ambiguous, and Clockwise asks rather than guessing.
export function matchCommitment(phrase: string, all: PlanCommitment[], day?: string | null): { hit: PlanCommitment | null; candidates: PlanCommitment[] } {
  const want = tokens(phrase);
  if (want.length === 0) return { hit: null, candidates: [] };
  const scoped = day ? all.filter((c) => c.target.slice(0, 10) === day) : all;
  const matches = (pool: PlanCommitment[]) => pool.filter((c) => {
    const have = tokens(c.name);
    return want.every((w) => have.some((h) => h === w || h.startsWith(w) || w.startsWith(h)));
  });
  let found = matches(scoped);
  if (found.length === 0 && day) found = matches(all);
  if (found.length === 0) return { hit: null, candidates: [] };
  const exact = found.filter((c) => tokens(c.name).join(" ") === want.join(" "));
  if (exact.length === 1) return { hit: exact[0], candidates: found };
  if (found.length === 1) return { hit: found[0], candidates: found };
  return { hit: null, candidates: found };
}

const cleanTitle = (s: string) =>
  s
    .replace(/\b(to|on|in|into)\s+(the\s+)?(plan|itinerary|calendar|schedule|trip)\b/gi, " ")
    .replace(/^(a|an|the|for|our|my)\s+/i, "")
    .replace(/\b(please|pls|thanks|thank you|for us|for everyone)\b/gi, " ")
    .replace(/^[\s,.:;-]+|[\s,.:;!?-]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();

const titleCase = (s: string) => s.replace(/^./, (c) => c.toUpperCase());

function resolveNames(subject: string, ctx: PlanCtx): string[] | "everyone" | null {
  const parts = subject.split(/\s*(?:,|&|\band\b|\+)\s*/i).map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return null;
  const ids: string[] = [];
  for (const p of parts) {
    const w = lc(p).replace(/[^a-z\s]/g, "").trim();
    if (["we", "all of us", "everyone", "us"].includes(w)) return "everyone";
    if (["i", "me", "myself"].includes(w)) {
      if (!ids.includes(ctx.speakerId)) ids.push(ctx.speakerId);
      continue;
    }
    const person = ctx.members.find((m) => lc(first(m.name)) === w);
    if (!person) return null;
    if (!ids.includes(person.userId)) ids.push(person.userId);
  }
  return ids.length ? ids : null;
}

function momentFrom(raw: string, hint: string, ctx: PlanCtx, fallbackDate?: string) {
  // The preposition was consumed splitting the sentence ("move dinner to 10"), so a bare number gets one back.
  const text = /^\d{1,2}([:.]\d{2})?$/.test(raw.trim()) ? `at ${raw.trim()}` : raw.replace(/^(\w+\s+)?(\d{1,2})\s*$/, "$1at $2");
  const day = parseDay(text, ctx.now, ctx.window);
  const time = parseTime(text, hint);
  return { day, time, date: day?.date ?? fallbackDate ?? null };
}

export function parsePlanCommand(raw: string, ctx: PlanCtx): PlanCommand | null {
  const text = stripAddress(raw).replace(/[?!.]+$/, "").trim();
  if (!text || text.length > 200) return null;

  // ---- CANCEL
  const cancel = /^(?:please\s+|pls\s+|can you\s+|could you\s+)?(?:cancel|remove|delete|drop|scrap|call off|take off|get rid of)\s+(.+)$/i.exec(text);
  if (cancel) {
    const day = parseDay(cancel[1], ctx.now, ctx.window);
    const phrase = cleanTitle(stripMatched(cancel[1], day?.matched));
    const { hit, candidates } = matchCommitment(phrase, ctx.commitments, day?.date);
    if (hit) return { kind: "cancel", commitmentId: hit.id, commitmentName: hit.name, at: hit.target };
    if (candidates.length > 1) return { kind: "ambiguous", question: `Which one: ${candidates.map((c) => c.name).join(" or ")}?` };
    return null; // nothing in the Plan by that name: let the model answer
  }

  // ---- MOVE
  let moveTarget: string | null = null;
  let moveWhen: string | null = null;
  const m1 = /^(?:please\s+|pls\s+|can you\s+|could you\s+)?(?:move|reschedule|shift|push|postpone|bring forward|change|update|make|set|put|keep)\s+(.+?)\s+(?:to|until|till|for|at|by)\s+(.+)$/i.exec(text);
  const m2 = /^(?:let'?s|lets|can we|could we|shall we|should we|how about|what about)?\s*(?:do|have|make|move|keep|go for|push|shift)\s+(.+?)\s+(?:at|to|for|by)\s+(.+?)\s+instead$/i.exec(text);
  const m3 = /^(.+?)\s+(?:at|to|for)\s+(.+?)\s+instead$/i.exec(text);
  const m4 = /^(?:let'?s|lets)\s+(?:do|have|make)\s+(.+?)\s+(?:at|for)\s+(.+)$/i.exec(text);
  const mv = m2 ?? m1 ?? m3 ?? m4;
  if (mv) {
    moveTarget = mv[1].replace(/\bfrom\s+\S+(?:\s*[ap]\.?m\.?)?\s*$/i, "").trim();
    moveWhen = mv[2];
  }
  if (moveTarget && moveWhen) {
    const dayInTarget = parseDay(moveTarget, ctx.now, ctx.window);
    const phrase = cleanTitle(stripMatched(moveTarget, dayInTarget?.matched));
    const { hit, candidates } = matchCommitment(phrase, ctx.commitments, dayInTarget?.date);
    if (hit) {
      const when = momentFrom(moveWhen, hit.name, ctx, hit.target.slice(0, 10));
      if (!when.time) return { kind: "clarify", question: `What time should ${hit.name} move to?` };
      return { kind: "move", commitmentId: hit.id, commitmentName: hit.name, from: hit.target, date: when.date ?? hit.target.slice(0, 10), time: when.time.time, guessed: when.time.guessedMeridiem };
    }
    if (candidates.length > 1) return { kind: "ambiguous", question: `Which one should move: ${candidates.map((c) => c.name).join(" or ")}?` };
    // "move X to Y" with no such commitment is not a plan edit (could be "move the car to the garage").
    if (!/\binstead\b/i.test(text)) return null;
  }

  // ---- "Ridhima and I are doing coffee at 5"
  const stmt = /^(.+?)\s+(?:are|will be|'ll be|r)\s+(?:doing|having|grabbing|getting|going(?:\s+out)?(?:\s+for|\s+to)?|meeting(?:\s+up)?(?:\s+for)?|heading(?:\s+out)?(?:\s+for|\s+to)?)\s+(.+)$/i.exec(text);
  if (stmt) {
    const who = resolveNames(stmt[1], ctx);
    if (who) {
      const body = stmt[2];
      const day = parseDay(body, ctx.now, ctx.window);
      const hintName = stripMatched(body, day?.matched);
      const time = parseTime(body, hintName);
      if (!time) return null;
      let name = cleanTitle(stripMatched(body, day?.matched, time.matched).replace(/\b(at|on|around|by)\s*$/i, ""));
      let location = ctx.defaultLocation;
      const at = /^(.*?)\s+(?:at|in)\s+(.+)$/i.exec(name);
      if (at && at[1]) {
        name = cleanTitle(at[1]);
        location = cleanTitle(at[2]) || location;
      }
      if (!name) return null;
      const date = day?.date ?? (time.time > ctx.now.time ? ctx.now.date : null);
      return {
        kind: "create",
        name: titleCase(name),
        date: date ?? addOne(ctx.now.date),
        time: time.time,
        location,
        participantIds: who === "everyone" ? null : who,
        guessed: time.guessedMeridiem,
        dayAssumed: !day,
      };
    }
  }

  // ---- CREATE
  const create = /^(?:can you\s+|could you\s+|would you\s+|please\s+|pls\s+)*(?:also\s+)?(?:add|create|schedule|book|put|plan|set up|log|pencil in|note down|block)\s+(?:in\s+)?(.+)$/i.exec(text);
  if (create) {
    const body = create[1];
    const day = parseDay(body, ctx.now, ctx.window);
    const afterDay = stripMatched(body, day?.matched);
    const time = parseTime(afterDay, afterDay);
    let rest = cleanTitle(stripMatched(afterDay, time?.matched).replace(/\b(at|on|around|by|for)\s*$/i, ""));
    let location = ctx.defaultLocation;
    const at = /^(.*?)\s+(?:at|in)\s+(.+)$/i.exec(rest);
    if (at && at[1]) {
      rest = cleanTitle(at[1]);
      location = cleanTitle(at[2]) || location;
    }
    rest = rest.replace(/\b(on|at|for|in)\s*$/i, "").trim();
    // "book flights", "add a reminder" etc. with no day and no time are not plan items.
    if (!day && !time) return null;
    if (!rest) return null;
    if (!time) return { kind: "clarify", question: `What time for ${titleCase(rest)}${day ? ` on ${day.date}` : ""}?` };
    const date = day?.date ?? (time.time > ctx.now.time ? ctx.now.date : addOne(ctx.now.date));
    const named = ctx.members.filter((m) => new RegExp(`\\b${first(m.name)}\\b`, "i").test(body)).map((m) => m.userId);
    return {
      kind: "create",
      name: titleCase(rest),
      date,
      time: time.time,
      location,
      // "add dinner with Ridhima" scopes it; otherwise it's a shared plan for everyone.
      participantIds: /\bwith\b/i.test(body) && named.length ? Array.from(new Set([ctx.speakerId, ...named])) : null,
      guessed: time.guessedMeridiem,
      dayAssumed: !day,
    };
  }
  return null;
}

function addOne(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
