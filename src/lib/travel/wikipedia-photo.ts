// Real, live destination photography for any place name — keyless, no
// config required. Anchored to the place's own Wikipedia article title
// (not a keyword search), so a returned photo is genuinely of the place
// asked about, never a loosely-matched stock photo. Audited during R3
// hardening: Geoapify's /v2/place-details wiki_and_media.image field was
// tested live and found unreliable (present for a specific landmark like
// the Eiffel Tower, absent for a whole city like Prague) — this endpoint
// was tested live instead and reliably returns a real photo for both.
// Returns null (never a fabricated/generic image) when a place has no
// Wikipedia article or no lead image — callers must treat that as "no
// photo available", the same graceful-omission behavior already used for
// DESTINATION_PHOTOS misses.
const SUMMARY_URL = (title: string) =>
  `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;

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

export async function fetchWikipediaPhoto(placeName: string): Promise<WikipediaPhoto | null> {
  const trimmed = placeName.trim();
  if (!trimmed) return null;

  try {
    // Wikimedia's API etiquette policy requires a descriptive User-Agent —
    // requests without one are throttled/blocked.
    const res = await fetch(SUMMARY_URL(trimmed), {
      headers: { "User-Agent": "Clockwise/1.0 (trip-coordination app; live destination photos)" },
    });
    if (!res.ok) return null;

    const data = (await res.json()) as WikipediaSummaryResponse;
    const image = data.originalimage ?? data.thumbnail;
    if (!image?.source) return null;

    return {
      src: image.source,
      alt: data.title ?? trimmed,
      // Named-photographer attribution (like DESTINATION_PHOTOS' hand-
      // curated credits) would need a second Commons imageinfo/extmetadata
      // call this endpoint doesn't provide — linking to the source article
      // is the honest, verifiable attribution available from this API.
      credit: "Wikipedia",
      articleUrl: data.content_urls?.desktop?.page ?? `https://en.wikipedia.org/wiki/${encodeURIComponent(trimmed)}`,
    };
  } catch {
    return null;
  }
}
