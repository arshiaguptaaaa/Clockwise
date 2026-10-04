// Turns the words people actually type ("tomorrow at 8", "Saturday at 4", "dinner at 9 instead") into an exact
// local date and time. Done in code, not by the model: a language model asked to do "tomorrow + 1" gets the
// day wrong often enough to move a dinner to the wrong evening.
//
// Plan times are WALL-CLOCK local to the trip (stored as a Date with a trailing Z, never converted), and every
// trip so far is in India, so "now" is read as Asia/Kolkata (+05:30, no daylight saving).
const IST_OFFSET_MIN = 330;

export type LocalNow = { date: string; time: string; weekday: number; minutes: number };

const pad = (n: number) => String(n).padStart(2, "0");

export function localNow(now: Date = new Date()): LocalNow {
  const d = new Date(now.getTime() + IST_OFFSET_MIN * 60_000);
  return {
    date: `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`,
    time: `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`,
    weekday: d.getUTCDay(),
    minutes: d.getUTCHours() * 60 + d.getUTCMinutes(),
  };
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export function weekdayOf(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const WEEKDAY_SHORT = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

export type DayWindow = { start?: string | null; end?: string | null };

export type ParsedDay = { date: string; matched: string; relative: "today" | "tomorrow" | "weekday" | "explicit" };

// WHICH DAY the text names, plus the exact words that named it (so the caller can strip them from the title).
// A weekday names the next such day; when the trip hasn't started yet it names the first one INSIDE the trip, so
// "Saturday afternoon" planned in October for a December trip means the trip's Saturday.
export function parseDay(text: string, now: LocalNow, window: DayWindow = {}): ParsedDay | null {
  const t = text.toLowerCase();

  const iso = /\b(20\d{2})-(\d{2})-(\d{2})\b/.exec(t);
  if (iso) return { date: iso[0], matched: iso[0], relative: "explicit" };

  if (/\bday after tomorrow\b/.test(t)) return { date: addDays(now.date, 2), matched: "day after tomorrow", relative: "explicit" };
  const tmr = /\b(tomorrow'?s?|tmrw|tmr)\b/.exec(t);
  if (tmr) return { date: addDays(now.date, 1), matched: tmr[0], relative: "tomorrow" };
  const tod = /\b(today'?s?|tonight|this evening|this afternoon|this morning)\b/.exec(t);
  if (tod) return { date: now.date, matched: tod[0], relative: "today" };

  const monthRe = MONTHS.map((m) => m.slice(0, 3)).join("|");
  const dm = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(${monthRe})[a-z]*\\b`).exec(t);
  const md = new RegExp(`\\b(${monthRe})[a-z]*\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`).exec(t);
  const explicit = dm ? { day: Number(dm[1]), mon: MONTHS.findIndex((m) => m.startsWith(dm[2])), matched: dm[0] } : md ? { day: Number(md[2]), mon: MONTHS.findIndex((m) => m.startsWith(md[1])), matched: md[0] } : null;
  if (explicit && explicit.day >= 1 && explicit.day <= 31 && explicit.mon >= 0) {
    const nowYear = Number(now.date.slice(0, 4));
    let candidate = `${nowYear}-${pad(explicit.mon + 1)}-${pad(explicit.day)}`;
    if (candidate < now.date) candidate = `${nowYear + 1}-${pad(explicit.mon + 1)}-${pad(explicit.day)}`;
    // "Monday 5 Oct" / "5 Oct, Monday": the weekday is part of the date phrase, so it must not be left behind
    // (and end up in the name of whatever is being added).
    const wdAlt = [...WEEKDAYS, ...WEEKDAY_SHORT].join("|");
    const esc = explicit.matched.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const whole = new RegExp(`(?:\\b(?:${wdAlt})\\.?,?\\s+)?${esc}(?:,?\\s+(?:${wdAlt})\\b)?`, "i").exec(text);
    return { date: candidate, matched: whole?.[0] ?? explicit.matched, relative: "explicit" };
  }

  const wdRe = new RegExp(`\\b(?:(this|next|coming)\\s+)?(${WEEKDAYS.join("|")}|${WEEKDAY_SHORT.join("|")})\\b`);
  const wd = wdRe.exec(t);
  if (wd) {
    const idx = WEEKDAYS.findIndex((w, i) => w === wd[2] || WEEKDAY_SHORT[i] === wd[2]);
    // Anchor the search at the trip's first day when the trip is still ahead, else at today.
    const anchor = window.start && window.start > now.date ? window.start : now.date;
    let date = anchor;
    for (let i = 0; i < 7 && weekdayOf(date) !== idx; i++) date = addDays(date, 1);
    if (wd[1] === "next" && anchor === now.date) date = addDays(date, 7);
    return { date, matched: wd[0], relative: "weekday" };
  }
  return null;
}

export type ParsedTime = { time: string; matched: string; guessedMeridiem: boolean };

// WHAT TIME the text names. `hint` is the activity ("dinner", "breakfast", "coffee") and settles "at 8" the way a
// person would: dinner at 8 is 8 PM, breakfast at 8 is 8 AM. The result says when it had to guess.
export function parseTime(text: string, hint = ""): ParsedTime | null {
  const t = text.toLowerCase();
  if (/\bnoon\b/.test(t)) return { time: "12:00", matched: "noon", guessedMeridiem: false };
  if (/\bmidnight\b/.test(t)) return { time: "00:00", matched: "midnight", guessedMeridiem: false };

  const mer = /\b(\d{1,2})(?:[:.](\d{2}))?\s*(a\.?m\.?|p\.?m\.?)\b/.exec(t);
  if (mer) {
    let h = Number(mer[1]);
    const m = mer[2] ? Number(mer[2]) : 0;
    if (h < 1 || h > 12 || m > 59) return null;
    const pm = mer[3].startsWith("p");
    h = (h % 12) + (pm ? 12 : 0);
    return { time: `${pad(h)}:${pad(m)}`, matched: mer[0], guessedMeridiem: false };
  }
  const h24 = /\b([01]?\d|2[0-3]):([0-5]\d)\b/.exec(t);
  // 13:00-23:59 and 0X:XX are unmistakably 24-hour. "9:15" is not: it still needs its meridiem from the words.
  if (h24 && (Number(h24[1]) > 12 || /^0\d/.test(h24[1]) || Number(h24[1]) === 12 || Number(h24[1]) === 0)) return { time: `${pad(Number(h24[1]))}:${h24[2]}`, matched: h24[0], guessedMeridiem: false };

  // Bare hour: "at 8", "to 10", "for 9".
  const bare = /\b(?:at|to|for|around|by|till|until|@)\s+(\d{1,2})(?:[:.](\d{2}))?\b/.exec(t) ?? /\b(\d{1,2})(?:[:.](\d{2}))?\s*(?:o'?clock|oclock|ish)\b/.exec(t) ?? (h24 ? ([h24[0], h24[1], h24[2]] as unknown as RegExpExecArray) : null);
  if (bare) {
    let h = Number(bare[1]);
    const m = bare[2] ? Number(bare[2]) : 0;
    if (h < 1 || h > 12 || m > 59) return null;
    const h0 = h;
    const word = `${hint} ${t}`;
    const evening = /\b(dinner|supper|night|tonight|evening|party|drinks|show|movie|birthday)\b/.test(word);
    const morning = /\b(breakfast|brunch|morning|sunrise|early)\b/.test(word);
    const lunch = /\blunch\b/.test(word);
    if (morning && h >= 5 && h <= 11) h = h0;
    else if (lunch) h = h0 >= 11 || h0 === 12 ? h0 % 12 || 12 : h0 + 12;
    else if (evening && h >= 4 && h <= 11) h = h0 + 12;
    else if (h0 >= 1 && h0 <= 6) h = h0 + 12; // coffee at 5, a walk at 4
    else if (h0 === 12) h = 12;
    return { time: `${pad(h)}:${pad(m)}`, matched: bare[0], guessedMeridiem: true };
  }
  return null;
}

export const stripMatched = (text: string, ...parts: (string | undefined)[]) => {
  let out = text;
  for (const p of parts) if (p) out = out.replace(new RegExp(p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"), " ");
  return out.replace(/\s+/g, " ").trim();
};

// "Tue 6 Oct, 8:00 PM" - the form read back to the person so a wrong day is caught on sight.
export function humanMoment(local: string): string {
  const d = new Date(`${local.slice(0, 10)}T00:00:00Z`);
  const wd = d.toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" });
  const dm = d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
  const h = Number(local.slice(11, 13));
  const m = local.slice(14, 16);
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${wd} ${dm}, ${hh}:${m} ${h >= 12 ? "PM" : "AM"}`;
}
