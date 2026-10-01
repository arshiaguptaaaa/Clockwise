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
