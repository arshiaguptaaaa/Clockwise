// "Guys, my flight's delayed. I'll reach around 9:15 tonight." -> the speaker's OWN new arrival, read in code.
// Only first-person statements count ("I'll reach", "my flight lands"); a message about someone else, or one whose
// time can't be told from the words (morning or evening?), returns null / ambiguous and the model asks ONE short
// question instead of guessing.
import { parseTime } from "@/lib/when";
import { parseDay, type LocalNow, type DayWindow } from "@/lib/when";

export type OwnArrival =
  | { kind: "time"; arrivalTime: string; arrivalDate?: string }
  // "I'll reach the hotel around 10": when they will be AT the anchor, not when they land.
  | { kind: "ready"; readyTime: string; readyDate?: string }
  // "I'm landing at HAL airport now": a different arrival point (a time may come with it).
  | { kind: "place"; place: string; arrivalTime?: string; arrivalDate?: string }
  | { kind: "ambiguous" };

const SUBJECT = /\b(?:i'?ll|i will|i'?m going to|i am|i'?m|im|we'?ll|we will|we are|we'?re|my (?:flight|train|bus|cab|plane)(?:'s| is)?|our (?:flight|train|bus)(?:'s| is)?|flight|train|bus)\b/i;
const VERB = /\b(?:reach(?:ing|es)?|land(?:ing|s|ed)?|arriv(?:e|es|ing)|get(?:ting|s)? in|be there|be in|be at|touch ?down|gets? to|get to)\b/i;

export function parseOwnArrival(text: string, now: LocalNow, window: DayWindow = {}): OwnArrival | null {
  const t = text.replace(/\s+/g, " ").trim();
  if (!t || t.length > 300) return null;
  // Work sentence by sentence so "my flight's delayed. I'll reach around 9:15" still pairs subject, verb and time.
  // Where they arrive changed ("now landing at Hyderabad airport").
  const placeChange = /\b(?:now |instead |actually )?(?:land(?:ing|s)?|arriv(?:e|es|ing)|reach(?:ing)?|get(?:ting)? in)\b[^.?!]*?\b(?:at|in|into)\s+(?:the\s+)?([A-Za-z][A-Za-z .'-]{2,40}?\s(?:airport|station|terminal|junction))\b/i.exec(t) ?? /\b(?:airport|station)\s+(?:has\s+)?changed\s+to\s+([A-Za-z][A-Za-z .'-]{2,40}?)(?:[.!?,]|$)/i.exec(t);
  if (placeChange && /\b(my|i|we|our|i'?m|i'?ll|landing|arriving|now)\b/i.test(t)) {
    const time = parseTime(t.replace(placeChange[0], " "), t);
    return { kind: "place", place: placeChange[1].trim(), ...(time && !time.guessedMeridiem ? { arrivalTime: time.time } : {}) };
  }
  // When they will be AT the hotel / stay / venue: "I'll reach the hotel around 10".
  const ready = /\b(?:i'?ll|i will|i'?m going to|we'?ll|we will)\s+(?:reach|be at|get to|be in|be)\s+(?:the\s+)?(?:hotel|stay|place|venue|restaurant|there|dinner)\b([^.?!]*)/i.exec(t);
  if (ready) {
    const time = parseTime(ready[1], t);
    if (time) {
      const hasHint = /\b(tonight|evening|night|morning|afternoon|noon|am|pm)\b/i.test(t);
      if (time.guessedMeridiem && !hasHint) return { kind: "ambiguous" };
      const day = /\b(tomorrow|tmrw|monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d{4}-\d{2}-\d{2})\b/i.test(t) ? parseDay(t, now, window) : null;
      return { kind: "ready", readyTime: time.time, ...(day ? { readyDate: day.date } : {}) };
    }
  }
  const sentences = t.split(/(?<=[.!?])\s+|\s+(?:and|but|so)\s+(?=i\b|we\b)/i);
  for (const s of sentences) {
    if (!VERB.test(s)) continue;
    // "landing at 8:15 instead" has no subject word: a bare gerund in chat is the speaker's own.
    const subj = SUBJECT.exec(s) ?? SUBJECT.exec(t) ?? /^\s*(?:now |ok |so |guys,? )?(?:landing|reaching|arriving|getting in)\b/i.exec(s);
    if (!subj) continue;
    // Someone else named as the one arriving: "Ridhima will reach at 9".
    if (/^\s*[A-Z][a-z]+\s+(?:will|is|has|'ll)\s/.test(s) && !/^\s*(I|We|My|Our)\b/.test(s)) continue;
    const afterVerb = s.slice(VERB.exec(s)!.index);
    const hasHint = /\b(tonight|evening|night|morning|afternoon|noon|am|pm|a\.m\.|p\.m\.)\b/i.test(t);
    const time = parseTime(afterVerb, t);
    if (!time) continue;
    if (time.guessedMeridiem && !hasHint) return { kind: "ambiguous" };
    const day = /\b(tomorrow|tmrw|day after|monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d{4}-\d{2}-\d{2})\b/i.test(t) ? parseDay(t, now, window) : null;
    return { kind: "time", arrivalTime: time.time, ...(day ? { arrivalDate: day.date } : {}) };
  }
  return null;
}
