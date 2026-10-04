// "Find me good dosa places in Bengaluru." -> WHAT (dosa) · CATEGORY (restaurant) · WHERE (Bengaluru) · ANCHOR
// (explicitly stated). Deterministic: a place search must be driven by what the person SAID, never by a model's
// paraphrase and never by where they happen to be. An explicit place in the message beats everything else, and
// the anchors are never silently swapped (DESTINATION for ME, ME for DESTINATION, hotel for either).
import { parseDiscoveryQuery } from "./discovery-query";

export type AnchorSpec =
  | { kind: "me" }
  | { kind: "stay" }
  | { kind: "destination" }
  | { kind: "arrival"; person: string | null; airportText: string | null }
  | { kind: "explicit"; text: string };

export type Keyword = { word: string; category: string; synonyms: string[] };

// Dishes and cuisines that a category word alone doesn't capture. `synonyms` are the words that, found in a
// PROVIDER's own name or cuisine tag for a place, make it a genuine match. Nothing is assumed about a place whose
// data doesn't say so.
export const KEYWORDS: { re: RegExp; keyword: Keyword }[] = [
  { re: /\b(dosas?|dosai|masala dosa)\b/i, keyword: { word: "dosa", category: "restaurant", synonyms: ["dosa", "dosai", "dose", "udupi", "darshini", "south indian", "south_indian", "tiffin", "idli", "uttapam", "vada"] } },
  { re: /\b(idli|idlis|idly)\b/i, keyword: { word: "idli", category: "restaurant", synonyms: ["idli", "idly", "dosa", "udupi", "darshini", "south indian", "south_indian", "tiffin"] } },
  { re: /\bsouth[- ]indian\b/i, keyword: { word: "South Indian", category: "restaurant", synonyms: ["south indian", "south_indian", "dosa", "dosai", "udupi", "darshini", "idli", "tiffin", "andhra", "chettinad", "kerala", "tamil"] } },
  { re: /\b(biryani|biriyani)\b/i, keyword: { word: "biryani", category: "restaurant", synonyms: ["biryani", "biriyani", "hyderabadi", "dum"] } },
  { re: /\b(thali|thalis)\b/i, keyword: { word: "thali", category: "restaurant", synonyms: ["thali", "meals", "rajasthani", "gujarati"] } },
  { re: /\b(momos?)\b/i, keyword: { word: "momos", category: "restaurant", synonyms: ["momo", "tibetan", "chinese", "dumpling"] } },
  { re: /\b(street food|chaat|pani puri|golgappa)\b/i, keyword: { word: "street food", category: "restaurant", synonyms: ["chaat", "street", "puri", "golgappa", "bhel"] } },
  { re: /\b(pizza|pizzas)\b/i, keyword: { word: "pizza", category: "restaurant", synonyms: ["pizza", "italian"] } },
  { re: /\b(burgers?)\b/i, keyword: { word: "burgers", category: "restaurant", synonyms: ["burger"] } },
  { re: /\b(ice[- ]?cream|gelato|desserts?|sweets?|mithai)\b/i, keyword: { word: "dessert", category: "restaurant", synonyms: ["ice_cream", "ice cream", "dessert", "sweet", "mithai", "bakery", "gelato"] } },
  { re: /\b(filter coffee|south indian coffee)\b/i, keyword: { word: "filter coffee", category: "cafe", synonyms: ["filter", "coffee", "udupi", "darshini", "south indian"] } },
  { re: /\b(bakery|bakeries)\b/i, keyword: { word: "bakery", category: "cafe", synonyms: ["bakery", "bakers", "cake", "patisserie"] } },
];

export type PlaceIntent = {
  raw: string;
  what: string | null; // the dish/cuisine word, if any
  keyword: Keyword | null;
  category: string | null; // restaurant | cafe | attraction | shopping | …
  diet: "vegetarian" | "vegan" | "halal" | null;
  anchor: AnchorSpec;
  defaulted: boolean; // no place was named at all
  nearWho: string | null;
};

const FILLER = /^(?:hey |hi |ok |okay |so |and |also |now |pls |please |can you |could you |can we |will you )+/i;

