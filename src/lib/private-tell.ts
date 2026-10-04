// "Tell Ridhima I want vegetarian food." Reads ONE private message to Clockwise and decides, in code, whether the
// traveller wants something PASSED ON, wants Clockwise to KEEP something, or is just talking to Clockwise.
//
// Visibility is explicit and never promoted:
//   PRIVATE_TO_AGENT       you and Clockwise only ("just remember...", "don't tell anyone")
//   PRIVATE_TO_RECIPIENTS  the named people only, with the sender named
//   GROUP_VISIBLE          the sender said "everyone" / @all
//
// Pure: no database, no model. Names are resolved against the trip roster; nothing is guessed. A message that is
// not clearly a hand-off comes back NONE and goes to the normal private agent untouched.

export type Member = { id: string; name: string };

export type TellKind = "NOTE" | "MONEY_TO_SENDER" | "MONEY_FROM_SENDER" | "MONEY_PLEDGE";

export type TellIntent =
  | { type: "NONE" }
  | { type: "KEEP"; secret: boolean }
  | { type: "CONFIRM" }
  | { type: "CANCEL" }
  | { type: "PROBLEM"; reason: "UNKNOWN_NAME" | "SELF" | "NO_ONE"; names: string[] }
  | {
      type: "TELL";
      scope: "PEOPLE" | "ALL" | "EXCEPT";
      recipientIds: string[];
      excludedIds: string[];
      message: string;
      lead: "says" | "reminds";
      kind: TellKind;
      amountMinor: number | null;
      subject: string | null;
      needsConfirm: boolean;
    };

const first = (n: string) => n.trim().split(/\s+/)[0];
const clean = (s: string) => s.replace(/\s+/g, " ").trim();

// "₹2,000", "Rs 2000", "2000 rupees", "2k" -> paise. null when there is no clear amount.
export function amountIn(text: string): number | null {
  const m =
    /(?:₹|\brs\.?|\binr)\s?(\d[\d,]*(?:\.\d{1,2})?)\s?(k)?/i.exec(text) ??
    /(\d[\d,]*(?:\.\d{1,2})?)\s?(k)?\s?(?:rupees?|rs\b|inr\b|₹)/i.exec(text);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, "")) * (m[2] ? 1000 : 1);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100);
}

