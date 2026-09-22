import { NextRequest, NextResponse } from "next/server";
import { destinationSearchProvider } from "@/lib/destination-search/open-meteo-provider";

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
    return NextResponse.json({ results });
  } catch (err) {
    console.error("Destination search failed:", err);
    return NextResponse.json(
      { results: [], error: "Destination search is temporarily unavailable." },
      { status: 502 }
    );
  }
}
