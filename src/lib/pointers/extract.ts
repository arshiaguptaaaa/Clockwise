// What Clockwise PICKS UP from ordinary talk, without being asked and without replying. Deterministic and
// conservative: only things a traveller said about THEMSELVES or plainly named as wanted ("I'm vegetarian",
// "I need proper dosa", "Cubbon Park is non-negotiable"). A passing mood ("I love coffee right now") or anything
// about someone else is left alone, and nothing sensitive is inferred. These become PASSIVE POINTERS: memory,
// never a plan item.
export type PointerKind = "DIET" | "LIKE" | "WANT" | "MUST" | "AVOID" | "WINDOW" | "MEET";
export type ExtractedPointer = { kind: PointerKind; subject: string; label: string };

const clean = (s: string) => s.toLowerCase().replace(/\s+/g, " ").replace(/^[\s,.:;!-]+|[\s,.:;!?-]+$/g, "").trim();
const titleish = (s: string) => s.replace(/\b([a-z])/g, (c) => c.toUpperCase());

const DIETS: [RegExp, string][] = [
  [/\b(?:pure\s+)?veg(?:etarian)?\b/, "vegetarian"],
  [/\bvegan\b/, "vegan"],
  [/\bjain\b/, "jain"],
  [/\beggetarian\b/, "eggetarian"],
  [/\bpescatarian\b/, "pescatarian"],
];

// Words that make a "like/want" a mood of the moment rather than something about the trip.
const TRANSIENT = /\b(right now|at the moment|currently|today only|this minute|rn)\b/i;
// Subjects that are not things to want ("it", "this", "you", "that").
const EMPTY_SUBJECT = /^(it|this|that|these|those|you|her|him|them|us|everything|anything|nothing|something|to|a|the|so much|more)$/i;

const FOODISH = /\b(dosa|dosai|idli|vada|biryani|thali|filter coffee|coffee|chai|tea|food|brunch|breakfast|lunch|dinner|cake|dessert|ice cream|pizza|momos?|chaat|paratha|south indian|north indian|street food|sweets?|pani puri|kebabs?|curry|noodles|ramen|sushi|burger|sandwich|cafe|café)\b/i;

function trimSubject(raw: string): string | null {
  let s = clean(raw)
    .replace(/\b(when|while|once|if|since|because|but|and then|so that|btw|lol|haha|though|tho|honestly|pls|please|too|also|as well|at some point|some ?time|someday|one day|soon|later|there|before we leave)\b.*$/i, "")
    .replace(/^(some|a few|a bit of|the|a|an|really good|proper|good|great|best|authentic|some proper)\s+/i, "")
    .replace(/\s+(in|at|around|near)\s+(bangalore|bengaluru|the city|town|india)$/i, "");
  s = clean(s);
  if (!s || EMPTY_SUBJECT.test(s) || s.split(" ").length > 5) return null;
  return s;
}

