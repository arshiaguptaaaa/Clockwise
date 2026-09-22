// TravelSearchService — the "live world knowledge" layer, distinct from
// trip-internal state. Every result carries `provider`/`retrievedAt` so
// stale live data never silently becomes permanent truth (see spec §10).
// Behind this interface today: Geoapify (places/hotels/nearby/routing)
// and Open-Meteo (weather) — swappable later without touching call sites.

export type LatLng = { lat: number; lng: number };

export type PlaceResult = {
  providerId: string;
  name: string;
  formattedAddress: string | null;
  categories: string[];
  latitude: number;
  longitude: number;
  distanceMeters: number | null;
  provider: string;
  retrievedAt: string; // ISO timestamp
};

export type TravelMode = "walk" | "drive" | "transit" | "bicycle";

export type RouteResult = {
  mode: TravelMode;
  distanceMeters: number;
  durationSeconds: number;
  provider: string;
  retrievedAt: string;
  // The real routed path geometry, ordered start→end, downsampled for
  // storage/render — present whenever the provider returns one (Geoapify
  // does). Never fabricated: absent rather than a fake straight line when
  // a provider doesn't supply geometry.
  geometry?: LatLng[];
};

export type WeatherDay = {
  date: string; // YYYY-MM-DD
  minC: number;
  maxC: number;
  precipitationProbability: number | null;
};

export type WeatherResult = {
  temperatureC: number;
  windSpeedKmh: number;
  isDay: boolean;
  forecast: WeatherDay[];
  provider: string;
  retrievedAt: string;
};
