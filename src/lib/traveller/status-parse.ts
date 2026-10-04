// The small things people say about their own clock that are NOT "I'll land at 9":
//   "I'm still at baggage claim."                 landing did not mean ready
//   "Go ahead, I'll join you directly at dinner."  a different route, not a different time
//   "Actually, 8:15 is take-off, not landing."     the earlier number was read as the wrong thing
//   "Flight might be delayed, nothing confirmed."  tentative: never overwrites a confirmed arrival
//   "My flight was delayed last time too."         history: no current change
//   "Kal subah aaungi, aaj nahi."                  tomorrow morning, not today (Hindi/Hinglish)
// Pure and deterministic: the words are classified here; what they mean for the Plan is decided from stored state
// in status.ts. Anything not recognised returns null and follows the existing path untouched.
import { addDays, parseTime, type LocalNow } from "@/lib/when";

export type Stage = "baggage" | "immigration" | "customs" | "security" | "airport";
export type TravellerStatus =
  | { kind: "AT_AIRPORT"; stage: Stage }
  | { kind: "JOIN_DIRECT"; target: string | null }
  | { kind: "TAKEOFF_NOT_LANDING"; time: string | null; guessedMeridiem: boolean }
  | { kind: "TENTATIVE_DELAY" }
  | { kind: "HISTORICAL_DELAY" }
  | { kind: "REL_DAY"; date: string; part: "morning" | "afternoon" | "evening" | "night" | null; time: string | null; notToday: boolean };

const squash = (s: string) => s.replace(/[’‘]/g, "'").replace(/\s+/g, " ").trim();
const DELAYISH = /\b(delay(?:ed)?|late|postponed|pushed|rescheduled|cancel(?:l)?ed|diverted)\b/i;

