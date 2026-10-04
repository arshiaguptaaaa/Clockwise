// "coffee in Gurgaon", "shopping in Bangalore", "things to do near Indiranagar": deterministic parsing of a plain
// discovery request into WHAT (a category) and WHERE (a named place). No model, and no preference or Vibe Check
// answer is consulted: what exists is decided by the place and the category alone.
export type DiscoveryQuery = { category: string | null; place: string | null };

// Longest phrases first so "things to do" is not read as something else.
const CATEGORY_WORDS: [RegExp, string][] = [
  [/\b(things? to do|what to do|attractions?|sight ?seeing|sights|places? to (visit|see)|tourist (spots?|places?)|activities)\b/i, "attraction"],
  [/\b(coffee( ?shops?)?|cafes?|cafés?|espresso|chai)\b/i, "cafe"],
  [/\b(shopping|shops?|malls?|boutiques?|markets?|retail|clothes)\b/i, "shopping"],
  [/\b(restaurants?|food|eat(ing)?|dinner|lunch|breakfast|brunch|dining|where to eat)\b/i, "restaurant"],
  [/\b(pharmac(y|ies)|chemists?|medicine)\b/i, "pharmacy"],
  [/\b(atms?|cash machines?)\b/i, "atm"],
  [/\b(supermarkets?|grocer(y|ies))\b/i, "supermarket"],
  [/\b(convenience( stores?)?|corner shops?)\b/i, "convenience"],
  [/\b(parks?|gardens?|nature|green space)\b/i, "park"],
  [/\b(museums?|galler(y|ies))\b/i, "museum"],
  [/\b(nightlife|bars?|pubs?|clubs?|drinks)\b/i, "nightlife"],
];

export function parseDiscoveryQuery(raw: string): DiscoveryQuery {
  const text = raw.trim().replace(/\s+/g, " ").replace(/[?.!]+$/, "");
  if (!text) return { category: null, place: null };
  let category: string | null = null;
  let matched: RegExpExecArray | null = null;
  for (const [re, key] of CATEGORY_WORDS) {
    const m = re.exec(text);
    if (m) {
      category = key;
      matched = m;
      break;
    }
  }
  // WHERE: whatever follows in / near / around / at / by, else (when there is no category word) the whole text.
  const where = /\b(?:in|near|around|at|by|close to|nearby)\s+(.+)$/i.exec(text);
  let place = where ? where[1].trim() : null;
  if (!place && !category) place = text;
  // "Gurgaon coffee" / "Bangalore cafes": the leftover words around the category word are the place.
  if (!place && category && matched) {
    const rest = (text.slice(0, matched.index) + " " + text.slice(matched.index + matched[0].length)).replace(/\b(best|good|nice|some|any|the|a|find|show|me|search|for|please)\b/gi, " ").replace(/\s+/g, " ").trim();
    place = rest || null;
  }
  if (place) place = place.replace(/^(the|a)\s+/i, "").trim() || null;
  return { category, place };
}