function stripAddress(raw: string) {
  return raw
    .replace(/(^|\s)@[\p{L}][\p{L}'’-]*/gu, " ")
    .replace(/\bclockwise\b[,:]?/i, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(FILLER, "")
    .trim();
}

// WHERE the person said to search, from most to least specific.
export function parseAnchor(text: string): { anchor: AnchorSpec; defaulted: boolean; nearWho: string | null } {
  const t = text.replace(/[?!.]+$/, "");

  // Another traveller's arrival point: "near where Ridhima lands".
  const whereLands = /\b(?:near|around|by|at|close to|from)\s+where\s+([A-Za-z][\w'-]*)\s+(?:lands?|landing|arrives?|arriving|reach(?:es)?|gets in|is landing|will land|will arrive)\b/i.exec(t);
  if (whereLands) {
    const who = whereLands[1];
    return { anchor: { kind: "arrival", person: /^(i|we)$/i.test(who) ? null : who, airportText: null }, defaulted: false, nearWho: /^(i|we)$/i.test(who) ? null : who };
  }
  const possessiveArrival = /\b(?:near|around|by|close to)\s+([A-Za-z][\w'-]*)['’]s\s+(?:arrival|airport|landing|flight|station)\b/i.exec(t);
  if (possessiveArrival) return { anchor: { kind: "arrival", person: possessiveArrival[1], airportText: null }, defaulted: false, nearWho: possessiveArrival[1] };

  // The speaker's own current location (needs browser permission, decided elsewhere).
  if (/\b(?:near|around|close to|beside|by|next to)\s+(?:me|myself|my location|where i am|where i'?m at|my current location)\b/i.test(t) || /^(?:what'?s|whats|anything|any(?:thing)?)\s+(?:good\s+)?(?:near ?by|close ?by|around here|around me|near me)\b/i.test(t) || /\bnear ?by\b\s*$/i.test(t) || /\bnear me\b/i.test(t) || /\baround here\b/i.test(t)) {
    return { anchor: { kind: "me" }, defaulted: false, nearWho: null };
  }

  // The group's confirmed stay.
  if (/\b(?:near|around|by|close to|at|from|in)\s+(?:our|the|my)\s+(?:hotel|stay|place|accommodation|airbnb|hostel|resort|homestay|villa|apartment)\b/i.test(t) || /\b(?:near|around|close to)\s+(?:us|our stay)\b/i.test(t) || /\bwhere we(?:'re| are) staying\b/i.test(t)) {
    return { anchor: { kind: "stay" }, defaulted: false, nearWho: null };
  }

  // An airport or station: the speaker's confirmed arrival, named or not.
  const airport = /\b(?:near|around|by|at|close to|from)\s+(?:the\s+|my\s+)?((?:[A-Za-z]+\s+)?(?:international\s+|domestic\s+)?(?:airport|station|terminal))\b/i.exec(t);
  if (airport) {
    const text0 = airport[1].replace(/^(the|my)\s+/i, "").trim();
    const named = /^(airport|station|terminal)$/i.test(text0) ? null : text0;
    return { anchor: { kind: "arrival", person: null, airportText: named }, defaulted: false, nearWho: null };
  }
  if (/\b(?:near|around|by|close to)\s+(?:my|the)\s+arrival\b/i.test(t) || /\bwhere i land\b/i.test(t)) return { anchor: { kind: "arrival", person: null, airportText: null }, defaulted: false, nearWho: null };

  if (/\b(?:near|around|in|at|close to|by)\s+(?:our|the)\s+destination\b/i.test(t)) return { anchor: { kind: "destination" }, defaulted: false, nearWho: null };

  // A named place: "in Bengaluru", "around Cubbon Park", "near Indiranagar", "in Gurgaon".
  const explicit = /\b(?:in|near|around|at|by|close to|within|inside|of)\s+(.+?)\s*(?:$|\s+(?:for|with|that|which|please|pls|tonight|today|tomorrow|this|on)\b)/i.exec(t);
  if (explicit && explicit[1] && !/^(me|us|here|there|the area|town|the city)$/i.test(explicit[1].trim())) {
    return { anchor: { kind: "explicit", text: explicit[1].trim().replace(/^(the)\s+/i, "") }, defaulted: false, nearWho: null };
  }
  return { anchor: { kind: "destination" }, defaulted: true, nearWho: null };
}

export function parsePlaceIntent(raw: string): PlaceIntent {
  const text = stripAddress(raw);
  const kw = KEYWORDS.find((k) => k.re.test(text))?.keyword ?? null;
  const base = parseDiscoveryQuery(text);
  const diet: PlaceIntent["diet"] = /\bvegan\b/i.test(text) ? "vegan" : /\b(vegetarian|veg|pure veg)\b/i.test(text) ? "vegetarian" : /\bhalal\b/i.test(text) ? "halal" : null;
  const { anchor, defaulted, nearWho } = parseAnchor(text);
  // "things to do around Cubbon Park" / "coffee near Indiranagar": the category word decides WHAT; the leftover
  // place decides WHERE (already read above).
  const category = kw?.category && !base.category ? kw.category : base.category ?? kw?.category ?? null;
  return { raw, what: kw?.word ?? null, keyword: kw, category, diet, anchor, defaulted, nearWho };
}

// Does this message ask for places at all? (used by the router before any model call)
export function isPlaceSearch(raw: string): boolean {
  const text = stripAddress(raw);
  if (!text) return false;
  const i = parsePlaceIntent(raw);
  if (!i.category && !i.keyword) return /^(what'?s|whats)\s+(near|nearby|around|close)/i.test(text);
  // A statement ("I love coffee") is not a search. A search asks, finds, shows or names a place to look in.
  const asks = /\b(find|show|search|suggest|recommend|looking for|look for|where|any|what|which|got|get us|take us|options|spots?|places?|near|around|nearby|in\s+[A-Z])\b/i.test(text) || /\?$/.test(text.trim());
  const statement = /^(i|we|i'?m|i am)\s+(love|like|want|need|am|have|really)\b/i.test(text);
  return asks && !statement;
}