export function parseTravellerStatus(raw: string, now: LocalNow): TravellerStatus | null {
  const t = squash(raw);
  if (!t || t.length > 220) return null;
  const low = t.toLowerCase();

  // ---- "8:15 is take-off, not landing"
  const takeoff =
    /\b(\d{1,2}(?:[:.]\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)?)\s*(?:is|was|'s)\s*(?:the\s*|my\s*)?(?:take[- ]?off|taking off|departure|departing)\b[^.?!]*\b(?:not|isn'?t|instead of|and not|rather than)\b[^.?!]*\b(?:landing|arrival|arriving|land)\b/i.exec(t) ??
    /\b(?:not|isn'?t|instead of|rather than)\s+(?:the\s*)?(?:landing|arrival)\b[^.?!]*\b(\d{1,2}(?:[:.]\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)?)\s*(?:is|was|'s)\s*(?:the\s*|my\s*)?(?:take[- ]?off|departure)\b/i.exec(t) ??
    /\b(?:that'?s|that is|i meant|meant)\s+(?:the\s*|my\s*)?(?:take[- ]?off|departure)\b[^.?!]*\b(?:not|isn'?t|instead of)\b[^.?!]*\b(?:landing|arrival)\b/i.exec(t);
  if (takeoff) {
    const stated = takeoff[1] ? parseTime(takeoff[1].replace(".", ":"), "flight") : null;
    return { kind: "TAKEOFF_NOT_LANDING", time: stated ? stated.time : null, guessedMeridiem: stated ? stated.guessedMeridiem : false };
  }

  // ---- history, tentative: both are recognised so they are NEVER turned into a change
  const pastDelay = /\b(?:was|were|got|has been|had been|have been|kept getting|always|keeps? getting)\b[^.?!]*\b(?:delayed|late|cancel(?:l)?ed|postponed)\b/i.test(t) || /\bdelayed\b[^.?!]*\b(?:last time|last trip|before|previously|last year|too|again)\b/i.test(t);
  if (/\b(?:last time|last trip|last year|previously|earlier this year|the other time|before too)\b/i.test(t) && DELAYISH.test(t) && pastDelay) return { kind: "HISTORICAL_DELAY" };
  const hedge = /\b(?:might|may|could|possibly|probably|likely|looks like it'?ll|seems like|fingers crossed|hopefully not)\b/i.test(t) || /\b(?:nothing|not)\s+(?:is\s+)?(?:confirmed|official|sure|certain|final)\b|\bnot confirmed\b|\bunconfirmed\b|\bnot sure (?:yet|if|whether)\b/i.test(t);
  if (hedge && DELAYISH.test(t) && /\b(flight|train|bus|plane|it|that)\b/i.test(t)) {
    // A firm time elsewhere in the message ("delayed, landing 9:15, might slip more") is a real update: leave it to the
    // arrival path. It is tentative only when no clock time is given, or the hedge is right in front of the time.
    const time = /\b\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)\b|\b\d{1,2}:\d{2}\b/i.exec(t);
    const hedged = time ? /\b(?:might|may|could|possibly|probably|likely|maybe|around|hopefully)\b[^.?!,;]{0,28}$/i.test(t.slice(0, time.index)) : true;
    if (!time || hedged) return { kind: "TENTATIVE_DELAY" };
  }

  // ---- still at the airport
  const still = /\b(?:still|stuck|waiting|yet to|haven'?t (?:got|received|collected)|not (?:got|out))\b/i.test(t);
  const place = /\b(baggage(?: claim| belt| area)?|luggage|bags?|carousel|belt)\b|\b(immigration)\b|\b(customs)\b|\b(security)\b|\b(airport|arrivals)\b/i.exec(t);
  if (place && still && /\b(i'?m|im|i am|we'?re|we are|me|my|our|stuck|waiting|still)\b/i.test(t) && !/\b(will|going to|about to|heading)\b.*\b(leave|go to|go|reach)\b/i.test(t)) {
    const w = (place[0] ?? "").toLowerCase();
    const stage: Stage = /bag|luggage|carousel|belt/.test(w) ? "baggage" : /immigration/.test(w) ? "immigration" : /customs/.test(w) ? "customs" : /security/.test(w) ? "security" : "airport";
    return { kind: "AT_AIRPORT", stage };
  }

  // ---- "I'll join you directly at dinner"
  const direct =
    /\b(?:i'?ll|i will|i'?m going to|i'?m gonna|imma|let me|i can|i'?ll just)\s+(?:just\s+)?(?:join|meet|see|catch)\s+(?:you|u|y'?all|you guys|you all|everyone|everybody|the group|the girls|them)\s+(?:directly|straight|right)?\s*(?:there\s+)?(?:at|for|in|from)?\s*(?:the\s+)?([a-z][a-z' -]{0,40})?/i.exec(t) ??
    /\b(?:i'?ll|i will|i'?m going to|i'?m gonna)\s+(?:come|go|head|be|reach)\s+(?:directly|straight)\s+(?:to|at)\s+(?:the\s+)?([a-z][a-z' -]{0,40})?/i.exec(t) ??
    /\b(?:directly|straight)\s+(?:to|at|for)\s+(?:the\s+)?(dinner|lunch|breakfast|brunch|restaurant|venue|party)\b/i.exec(t);
  if (direct && /\b(directly|straight|right at|there)\b/i.test(low) && /\b(join|meet|come|go|head|be|reach|dinner|lunch|restaurant|venue)\b/i.test(low)) {
    const rawTarget = (direct[1] ?? "").replace(/\b(directly|straight|there|instead|ok|okay|then|later)\b.*$/i, "").replace(/[.,!?].*$/, "").trim();
    const generic = !rawTarget || /^(there|here|it|you|them|everyone|the group|venue|restaurant|place|location)$/i.test(rawTarget);
    return { kind: "JOIN_DIRECT", target: generic ? null : rawTarget };
  }

  // ---- Hindi / Hinglish: "Kal subah aaungi, aaj nahi" / "parso aa jaunga" / "aaj raat 10 baje pahunchunga"
  const dayWord = /\b(kal|parso|parson|aaj|aj)\b/i.exec(t);
  const comes = /\b(aa(?:u|o)ng[aei]|aaunga|aaungi|aayeng[ei]|aayeg[ai]|aa jaung[ai]|aa jaunga|aa jaungi|pahunch(?:u|o)ng[aei]|pahuch(?:u|o)ng[aei]|pohch(?:u|o)ng[aei]|pohonch(?:u|o)ng[aei]|ponchunga|ponchungi|reach karung[ai]|land karung[ai]|land hoga|aana hai|aa rah[ai]|pahunchunga)\b/i.exec(low);
  if (dayWord && comes) {
    const w = dayWord[1].toLowerCase();
    const notToday = /\baaj\s+nahi+n?\b|\baj\s+nahi+n?\b|\bnot today\b/i.test(t);
    let date: string | null = null;
    if (w === "kal") date = addDays(now.date, 1);
    else if (w === "parso" || w === "parson") date = addDays(now.date, 2);
    else if ((w === "aaj" || w === "aj") && !notToday) date = now.date;
    // "kal ... aaj nahi" names tomorrow explicitly even though "aaj" appears.
    if (notToday && !date) date = /\bkal\b/i.test(t) ? addDays(now.date, 1) : /\bparso|parson\b/i.test(t) ? addDays(now.date, 2) : null;
    if (!date) return null;
    const part = /\bsubah|savere|morning\b/i.test(t) ? "morning" : /\bdopahar|afternoon\b/i.test(t) ? "afternoon" : /\bshaam|evening\b/i.test(t) ? "evening" : /\braat|night\b/i.test(t) ? "night" : null;
    // "10 baje" = 10 o'clock; the part of the day settles AM/PM. Anything else stays unknown: Clockwise asks.
    const baje = /\b(\d{1,2})(?::(\d{2}))?\s*baje\b/i.exec(t);
    let time: string | null = null;
    if (baje) {
      let h = Number(baje[1]);
      const m = baje[2] ? Number(baje[2]) : 0;
      if (h >= 1 && h <= 12 && m < 60) {
        if (part === "morning") h = h === 12 ? 0 : h;
        else if (part === "afternoon" || part === "evening" || part === "night") h = h === 12 ? 12 : h + 12;
        else h = -1; // no part of day: 10 baje could be either
        if (h >= 0) time = `${String(h % 24).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
      }
    } else {
      const explicit = parseTime(t, part ?? "");
      if (explicit && !explicit.guessedMeridiem) time = explicit.time;
    }
    return { kind: "REL_DAY", date, part, time, notToday };
  }

  return null;
}
