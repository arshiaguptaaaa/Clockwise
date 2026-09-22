// Real worldwide city/region/country search — Open-Meteo's Geocoding API
// is free, requires no API key, and works internationally, which is why it
// was chosen over GeoNames (needs a registered username) or Google
// Places/Mapbox (need billing + a server-side-only key). If a keyed
// provider ever replaces this, only this file changes.
import type { DestinationSearchProvider, DestinationSearchResult } from "./types";

const SEARCH_URL = "https://geocoding-api.open-meteo.com/v1/search";

type OpenMeteoResult = {
  id: number;
  name: string;
  latitude: number;
  longitude: number;
  country?: string;
  country_code?: string;
  admin1?: string; // region/state
  population?: number;
};

const RESULT_LIMIT = 10;

// Open-Meteo's own relevance ranking favours exact/near-exact name matches
// over legitimate prefix matches on longer names — e.g. a bare "Hall"
// query doesn't surface "Hallstatt" even within its top 100 results, even
// though "Hallstatt" genuinely starts with "Hall". Requesting a larger
// batch (its practical max) and re-ranking client-side so exact matches,
// then real prefix matches, come first fixes this generally — not just
// for one hardcoded city — without needing a different provider.
function rank(query: string, a: OpenMeteoResult, b: OpenMeteoResult): number {
  const q = query.toLowerCase();
  const matchScore = (r: OpenMeteoResult) => {
    const name = r.name.toLowerCase();
    if (name === q) return 0;
    if (name.startsWith(q)) return 1;
    return 2;
  };
  const scoreDiff = matchScore(a) - matchScore(b);
  if (scoreDiff !== 0) return scoreDiff;
  // Within an equally-relevant tier, prefer the more prominent place —
  // otherwise well-known small towns (e.g. Hallstatt, population ~800)
  // lose to obscure same-prefix hamlets with no recorded population at
  // all, which is a worse result for a travel destination search.
  return (b.population ?? 0) - (a.population ?? 0);
}

class OpenMeteoDestinationProvider implements DestinationSearchProvider {
  async search(query: string): Promise<DestinationSearchResult[]> {
    const url = `${SEARCH_URL}?name=${encodeURIComponent(query)}&count=100&language=en&format=json`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Destination search failed (${res.status})`);
    }
    const data: { results?: OpenMeteoResult[] } = await res.json();
    const results = (data.results ?? []).slice().sort((a, b) => rank(query, a, b));
    return results.slice(0, RESULT_LIMIT).map((r) => ({
      providerPlaceId: String(r.id),
      name: r.name,
      city: r.name, // Open-Meteo results are themselves the populated place
      region: r.admin1 ?? null,
      country: r.country ?? null,
      countryCode: r.country_code ?? null,
      displayName: r.country ? `${r.name}, ${r.country}` : r.name,
      latitude: r.latitude,
      longitude: r.longitude,
      provider: "open-meteo",
    }));
  }
}

export const destinationSearchProvider: DestinationSearchProvider = new OpenMeteoDestinationProvider();
