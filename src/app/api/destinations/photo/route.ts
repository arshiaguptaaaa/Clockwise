import { NextRequest, NextResponse } from "next/server";
import { fetchWikipediaPhoto } from "@/lib/travel/wikipedia-photo";

// Single-destination photo lookup for the wizard's large reveal panel —
// kept separate from /api/destinations/search (which already fetches
// thumbnails for its own result list) since this is called once per
// selected destination, not once per keystroke.
export async function GET(request: NextRequest) {
  const name = request.nextUrl.searchParams.get("name")?.trim();
  if (!name) {
    return NextResponse.json({ photo: null });
  }
  const photo = await fetchWikipediaPhoto(name).catch(() => null);
  return NextResponse.json({ photo });
}
