// Resolves a free-text pickup/destination string (e.g. "Hotel Sacher",
// "Restaurant") into coordinates Uber's API requires. Uses Open-Meteo's
// free, keyless geocoding search — already the destination-search provider
// used elsewhere in Clockwise, reused here rather than inventing a second
// geocoder. Deliberately returns null on a miss instead of guessing
// coordinates: a wrong pickup point is worse than an honest "couldn't
// locate this" message.
export type GeocodedPoint = { lat: number; lng: number; label: string };

export async function geocodeLocation(
  query: string,
  cityHint?: string
): Promise<GeocodedPoint | null> {
  const q = cityHint ? `${query}, ${cityHint}` : query;
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(
    q
  )}&count=1&language=en&format=json`;

  let res: Response;
  try {
    res = await fetch(url);
  } catch {
    return null;
  }
  if (!res.ok) return null;

  const data: { results?: { latitude: number; longitude: number; name: string; country?: string }[] } =
    await res.json();
  const first = data.results?.[0];
  if (!first) return null;

  return {
    lat: first.latitude,
    lng: first.longitude,
    label: first.country ? `${first.name}, ${first.country}` : first.name,
  };
}
