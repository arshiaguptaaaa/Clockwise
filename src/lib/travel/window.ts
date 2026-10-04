// WHAT MAKES SENSE FROM HERE, FOR ME, RIGHT NOW? — deterministic feasibility.
// Inputs are all real: the clock at the destination (Open-Meteo UTC offset), the
// traveller's next shared commitment, Geoapify places, Geoapify walking routes, and
// Open-Meteo rain. An option is offered only if
//     walk(anchor -> place) + time there + walk(place -> next point) <= the window.
// Time spent AT a place is Clockwise's own labelled assumption, never a provider fact.
// Gemini is not involved in deciding whether anything fits.
import { prisma } from "@/lib/prisma";
import { getRoute, searchNearby, isGeoapifyConfigured } from "./geoapify-provider";
import { getHourlyContext, type HourlyContext } from "./open-meteo-weather";
import { resolveTripLocationText, resolveTripCityPoint, isResolveFailure } from "./resolve";
import { getTripById } from "@/lib/trip";
import { appliesTo } from "@/lib/rendezvous";
import { toAroundPlace, whyPicked, type AroundAnchor, type AroundPlace } from "./around";
import { hoursCoverVisit, type HoursStatus } from "./hours";
import type { LatLng } from "./types";

export const BUFFER_MIN = 10; // arrive this long before a commitment
export const RAIN_PROB = 50; // % at which Clockwise treats an hour as rainy
// Clockwise's assumption, shown to the traveller as an assumption.
export const STAY_MIN: Record<string, number> = { museum: 60, attraction: 45, park: 30, cafe: 30, shopping: 30, restaurant: 45 };
const OUTDOOR = new Set(["park", "attraction"]);

const localNowIso = (h: HourlyContext) => new Date(Date.now() + h.utcOffsetSeconds * 1000).toISOString().slice(0, 16);
const minutesBetween = (a: string, b: string) => Math.round((Date.parse(`${b}:00Z`) - Date.parse(`${a}:00Z`)) / 60000);
const hhmm = (iso: string) => iso.slice(11, 16);
export const addMinutes = (iso: string, m: number) => new Date(Date.parse(`${iso}:00Z`) + m * 60000).toISOString().slice(0, 16);

export type NextCommitment = { id: string; name: string; targetLocal: string; location: string; point: LatLng | null; pointLabel: string | null };

async function commitmentPoint(tripId: string, location: string): Promise<{ point: LatLng; label: string } | null> {
  if (!location.trim()) return null;
  // An agreed place the group chose wins over a fresh geocode of the same name.
  const agreed = await prisma.booking.findMany({ where: { tripId, type: "PLACE", status: "AGREED", latitude: { not: null }, longitude: { not: null } } });
  const hit = agreed.find((b) => b.placeName && (location.toLowerCase().includes(b.placeName.toLowerCase()) || b.placeName.toLowerCase().includes(location.toLowerCase())));
  if (hit) return { point: { lat: hit.latitude!, lng: hit.longitude! }, label: hit.placeName! };
  const trip = await getTripById(tripId);
  const city = await resolveTripCityPoint(trip);
  const r = await resolveTripLocationText(location, tripId, city?.point).catch(() => null);
  if (!r || isResolveFailure(r)) return null;
  return { point: r.point, label: r.label };
}

export async function nextCommitment(tripId: string, userId: string, nowLocal: string): Promise<NextCommitment | null> {
  const rows = await prisma.commitment.findMany({ where: { tripId }, orderBy: { targetTime: "asc" } });
  const c = rows.find((x) => appliesTo(x.participantIds)(userId) && x.targetTime.toISOString().slice(0, 16) > nowLocal);
  if (!c) return null;
  const p = await commitmentPoint(tripId, c.location);
  return { id: c.id, name: c.name, targetLocal: c.targetTime.toISOString().slice(0, 16), location: c.location, point: p?.point ?? null, pointLabel: p?.label ?? null };
}

export type Rain = { probability: number; atLocal: string } | null;
export function rainInWindow(h: HourlyContext, fromLocal: string, toLocal: string): Rain {
  let worst: Rain = null;
  for (const hr of h.hours) {
    const end = addMinutes(hr.time, 60);
    if (end <= fromLocal || hr.time >= toLocal) continue;
    const p = hr.precipitationProbability ?? 0;
    if (p >= RAIN_PROB && (!worst || p > worst.probability)) worst = { probability: p, atLocal: hr.time };
  }
  return worst;
}

// The single feasibility rule. Pure.
export const spareMinutes = (windowMinutes: number, bufferMin: number, toMin: number, stayMin: number, onMin: number) => windowMinutes - bufferMin - (toMin + stayMin + onMin);