export const rupees = (minor: number) => `₹${(minor / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

const GROUP_WORDS = new Set(["everyone", "everybody", "all", "@all", "@everyone", "the group", "group"]);
const NOT_NAMES = new Set(["i", "i'm", "i'll", "i'd", "we", "we're", "me", "us", "my", "clockwise", "that", "the", "a", "to", "about", "what", "where", "when", "how", "dinner", "it", "this", "there", "she", "he", "they", "you", "your", "our", "if"]);

type Spec = { ids: string[]; excluded: string[]; all: boolean; unknown: string[]; consumed: number; except: boolean };

// Reads names / @mentions / everyone / "everyone except X" off the front of a token list.
function readSpec(tokens: string[], members: Member[], senderId: string): Spec {
  const out: Spec = { ids: [], excluded: [], all: false, unknown: [], consumed: 0, except: false };
  const byFirst = (w: string) => members.filter((m) => first(m.name).toLowerCase() === w.toLowerCase());
  let i = 0;
  let exceptMode = false;
  let afterConnector = false;
  for (; i < tokens.length; i++) {
    const raw = tokens[i].replace(/[,.;:!?]+$/g, "");
    const low = raw.toLowerCase();
    if (!raw) continue;
    if (low === "and" || low === "&" || raw === ",") { out.consumed = i + 1; afterConnector = true; continue; }
    const connector = afterConnector;
    afterConnector = false;
    if (GROUP_WORDS.has(low)) { out.all = true; out.consumed = i + 1; continue; }
    if (low === "except" || low === "but" || (low === "besides" && out.all)) { exceptMode = true; out.except = true; out.consumed = i + 1; continue; }
    if (low === "the" && tokens[i + 1]?.toLowerCase().replace(/[,.]/g, "") === "group") { out.all = true; i++; out.consumed = i + 1; continue; }
    const at = raw.startsWith("@");
    const nm = at ? raw.slice(1) : raw;
    const hits = nm ? byFirst(nm) : [];
    if (hits.length === 1 && !NOT_NAMES.has(nm.toLowerCase())) {
      (exceptMode ? out.excluded : out.ids).push(hits[0].id);
      out.consumed = i + 1;
      continue;
    }
    if (hits.length > 1) { out.unknown.push(`${nm} (more than one ${nm} on this trip)`); out.consumed = i + 1; continue; }
    // an unknown person: only when it is written like a name, directly where a recipient goes
    if ((at || /^[A-Z][a-z]+$/.test(nm)) && !NOT_NAMES.has(nm.toLowerCase()) && out.consumed === i && (connector || (out.ids.length === 0 && out.excluded.length === 0 && !out.all))) { out.unknown.push(nm); out.consumed = i + 1; continue; }
    break;
  }
  void senderId;
  return out;
}

const SPLIT_TOKENS = (s: string) => s.split(/\s+/).filter(Boolean);

// "I want vegetarian food" -> "Arshia wants vegetarian food". Only when every first-person word can be mapped
// safely; otherwise null and the recipient sees the sender's own words in quotes. Clockwise never rewrites
// meaning or invents a statement.
export function thirdPerson(sender: string, message: string): string | null {
  const s = first(sender);
  const t = clean(message).replace(/[.!]+$/, "");
  let out: string | null = null;
  let m: RegExpExecArray | null;
  if ((m = /^i(?:'d| would)\s+((?:really |also |love to |like to )*)(like|love|prefer)\s+(.*)$/i.exec(t))) out = `${s} would ${m[1]}${m[2].toLowerCase()} ${m[3]}`;
  else if ((m = /^i(?:'ll| will)\s+(.*)$/i.exec(t))) out = `${s} will ${m[1]}`;
  else if ((m = /^i(?:'m| am)\s+(.*)$/i.exec(t))) out = `${s} is ${m[1]}`;
  else if ((m = /^i (want|need|like|love|prefer|have|miss|hate)\s+(.*)$/i.exec(t))) {
    const v = m[1].toLowerCase();
    out = `${s} ${v === "have" ? "has" : v + "s"} ${m[2]}`;
  } else if ((m = /^i (can't|cannot|can|won't|can not)\s+(.*)$/i.exec(t))) out = `${s} ${m[1].toLowerCase() === "cannot" || m[1].toLowerCase() === "can not" ? "can't" : m[1].toLowerCase()} ${m[2]}`;
  if (!out) return null;
  out = out.replace(/\bmy\b/gi, `${s}'s`).replace(/\bmine\b/gi, `${s}'s`);
  if (/\b(i|me|we|us|our|ours|you|your|yours|she|he|her|him|his|they|them)\b/i.test(out.slice(s.length))) return null;
  return `${out}.`;
}

// The line a recipient reads. Always names the sender.
export function noteHeadline(sender: string, message: string, lead: "says" | "reminds", kind: TellKind, amountMinor: number | null, subject: string | null): string {
  const s = first(sender);
  const amt = amountMinor ? rupees(amountMinor) : null;
  if (kind === "MONEY_TO_SENDER" && amt) return subject ? `${s} says your share of ${subject} is ${amt}.` : `${s} has asked you for ${amt}.`;
  if (kind === "MONEY_FROM_SENDER" && amt) return subject ? `${s} says they owe you ${amt} for ${subject}.` : `${s} says they owe you ${amt}.`;
  if (kind === "MONEY_PLEDGE" && amt) {
    const when = /\b(tonight|tomorrow|today|later|now|this evening|this morning|on \w+day)\b/i.exec(message)?.[1];
    return `${s} says they'll pay you ${amt}${when ? ` ${when}` : ""}.`;
  }
  const tp = thirdPerson(sender, message);
  if (tp) return tp;
  const q = clean(message).replace(/[.!]+$/, "");
  return lead === "reminds" ? `${s} is reminding you: “${q}”.` : `${s} says: “${q}”.`;
}

