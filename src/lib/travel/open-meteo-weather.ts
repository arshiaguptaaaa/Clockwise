// Open-Meteo Weather Forecast API — same provider family as the geocoding
// already used for destination autocomplete, but a separate base URL/
// endpoint. Fully keyless, no signup, no new credential — confirmed
// current 2026-09-21.
import type { LatLng, WeatherResult } from "./types";

const FORECAST_URL = "https://api.open-meteo.com/v1/forecast";
const FORECAST_DAYS = 5;

type OpenMeteoForecastResponse = {
  current?: { temperature_2m: number; wind_speed_10m: number; is_day: number };
  daily?: {
    time: string[];
    temperature_2m_max: number[];
    temperature_2m_min: number[];
    precipitation_probability_max?: (number | null)[];
  };
};

export async function getWeather(at: LatLng): Promise<WeatherResult> {
  const params = new URLSearchParams({
    latitude: String(at.lat),
    longitude: String(at.lng),
    current: "temperature_2m,wind_speed_10m,is_day",
    daily: "temperature_2m_max,temperature_2m_min,precipitation_probability_max",
    timezone: "auto",
    forecast_days: String(FORECAST_DAYS),
  });

  const res = await fetch(`${FORECAST_URL}?${params}`);
  if (!res.ok) throw new Error(`Open-Meteo forecast failed (${res.status})`);
  const data: OpenMeteoForecastResponse = await res.json();

  if (!data.current || !data.daily) {
    throw new Error("Open-Meteo returned an incomplete forecast");
  }

  const retrievedAt = new Date().toISOString();
  return {
    temperatureC: data.current.temperature_2m,
    windSpeedKmh: data.current.wind_speed_10m,
    isDay: data.current.is_day === 1,
    forecast: data.daily.time.map((date, i) => ({
      date,
      minC: data.daily!.temperature_2m_min[i],
      maxC: data.daily!.temperature_2m_max[i],
      precipitationProbability: data.daily!.precipitation_probability_max?.[i] ?? null,
    })),
    provider: "open-meteo",
    retrievedAt,
  };
}
