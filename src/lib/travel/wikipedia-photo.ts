// Real, live destination photography for any place name — keyless, no
// config required. Anchored to a real Wikipedia article (not a stock-photo
// keyword search), so a returned photo is genuinely of the place asked
// about, never a loosely-matched stock photo. Audited during R3 hardening:
// Geoapify's /v2/place-details wiki_and_media.image field was tested live
// and found unreliable (present for a specific landmark like the Eiffel
// Tower, absent for a whole city like Prague) — Wikipedia's own summary
// API was tested live instead and reliably returns a real photo for both.
// Returns null (never a fabricated/generic image) when nothing legitimate
// is found — callers must treat that as "no photo available", the same
// graceful-omission behavior already used for DESTINATION_PHOTOS misses.
const SUMMARY_URL = (title: string) =>
  `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
const SEARCH_URL = (query: string) =>
  `https://en.wikipedia.org/w/api.php?action=query&list=search&srlimit=1&format=json&srsearch=${encodeURIComponent(query)}`;

const USER_AGENT_HEADERS = {
  // Wikimedia's API etiquette policy requires a descriptive User-Agent —
  // requests without one are throttled/blocked.
  "User-Agent": "Clockwise/1.0 (trip-coordination app; live destination photos)",
};

export type WikipediaPhoto = {
  src: string;
  alt: string;
  credit: string;
  articleUrl: string;
};

type WikipediaSummaryResponse = {
  title?: string;
  thumbnail?: { source: string };
  originalimage?: { source: string };
  content_urls?: { desktop?: { page?: string } };
};

type WikipediaSearchResponse = {
  query?: { search?: { title: string }[] };
};

async function fetchSummary(title: string): Promise<WikipediaPhoto | null> {
  const res = await fetch(SUMMARY_URL(title), { headers: USER_AGENT_HEADERS });
  if (!res.ok) return null;

  const data = (await res.json()) as WikipediaSummaryResponse;
  const image = data.originalimage ?? data.thumbnail;
  if (!image?.source) return null;

  return {
    src: image.source,
    alt: data.title ?? title,
    // Named-photographer attribution (like DESTINATION_PHOTOS' hand-
    // curated credits) would need a second Commons imageinfo/extmetadata
    // call this endpoint doesn't provide — linking to the source article
    // is the honest, verifiable attribution available from this API.
    credit: "Wikipedia",
    articleUrl: data.content_urls?.desktop?.page ?? `https://en.wikipedia.org/wiki/${encodeURIComponent(title)}`,
  };
}

// A place name isn't always a clean Wikipedia article title — a proposal
// or geocoder can produce something like "Jaipur, Rajasthan, India", which
// the direct title lookup 404s on even though "Jaipur" has a real article
// and a real photo. Rather than guessing with string-splitting (fragile —
// "Georgia, USA" truncated to "Georgia" would resolve to the wrong
// Georgia), this asks Wikipedia's own search relevance ranking for the
// best-matching article and fetches THAT article's summary. Tested live
// during R3 hardening: correctly resolves "Jaipur" for the qualified
// string, and returns zero results (never a wrong guess) for gibberish.
async function searchForTitle(query: string): Promise<string | null> {
  const res = await fetch(SEARCH_URL(query), { headers: USER_AGENT_HEADERS });
  if (!res.ok) return null;
  const data = (await res.json()) as WikipediaSearchResponse;
  return data.query?.search?.[0]?.title ?? null;
}

export async function fetchWikipediaPhoto(placeName: string): Promise<WikipediaPhoto | null> {
  const trimmed = placeName.trim();
  if (!trimmed) return null;

  try {
    const direct = await fetchSummary(trimmed);
    if (direct) return direct;

    const bestTitle = await searchForTitle(trimmed);
    if (!bestTitle || bestTitle.toLowerCase() === trimmed.toLowerCase()) return null;

    return await fetchSummary(bestTitle);
  } catch {
    return null;
  }
}