function moneyKind(message: string): { kind: TellKind; amountMinor: number | null; subject: string | null } {
  const amountMinor = amountIn(message);
  if (!amountMinor) return { kind: "NOTE", amountMinor: null, subject: null };
  const subj = /\bfor\s+(?:the\s+|our\s+|my\s+)?([a-z][a-z' -]{1,40}?)(?=\s*(?:[.,!?]|tonight|tomorrow|today|$))/i.exec(message)?.[1]?.trim();
  const subject = subj ? `the ${subj.replace(/^(the|our|my)\s+/i, "")}` : null;
  if (/\b(owes?|owe|should pay|needs? to pay|has to pay|pay me|share is|your share)\b.*?\bme\b|\bowes? me\b|\bpay me\b|\byour share\b/i.test(message)) return { kind: "MONEY_TO_SENDER", amountMinor, subject };
  if (/\bi\s*(?:'ll|will|am going to|'m going to)\s+(?:pay|send|transfer|give|settle)/i.test(message)) return { kind: "MONEY_PLEDGE", amountMinor, subject };
  if (/\bi\s+owe\b/i.test(message)) return { kind: "MONEY_FROM_SENDER", amountMinor, subject };
  return { kind: "NOTE", amountMinor: null, subject: null };
}

const POLITE = /^(?:(?:hey |hi |ok |okay |so |also |and |now )*clockwise[,:]?\s*)?(?:(?:can|could|would|will) you(?: please)?\s+|please\s+|i(?:'d| would) like you to\s+|i want you to\s+)?/i;

export function parsePrivateTell(raw: string, members: Member[], senderId: string): TellIntent {
  const text = clean(raw);
  if (!text) return { type: "NONE" };
  const low = text.toLowerCase().replace(/[.!]+$/, "");

  if (/^(?:yes|yep|yeah|yup|y|send(?: it)?|go ahead|confirm(?:ed)?|do it|ok(?:ay)?|sure|please do)(?:\s+please)?$/.test(low)) return { type: "CONFIRM" };
  if (/^(?:no|nope|nah|cancel(?: it)?|don'?t(?: send(?: it)?)?|stop|never ?mind|scrap that|forget it)$/.test(low)) return { type: "CANCEL" };

  const body = text.replace(POLITE, "").trim();

  // a hand-off starts with a passing verb
  let m: RegExpExecArray | null;
  let specText = "";
  let message = "";
  let lead: "says" | "reminds" = "says";
  if ((m = /^let\s+(.+?)\s+know(?:\s+(?:that|about)|,|:)?\s*(.*)$/i.exec(body))) { specText = m[1]; message = m[2]; }
  else if ((m = /^(?:tell|inform|notify|message|text|ping|dm)\s+(.+)$/i.exec(body))) {
    const toks = SPLIT_TOKENS(m[1]);
    const spec = readSpec(toks, members, senderId);
    if (spec.consumed === 0) return { type: "NONE" };
    specText = toks.slice(0, spec.consumed).join(" ");
    message = toks.slice(spec.consumed).join(" ").replace(/^(?:that|to|about)\s+/i, (x) => (/^to/i.test(x) ? "to " : ""));
  } else if ((m = /^remind\s+(.+)$/i.exec(body))) {
    const toks = SPLIT_TOKENS(m[1]);
    const spec = readSpec(toks, members, senderId);
    if (spec.consumed === 0) return { type: "NONE" };
    specText = toks.slice(0, spec.consumed).join(" ");
    message = toks.slice(spec.consumed).join(" ").replace(/^(?:that|about)\s+/i, "");
    lead = "reminds";
  }

  if (specText) {
    const toks = SPLIT_TOKENS(specText);
    const spec = readSpec(toks, members, senderId);
    // "tell me ..." / "remind me ..." is the traveller talking to Clockwise, not a hand-off
    if (spec.consumed === 0 || !clean(message)) return { type: "NONE" };
    if (spec.unknown.length) return { type: "PROBLEM", reason: "UNKNOWN_NAME", names: spec.unknown };

    let recipients = spec.all ? members.map((x) => x.id) : spec.ids;
    recipients = recipients.filter((id) => id !== senderId && !spec.excluded.includes(id));
    if (!spec.all && spec.ids.length > 0 && spec.ids.every((id) => id === senderId)) return { type: "PROBLEM", reason: "SELF", names: [] };
    if (recipients.length === 0) return { type: "PROBLEM", reason: "NO_ONE", names: [] };

    const scope = spec.all && spec.excluded.length ? "EXCEPT" : spec.all ? "ALL" : "PEOPLE";
    const msg = clean(message);
    const money = moneyKind(msg);
    return {
      type: "TELL",
      scope,
      recipientIds: [...new Set(recipients)],
      excludedIds: spec.excluded,
      message: msg,
      lead,
      kind: money.kind,
      amountMinor: money.amountMinor,
      subject: money.subject,
      // naming a person is clear; widening to a group, or leaving someone out, is confirmed first
      needsConfirm: scope !== "PEOPLE",
    };
  }

  // KEEP: for Clockwise only. Nothing is passed on.
  if (/\b(?:don'?t|do not|never)\s+(?:tell|let|say|mention|share)\b|\bkeep (?:this|it|that)\s+(?:private|secret|between us|to yourself)|\bbetween (?:us|you and me)\b|\bsecret\b/i.test(low)) return { type: "KEEP", secret: true };
  if (/^(?:just\s+)?(?:so you know|fyi|for your (?:info|information)|remember|keep in mind|note(?: down)?|make a note|jot down|just remember)\b/i.test(body) || /^(?:just\s+)?(?:remember|note)\b/i.test(body)) return { type: "KEEP", secret: false };

  return { type: "NONE" };
}
