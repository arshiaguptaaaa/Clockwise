// Deterministic pre-filter, applied BEFORE the (slow, costly) Gemini call —
// not a replacement for stay_silent, a narrower first gate in front of it.
// Catches only the cheapest, unambiguous "nothing for Clockwise to do here"
// bucket: pure reactions and closed-set filler words. Every message in that
// bucket is also directly checked for Clockwise address first, so a direct
// ask never gets silently dropped. Everything else — anything with real
// content, any ambiguity at all — still goes to Gemini, which keeps
// judging relevance via stay_silent exactly as before. This is
// deliberately conservative: false "let Gemini decide" is free (Gemini
// already handles it correctly); false "skip" would silently drop a real
// message, which is never acceptable.
const DIRECT_ADDRESS_RE = /\bclockwise\b/i;

// \p{Extended_Pictographic} covers emoji; \p{Emoji_Presentation} is a
// narrower subset included for completeness. Punctuation/whitespace
// alongside emoji is still "pure reaction" (e.g. "😂😂😂" or "!! 😭").
const PURE_EMOJI_RE = /^[\s!?.,~]*[\p{Extended_Pictographic}\p{Emoji_Presentation}\s!?.,~]+$/u;

const FILLER_WORDS = new Set([
  "lol", "lmao", "lmaoo", "lmaooo", "haha", "hahaha", "hahahaha", "omg",
  "ok", "okay", "k", "kk", "yes", "yep", "yeah", "no", "nah",
  "same", "true", "fr", "bet", "nice", "cool", "wow", "damn",
  "nvm", "oof", "lit", "facts", "real",
]);

function isPureFillerWords(content: string): boolean {
  const words = content
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0 || words.length > 3) return false;
  return words.every((w) => FILLER_WORDS.has(w));
}

export function isObviousNonTripChatter(content: string): boolean {
  const trimmed = content.trim();
  if (!trimmed) return false;
  if (DIRECT_ADDRESS_RE.test(trimmed)) return false; // never skip a direct address
  if (trimmed.length > 40) return false; // anything substantial goes to Gemini
  return PURE_EMOJI_RE.test(trimmed) || isPureFillerWords(trimmed);
}

// A message addressed to Clockwise ("@Clockwise …", "Clockwise, …") is a direct
// ask and must be answered. This is enforced in code — stay_silent is not even
// offered to the model for such a message — because a prompt rule alone was
// observed to be ignored ("I just answered this", when it had not).
export function isDirectlyAddressed(content: string): boolean {
  const t = content.trim();
  return /^@?clockwise\b/i.test(t) || /(^|\s)@clockwise\b/i.test(t);
}

// Group chat is human-first. A message that doesn't mention Clockwise at all is
// "unaddressed": Clockwise may quietly CAPTURE consequential facts from it (a
// route change, a personal time limit, a delay, money spent) but it may not
// propose, search, or reply. Enforced in code — the tool list is cut down and
// any text the model returns is dropped — because prompts alone were observed
// to be ignored ("guys dinner?" produced an unprompted dinner proposal).
export function mentionsClockwise(content: string): boolean {
  return /\bclockwise\b/i.test(content);
}

export const QUIET_CAPTURE_TOOLS = new Set([
  "stay_silent",
  "record_trip_understanding",
  "update_trip_route",
  "record_personal_constraint",
  "report_delay",
  "propose_expense",
  "update_my_arrival",
  "propose_commitment_reschedule",
  "note_trip_pointer",
]);

// A traveller saying their OWN journey changed. Clockwise may ask one short clarifying
// question about it (e.g. morning or evening?) even though nobody addressed it — a
// question is the only safe alternative to guessing, and silence would drop the update.
export function mentionsOwnJourneyChange(content: string): boolean {
  return /\b(land|landing|landed|arriv\w*|reach\w*|flight|train|bus|delayed|delay|late|running late|get in|getting in)\b/i.test(content);
}
