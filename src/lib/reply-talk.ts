// Replies and money talk that LOOK like simple instructions but are not, read in code so the model never improvises:
//   "I'm fine with 10, but only if we're back by 11."   conditional: not a yes yet
//   "Pay her the remaining amount."                      a payment directive with no amount
//   "I already paid her outside Clockwise."              a traveller's own report, not a confirmed settlement
//   "Let's do Cubbon before dinner?"                     a question about fit, never a plan edit
import { statedAmounts } from "@/lib/private-tell";

const squash = (s: string) => s.replace(/[’‘]/g, "'").replace(/\s+/g, " ").trim();

export type Conditional = { accepts: string; condition: string };
export function parseConditionalYes(raw: string): Conditional | null {
  const t = squash(raw);
  if (!t || t.length > 200) return null;
  const m = /\b(?:i'?m|i am|im|we'?re|that'?s|it'?s|works?|sounds?|ok(?:ay)?|fine|good|cool|happy|down|in)\b[^,;.!?]*?\b(?:fine|ok(?:ay)?|good|cool|happy|down|in|works?|great)?\b[^,;.!?]*?[,;-]?\s*(?:but\s+)?(?:only\s+if|as long as|so long as|provided(?: that)?|on (?:the )?condition(?: that)?|if and only if|but if|unless)\s+(.+)$/i.exec(t);
  if (!m) return null;
  if (!/\b(fine|ok|okay|good|cool|happy|down|works?|in|great|yes|yeah|sure)\b/i.test(t.slice(0, t.length - m[1].length))) return null;
  const condition = squash(m[1]).replace(/[.!]+$/, "");
  const accepts = squash(t.slice(0, t.length - m[1].length).replace(/[,;-]?\s*(?:but\s+)?(?:only\s+if|as long as|so long as|provided(?: that)?|on (?:the )?condition(?: that)?|if and only if|but if|unless)\s*$/i, "")).replace(/[,;-]+$/, "");
  return condition ? { accepts, condition } : null;
}

export type PayDirective = { recipientWord: string; amountMinor: number | null; remaining: boolean };
export function parsePayDirective(raw: string, firstNames: string[]): PayDirective | null {
  const t = squash(raw).replace(/^(?:(?:hey|ok|okay|so|and|also)\s+)*(?:@clockwise[,:]?\s*|clockwise[,:]?\s*)?/i, "").replace(/^(?:please|pls|can you|could you)\s+/i, "");
  const m = /^(?:pay|settle(?: up)?(?: with)?|send(?: some)?(?: money)?(?: to)?|transfer(?: some)?(?: money)?(?: to)?|give)\s+(her|him|them|@?[A-Za-z]+)\b(.*)$/i.exec(t);
  if (!m) return null;
  const who = m[1].replace(/^@/, "");
  const known = /^(her|him|them)$/i.test(who) || firstNames.some((n) => n.toLowerCase() === who.toLowerCase());
  if (!known) return null;
  const rest = m[2] ?? "";
  const remaining = /\b(remaining|rest|balance|left|whatever (?:i|we) owe|what (?:i|we) owe|the difference|everything|all of it)\b/i.test(rest);
  const amount = statedAmounts(rest)[0] ?? null;
  return { recipientWord: who, amountMinor: amount, remaining };
}

export type SelfReportedPayment = { recipientWord: string; amountMinor: number | null; outside: boolean };
export function parseSelfReportedPayment(raw: string, firstNames: string[]): SelfReportedPayment | null {
  const t = squash(raw);
  const m = /\b(?:i'?ve|i\s+have|i)\s+(?:already\s+|just\s+|also\s+)?(?:paid|sent|transferred|settled(?: up)?(?: with)?|gpay'?d|upi'?d|handed)\s+(?:the\s+money\s+to\s+|it\s+to\s+|money\s+to\s+)?(her|him|them|@?[A-Za-z]+)\b(.*)$/i.exec(t);
  if (!m) return null;
  const who = m[1].replace(/^@/, "");
  if (!/^(her|him|them)$/i.test(who) && !firstNames.some((n) => n.toLowerCase() === who.toLowerCase())) return null;
  return { recipientWord: who, amountMinor: statedAmounts(m[2] ?? "")[0] ?? null, outside: /\b(outside|offline|in cash|cash|separately|directly|upi|gpay|paytm|phonepe|venmo|bank|neft|imps)\b/i.test(m[2] ?? "") };
}

// "Let's do Cubbon before dinner?" -> { place: "Cubbon", relation: "before", anchor: "dinner" }. Only a QUESTION about
// fitting ONE named thing around ONE other thing; an addition to the Plan always needs an explicit add verb.
export function parseFitQuestion(raw: string): { place: string; relation: "before" | "after"; anchor: string } | null {
  const t = squash(raw);
  if (!/\?\s*$/.test(t) || t.length > 140) return null;
  const m = /^(?:so\s+|hey\s+|ok\s+|okay\s+)?(?:let'?s|lets|shall we|should we|how about|what about|why don'?t we|can we|could we)\s+(?:maybe\s+)?(?:do|try|visit|see|go to|go see|hit|squeeze in|fit in|fit)?\s*(.+?)\s+(before|after)\s+(?:the\s+)?(.+?)\s*\?+$/i.exec(t);
  if (!m) return null;
  const place = m[1].replace(/^(the|a)\s+/i, "").trim();
  if (!place || place.split(/\s+/).length > 4 || /\b(we|us|you|it|that|this)\b/i.test(place)) return null;
  // moving or swapping meals around is a plan command, not "does this place fit"
  if (/^(move|shift|push|swap|cancel|skip|have|eat|do)\b/i.test(place) || /^(dinner|lunch|breakfast|brunch|coffee|drinks|tea)$/i.test(place)) return null;
  return { place, relation: m[2].toLowerCase() as "before" | "after", anchor: m[3].trim() };
}
