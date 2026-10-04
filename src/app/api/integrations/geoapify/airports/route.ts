import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/session";
import { airportCandidates, isGeoapifyConfigured, resolveLocationText } from "@/lib/travel/geoapify-provider";
import { airportScore, pickPassengerAirport } from "@/lib/travel/airport-pick";

// Signed-in, read-only evidence: every airport POI the provider returns near a place, with the
// provider's own signals and Clockwise's ranking. ?city=Bengaluru, India
export async function GET(request: NextRequest) {
  if (!(await getCurrentUserId())) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (!isGeoapifyConfigured()) return NextResponse.json({ configured: false });
  const city = request.nextUrl.searchParams.get("city") ?? "Bengaluru, India";
  const centre = await resolveLocationText(city);
  if (!centre) return NextResponse.json({ city, error: "could not resolve city" }, { status: 404 });
  const cands = await airportCandidates({ lat: centre.latitude, lng: centre.longitude });
  const chosen = pickPassengerAirport(cands);
  return NextResponse.json({
    city,
    resolvedAs: centre.displayName,
    chosen: chosen?.name ?? null,
    candidates: cands.map((c) => ({ name: c.name, categories: c.categories, iata: c.iata, icao: c.icao, distanceKm: c.distanceMeters != null ? Math.round(c.distanceMeters / 100) / 10 : null, score: airportScore(c) })),
  });
}
