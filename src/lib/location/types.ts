// The ONE canonical location shape used everywhere a real-world place is
// selected/stored/consumed — trip destinations, hotel/place results,
// routing endpoints, maps. Two different geocoders populate it
// (Open-Meteo for city/region/country, Geoapify for POI/address/hotel —
// see src/lib/location/README decision in Stage 3), but every consumer
// downstream of selection only ever sees this shape, tagged with which
// provider actually produced it. Never re-derive a second shape per
// feature.
export type CanonicalPlace = {
  displayName: string; // human-readable, e.g. "Vienna, Austria"
  name: string; // short/primary name, e.g. "Vienna"
  city: string | null;
  region: string | null; // state/province/admin1
  country: string | null;
  countryCode: string | null;
  latitude: number;
  longitude: number;
  provider: string; // "open-meteo" | "geoapify"
  providerPlaceId: string | null;
};

// What a destination/place FIELD actually holds once persisted — either a
// verified CanonicalPlace, or a free-text fallback with no provider
// identity (autocomplete returned nothing, or the API was unreachable at
// the time). A fallback is explicit, never silently promoted to look
// canonical.
export type PlaceSelection =
  | ({ freeText: false } & CanonicalPlace)
  | { freeText: true; displayName: string; name: string };

export function isFreeText(place: PlaceSelection): place is Extract<PlaceSelection, { freeText: true }> {
  return place.freeText;
}

// Server-side gate for any CanonicalPlace crossing a trust boundary (e.g. a
// Server Action receiving client-supplied wizard state) — a provider-shaped
// object with an out-of-range or non-finite coordinate must never be
// persisted as if it were real. Structural fields are trusted (providers
// already type them); only the physically-checkable lat/lng gets validated.
export function hasValidCoordinates(place: { latitude: number; longitude: number }): boolean {
  return (
    Number.isFinite(place.latitude) &&
    Number.isFinite(place.longitude) &&
    place.latitude >= -90 &&
    place.latitude <= 90 &&
    place.longitude >= -180 &&
    place.longitude <= 180
  );
}