const walkMin = async (a: LatLng, b: LatLng) => {
  try {
    const r = await getRoute(a, b, "walk");
    return Math.max(1, Math.round(r.durationSeconds / 60));
  } catch {
    return null;
  }
};

export type NextUp = {
  commitment: { name: string; targetLocal: string; location: string };
  minutesUntil: number;
  walkMinutes: number | null;
  leaveByLocal: string | null;
  toPoint: { lat: number; lng: number } | null;
  fromLabel: string;
  rain: Rain;
  weatherRetrievedAt: string;
  windowMinutes: number;
};

// "DINNER IN 45 MIN. About a 24-minute walk from here. Leave around 7:30?"
// Uses only the anchor the traveller chose (a fresh shared location, or the hotel).
export async function nextUpFor(tripId: string, userId: string, anchor: AroundAnchor): Promise<NextUp | { none: string }> {
  let h: HourlyContext;
  try {
    h = await getHourlyContext(anchor.point);
  } catch {
    return { none: "I couldn't get the local time and weather from the provider right now." };
  }
  const nowLocal = localNowIso(h);
  const c = await nextCommitment(tripId, userId, nowLocal);
  if (!c) return { none: "Nothing is coming up in the Plan for you." };
  const minutesUntil = minutesBetween(nowLocal, c.targetLocal);
  const walk = c.point && isGeoapifyConfigured() ? await walkMin(anchor.point, c.point) : null;
  // Beyond 12 hours "leave around" and today's rain say nothing about that commitment: leave them out.
  const near = minutesUntil <= 12 * 60;
  return {
    commitment: { name: c.name, targetLocal: c.targetLocal, location: c.pointLabel ?? c.location },
    minutesUntil,
    walkMinutes: walk,
    leaveByLocal: near && walk != null ? addMinutes(c.targetLocal, -(walk + BUFFER_MIN)) : null,
    toPoint: c.point,
    fromLabel: anchor.kind === "me" ? "here" : anchor.kind === "stay" ? "your hotel" : anchor.label,
    rain: near ? rainInWindow(h, nowLocal, c.targetLocal) : null,
    weatherRetrievedAt: h.retrievedAt,
    windowMinutes: minutesUntil,
  };
}

export type FreeOption = { place: AroundPlace; category: string; walkToMin: number; stayMin: number; walkOnMin: number; spareMin: number; why: string | null; hours: HoursStatus };
export type FreeTime = {
  ok: true;
  windowMinutes: number;
  windowSource: "next-commitment" | "stated";
  nowLocal: string;
  next: { name: string; targetLocal: string; pointLabel: string | null } | null;
  nextPointKnown: boolean;
  rain: Rain;
  rainyMode: boolean;
  options: FreeOption[];
  considered: number;
  closedDropped: number;
  retrievedAt: string;
  assumptions: string;
};

async function inBatches<T, R>(items: T[], size: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) out.push(...(await Promise.all(items.slice(i, i + size).map(fn))));
  return out;
}

