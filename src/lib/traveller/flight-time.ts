// How long is this flight? Only ever answered from the journey's OWN departure and arrival times, each read in the
// time zone of the place it belongs to. A subtraction of two wall-clock times is wrong the moment the flight crosses
// a zone (Delhi 07:00 -> Singapore 15:30 is 6h, not 8h30m), so both are converted to UTC through the zone's real
// rules for THAT date (daylight saving included). If either zone, either time, or a plausible result is missing,
// there is no answer and the caller asks.
import { searchPlaceByText } from "@/lib/travel/geoapify-provider";

const FORECAST_URL = "https://api.open-meteo.com/v1/forecast";

const fmt = (tz: string) => new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });

function offsetMinutesAt(tz: string, utcMs: number): number {
  const parts = Object.fromEntries(fmt(tz).formatToParts(new Date(utcMs)).map((p) => [p.type, p.value]));
  const asUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
  return Math.round((asUtc - utcMs) / 60000);
}

// "2026-10-05T07:00" read as wall-clock time in `tz` -> the real instant.
export function localToUtcMs(tz: string, local: string): number {
  const guess = Date.parse(`${local.slice(0, 16)}:00Z`);
  const first = guess - offsetMinutesAt(tz, guess) * 60000;
  return guess - offsetMinutesAt(tz, first) * 60000;
}

export type FlightMinutes = { ok: true; minutes: number; crossesZones: boolean } | { ok: false; reason: string };

export function flightMinutes(p: { departLocal: string | null; departTz: string | null; arriveLocal: string | null; arriveTz: string | null }): FlightMinutes {
  if (!p.departLocal || !p.arriveLocal) return { ok: false, reason: "the journey doesn't have both a departure and an arrival time" };
  if (!p.departTz || !p.arriveTz) return { ok: false, reason: "I couldn't confirm the time zone of the departure or arrival place" };
  try {
    const minutes = Math.round((localToUtcMs(p.arriveTz, p.arriveLocal) - localToUtcMs(p.departTz, p.departLocal)) / 60000);
    if (!Number.isFinite(minutes) || minutes < 20 || minutes > 20 * 60) return { ok: false, reason: `the times on the journey give an implausible flight time (${minutes} min)` };
    return { ok: true, minutes, crossesZones: p.departTz !== p.arriveTz };
  } catch {
    return { ok: false, reason: "a time zone couldn't be read" };
  }
}

// Replaceable in tests; real providers otherwise.
export const flightDeps = {
  async geocode(name: string): Promise<{ lat: number; lng: number } | null> {
    const r = await searchPlaceByText(name).catch(() => []);
    return r[0] ? { lat: r[0].latitude, lng: r[0].longitude } : null;
  },
  async timezoneAt(point: { lat: number; lng: number }): Promise<string | null> {
    const q = new URLSearchParams({ latitude: String(point.lat), longitude: String(point.lng), hourly: "temperature_2m", timezone: "auto", forecast_days: "1" });
    const res = await fetch(`${FORECAST_URL}?${q}`).catch(() => null);
    if (!res?.ok) return null;
    const d: { timezone?: string } = await res.json().catch(() => ({}));
    return typeof d.timezone === "string" && d.timezone ? d.timezone : null;
  },
};

export async function resolveFlightMinutes(j: { originName: string | null; departLocal: string | null; scheduledArriveLocal: string | null; arriveLocal: string | null; arrivalLat: number | null; arrivalLng: number | null }): Promise<FlightMinutes & { basis?: string }> {
  // The ticket's own arrival (a delay moves arriveLocal, never the printed time).
  const ticketArrive = j.scheduledArriveLocal ?? j.arriveLocal;
  if (!j.originName) return { ok: false, reason: "the journey has no departure city" };
  if (j.arrivalLat == null || j.arrivalLng == null) return { ok: false, reason: "the arrival point isn't confirmed" };
  const origin = await flightDeps.geocode(j.originName);
  if (!origin) return { ok: false, reason: `I couldn't place "${j.originName}" on the map` };
  const [departTz, arriveTz] = await Promise.all([flightDeps.timezoneAt(origin), flightDeps.timezoneAt({ lat: j.arrivalLat, lng: j.arrivalLng })]);
  const r = flightMinutes({ departLocal: j.departLocal, departTz, arriveLocal: ticketArrive, arriveTz });
  return r.ok ? { ...r, basis: departTz === arriveTz ? `the departure and arrival times on your journey (both in ${departTz})` : `the departure and arrival times on your journey, read in ${departTz} and ${arriveTz} and converted to the same clock` } : r;
}