export function extractPointers(text: string): ExtractedPointer[] {
  const t = text.replace(/[“”]/g, '"').replace(/’/g, "'").trim();
  if (!t || t.length > 280) return [];
  const out: ExtractedPointer[] = [];
  const add = (p: ExtractedPointer) => {
    if (!out.some((o) => o.kind === p.kind && o.subject === p.subject)) out.push(p);
  };

  // ---- DIET
  const diet = /\b(?:i'?m|i am|im|i'm a|i'm strictly|i am strictly|strictly|i eat only|i only eat)\s+(?:a\s+|an\s+)?(?:pure\s+|strict\s+|strictly\s+)?(veg(?:etarian)?|vegan|jain|eggetarian|pescatarian)\b/i.exec(t) ?? /\bi (?:don'?t|do not|never) eat (?:meat|non[- ]?veg|chicken|fish|eggs?)\b/i.exec(t);
  if (diet) {
    const raw = diet[1] ?? "vegetarian";
    const found = DIETS.find(([re]) => re.test(raw.toLowerCase()))?.[1] ?? "vegetarian";
    add({ kind: "DIET", subject: found, label: found === "vegetarian" ? "is vegetarian" : found === "vegan" ? "is vegan" : `eats ${found}` });
  }

  if (TRANSIENT.test(t)) return out;

  // ---- WANT (first person, about the trip)
  const want = /\bi\s+(?:really |just |also |still |definitely |absolutely |actually )*(?:want|wanna|need|would love|'d love|would like|'d like|gotta have|have to have|must have|am dying)(?:\s+to)?\s+(?:(?:have|try|eat|get|see|visit|do|go to|go see|check out|go|find|hit)\s+)?(.+)$/i.exec(t);
  if (want) {
    const subject = trimSubject(want[1]);
    if (subject) add({ kind: "WANT", subject, label: FOODISH.test(subject) ? `wants to try ${subject}` : `wants ${/^[a-z]/.test(subject) ? "to see " : ""}${titleish(subject)}`.replace("to see ", "to visit ") });
  }

  // ---- LIKE
  const like = /\bi\s+(?:really |absolutely |totally |just |also )*(?:love|like|enjoy|adore|am into|'m into|am obsessed with|'m obsessed with)\s+(.+)$/i.exec(t);
  if (like) {
    const subject = trimSubject(like[1]);
    if (subject) add({ kind: "LIKE", subject, label: `likes ${subject}` });
  }

  // ---- AVOID
  const avoid = /\bi\s+(?:really |absolutely )*(?:hate|dislike|can'?t stand|don'?t like|do not like)\s+(.+)$/i.exec(t);
  if (avoid) {
    const subject = trimSubject(avoid[1]);
    if (subject) add({ kind: "AVOID", subject, label: `isn't keen on ${subject}` });
  }

  // ---- MUST ("X is non-negotiable", "we have to do X", "X is a must")
  const must = /^(.+?)\s+(?:is|are)\s+(?:non[- ]?negotiable|a must|a must[- ]do|compulsory|mandatory|happening)\b/i.exec(t) ?? /\b(?:we (?:have|need|gotta|must) to|we must|we gotta)\s+(?:do|see|visit|go to|try|have)?\s*(.+)$/i.exec(t);
  if (must) {
    const subject = trimSubject(must[1]);
    if (subject) add({ kind: "MUST", subject, label: `says ${titleish(subject)} is a must` });
  }

  // ---- A place named in passing: "Cubbon Park also pls", "also Cubbon Park!", "Cubbon Park?"
  const proper = "[A-Z][\\w'-]+(?: (?:of |de |the )?[A-Z][\\w'-]+){0,3}";
  const placeAlso = new RegExp(`^(?:also\\s+)?(${proper})\\s+(?:also|too|as well)?\\s*(?:pls|please|plz|yes|\\?|!)*\\s*$`).exec(t.replace(/[.!]+$/, ""));
  const placeQ = new RegExp(`^(${proper})\\s*\\?+$`).exec(t);
  const m = placeQ ?? placeAlso;
  if (m && !out.length) {
    const subject = clean(m[1]);
    if (subject && subject.split(" ").length <= 4 && !/^(yes|yeah|yep|okay|ok|lol|haha|same|sure|true|wow|hmm|nice|cool)$/i.test(subject)) {
      add({ kind: "WANT", subject, label: `mentioned ${titleish(subject)}` });
    }
  }
  const dLove = new RegExp(`\\bi'?d love (${proper})\\b`).exec(t);
  if (dLove) add({ kind: "WANT", subject: clean(dLove[1]), label: `would love ${titleish(clean(dLove[1]))}` });

  // ---- MEET: a physical place the group is gathering ("meet us at Church Street"). It can act as the group anchor
  // when there is no confirmed stay, so it needs a proper place name, not a vague word.
  const meet = /\b[Mm]eet(?:ing)?(?:\s+(?:us|me|up|everyone|them))?\s+(?:at|in|near|by|outside)\s+((?:the\s+)?[A-Z][\w'’-]*(?:\s+(?:of\s+|de\s+|the\s+)?[A-Z0-9][\w'’-]*){0,4})/.exec(t);
  if (meet) {
    const subject = clean(meet[1].replace(/^the\s+/i, ""));
    if (subject && subject.split(" ").length <= 5) add({ kind: "MEET", subject, label: `is meeting at ${titleish(subject)}` });
  }

  // ---- WINDOW ("Saturday evening let's keep free", "keep Sunday open")
  const win = /\b(?:let'?s |lets |we should |can we |pls |please )?(?:keep|leave|save)\s+(.+?)\s+(?:free|open|empty|unplanned|relaxed)\b/i.exec(t) ?? /^(.+?)\s+(?:let'?s|lets|we should|pls|please)\s+(?:keep|leave)(?: it)?\s+(?:free|open|empty)\b/i.exec(t);
  if (win) {
    const subject = clean(win[1]);
    if (subject && subject.split(" ").length <= 4) add({ kind: "WINDOW", subject, label: `wants to keep ${titleish(subject)} open` });
  }

  return out;
}

// "Same", "yes!", "me too", "100%": agreement with whatever was just said. It SUPPORTS the previous pointer; it
// is never a plan item and never permission.
export function isAgreement(text: string): boolean {
  const t = text.toLowerCase().replace(/[^\p{L}\p{N}\s%]/gu, " ").replace(/\s+/g, " ").trim();
  if (!t || t.split(" ").length > 4) return /^[\s\p{Extended_Pictographic}]*$/u.test(text) && /[\u{1F525}\u{1F64C}\u{2764}\u{1F60D}\u{1F44D}]/u.test(text);
  return /^(y+e+s+|ye+p+|yu+p+|yea+h?|ya+|yass+|same|me too|same here|100|100%|definitely|absolutely|obviously|for sure|sure|sounds good|sounds great|let s do it|im in|i m in|count me in|so down|down|haan|bilkul|pls yes|yes pls|yes please|yes yes)$/.test(t);
}

// Soft consensus needs the earlier message to have floated something worth agreeing with.
export function isFloat(text: string): boolean {
  return /\?\s*$/.test(text.trim()) || /\b(should we|shall we|how about|what about|let'?s)\b/i.test(text);
}