// Candidate places -> real routes -> keep only what fits -> rank by the traveller's Vibe Check.
export async function freeTimeOptions(tripId: string, userId: string, anchor: AroundAnchor, opts: { minutes?: number; categoryOrder: string[]; prefs: { energy?: string[]; nearby?: string[]; food?: string[] } }): Promise<FreeTime | { ok: false; error: string }> {
  if (!isGeoapifyConfigured()) return { ok: false, error: "Place search isn't connected in this environment." };
  let h: HourlyContext;
  try {
    h = await getHourlyContext(anchor.point);
  } catch {
    return { ok: false, error: "I couldn't get the local time from the weather provider, so I can't work out your window." };
  }
  const nowLocal = localNowIso(h);
  const next = await nextCommitment(tripId, userId, nowLocal);
  let windowMinutes: number;
  let source: FreeTime["windowSource"];
  if (opts.minutes && opts.minutes > 0) {
    windowMinutes = Math.min(opts.minutes, 12 * 60);
    source = "stated";
  } else if (next) {
    windowMinutes = minutesBetween(nowLocal, next.targetLocal);
    source = "next-commitment";
    if (windowMinutes > 12 * 60) {
      const days = Math.round(windowMinutes / 1440);
      return { ok: false, error: `Your next plan, ${next.name}, is ${days >= 2 ? `${days} days` : "more than 12 hours"} away, so "before ${next.name.toLowerCase()}" isn't a free window yet. Tell me how long you have (30, 60, 90 or 120 minutes).` };
    }
  } else return { ok: false, error: "Nothing is coming up in the Plan, so there's no window to fill. Tell me how long you have." };

  const endLocal = addMinutes(nowLocal, windowMinutes);
  const rain = rainInWindow(h, nowLocal, endLocal);
  const rainyMode = Boolean(rain);
  // The next point: the commitment's resolved location if there is one and the window came from it; otherwise back to where you started.
  const returnTo: LatLng = source === "next-commitment" && next?.point ? next.point : anchor.point;
  const needBuffer = source === "next-commitment" ? BUFFER_MIN : 0;

  const base = ["museum", "attraction", "park", "cafe", "shopping"];
  const order = [...opts.categoryOrder.filter((c) => base.includes(c)), ...base.filter((c) => !opts.categoryOrder.includes(c))];
  // Rain: indoor-type categories only (a category-level judgement, stated as such).
  const cats = (rainyMode ? order.filter((c) => !OUTDOOR.has(c)) : order).slice(0, 5);
  const lists = await Promise.all(cats.map((c) => searchNearby(c === "museum" ? "museum" : c, anchor.point, 2500, 6).then((r) => r.map((x) => ({ cat: c, raw: x }))).catch(() => [])));
  const seen = new Set<string>();
  const cands: { cat: string; p: AroundPlace }[] = [];
  for (const l of lists) for (const { cat, raw } of l) if (!seen.has(raw.providerId) && raw.name !== "Unnamed place") { seen.add(raw.providerId); cands.push({ cat, p: toAroundPlace(raw) }); }
  const shortlist = cands.sort((a, b) => (a.p.distanceMeters ?? 1e9) - (b.p.distanceMeters ?? 1e9)).slice(0, 10);

  const timed = await inBatches(shortlist, 4, async ({ cat, p }) => {
    const [to, on] = await Promise.all([walkMin(anchor.point, { lat: p.lat, lng: p.lng }), walkMin({ lat: p.lat, lng: p.lng }, returnTo)]);
    return { cat, p, to, on };
  });
  const options: FreeOption[] = [];
  let closedDropped = 0;
  for (const t of timed) {
    if (t.to == null || t.on == null) continue; // no provider route => no claim it fits
    const stay = STAY_MIN[t.cat] ?? 30;
    const spare = spareMinutes(windowMinutes, needBuffer, t.to, stay, t.on);
    if (spare < 0) continue;
    // Provider hours decide whether it is OPEN for the whole visit. Known-closed is dropped;
    // missing/unparseable hours are kept but flagged, never assumed open.
    const arrive = new Date(`${addMinutes(nowLocal, t.to)}:00Z`);
    const hours = hoursCoverVisit(t.p.openingHours, arrive, stay);
    if (hours.state === "closed") {
      closedDropped++;
      continue;
    }
    options.push({ place: { ...t.p, walkMinutes: t.to }, category: t.cat, walkToMin: t.to, stayMin: stay, walkOnMin: t.on, spareMin: spare, why: whyPicked(t.cat, opts.prefs), hours });
  }
  // Vibe Check order first, then places whose hours are confirmed open, then the most spare time.
  options.sort((a, b) => order.indexOf(a.category) - order.indexOf(b.category) || Number(a.hours.state === "unknown") - Number(b.hours.state === "unknown") || b.spareMin - a.spareMin);
  const perCat: Record<string, number> = {};
  const diverse = options.filter((o) => (perCat[o.category] = (perCat[o.category] ?? 0) + 1) <= 2);
  return {
    ok: true,
    windowMinutes,
    windowSource: source,
    nowLocal,
    next: next ? { name: next.name, targetLocal: next.targetLocal, pointLabel: next.pointLabel } : null,
    nextPointKnown: source === "next-commitment" ? Boolean(next?.point) : true,
    rain,
    rainyMode,
    options: diverse.slice(0, 6),
    considered: shortlist.length,
    closedDropped,
    retrievedAt: h.retrievedAt,
    assumptions: `Time at each place is Clockwise's assumption (${Object.entries(STAY_MIN).map(([k, v]) => `${k} ${v} min`).join(", ")}), not provider data. ${needBuffer ? `${needBuffer} min is kept as a buffer before ${next?.name}. ` : ""}${source === "next-commitment" && !next?.point ? `${next?.name}'s location couldn't be placed on the map, so the walk back is measured to where you started.` : ""}`.trim(),
  };
}
export { hhmm };

// Destination-local "now" as a Z-convention Date, for evaluating provider opening hours.
export async function localNowZ(point: LatLng): Promise<Date | null> {
  try {
    const h = await getHourlyContext(point);
    return new Date(`${localNowIso(h)}:00Z`);
  } catch {
    return null;
  }
}
