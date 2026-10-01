import { NextRequest, NextResponse } from "next/server";
import { destinationSearchProvider } from "@/lib/destination-search/open-meteo-provider";
import { fetchWikipediaPhoto } from "@/lib/travel/wikipedia-photo";
import type { DestinationSearchResult } from "@/lib/destination-search/types";

// Thumbnails are fetched only for the top N results shown in the dropdown
// — fetching all 10 per keystroke would add real latency for results the
// user will likely never scroll to. A result with no Wikipedia photo
// simply renders without one (fetchWikipediaPhoto already returns null
// rather than a fabricated/generic image) — never a broken layout.
const THUMBNAIL_COUNT = 6;

// Server-side route so the provider (and any future API key) is never
// referenced from browser JavaScript, even though Open-Meteo itself
// doesn't require one today.
export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (query.length < 2) {
    return NextResponse.json({ results: [] });
  }

  try {
    const results = await destinationSearchProvider.search(query);

    const withPhotos: DestinationSearchResult[] = await Promise.all(
      results.map(async (r, i) => {
        if (i >= THUMBNAIL_COUNT) return r;
        const photo = await fetchWikipediaPhoto(r.displayName ?? r.name).catch(() => null);
        return { ...r, photoUrl: photo?.src ?? null };
      })
    );

    return NextResponse.json({ results: withPhotos });
  } catch (err) {
    console.error("Destination search failed:", err);
    return NextResponse.json(
      { results: [], error: "Destination search is temporarily unavailable." },
      { status: 502 }
    );
  }
}
