// EASIEST FOR EVERYONE. Where should the group meet? Not the geometric midpoint: the place with the
// best worst-case TRAVEL TIME for the people involved, from a Delhivery distance matrix
// (everyone x every candidate). Ranked by the longest journey first (so nobody is stranded), then by
// the total. Candidates are real provider places; the numbers are provider durations.
//
// Where each person starts from is never invented, and a private position is only used with consent:
//   the requester's own position (if they pressed ME)  >  a fresh live fix the traveller chose to share
//   >  the arrival point of someone who hasn't landed yet  >  the group's stay.
// What comes back is minutes and a basis, never anyone's coordinates.
import { prisma } from "@/lib/prisma";
import { delhiveryMatrix, parseMatrix, isDelhiveryConfigured, inIndia } from "@/lib/delhivery/client";
import { driveRoute } from "./route-provider";
import { getClockwiseUserId } from "@/lib/clockwise";
import type { LatLng } from "./types";

export type MeetCandidate = { providerPlaceId: string; name: string; lat: number; lng: number };
export type MeetPerson = { userId: string; firstName: string; basis: string };
export type MeetRow = { candidate: MeetCandidate; minutes: Record<string, number | null>; worst: number; total: number };
export type MeetupResult =
  | { ok: true; people: MeetPerson[]; ranked: MeetRow[]; provider: "delhivery" | "geoapify"; evidenceId: string | null; note: string | null }
  | { ok: false; error: string };

const LIVE_FRESH_MS = 30 * 60_000;

// Pure ranking: smallest worst-case journey, then smallest total. Incomplete rows (any missing number) are dropped.
export function rankMeetup(candidates: MeetCandidate[], personIds: string[], seconds: (number | null)[][]): MeetRow[] {
  const rows: MeetRow[] = [];
  candidates.forEach((candidate, j) => {
    const minutes: Record<string, number | null> = {};
    const vals: number[] = [];
    let complete = true;
    personIds.forEach((id, i) => {
      const s = seconds[i]?.[j] ?? null;
      minutes[id] = s == null ? null : Math.max(1, Math.round(s / 60));
      if (s == null) complete = false;
      else vals.push(Math.max(1, Math.round(s / 60)));
    });
    if (complete && vals.length) rows.push({ candidate, minutes, worst: Math.max(...vals), total: vals.reduce((a, b) => a + b, 0) });
  });
  return rows.sort((a, b) => a.worst - b.worst || a.total - b.total);
}

export async function easiestForEveryone(p: { tripId: string; requesterId: string; candidates: MeetCandidate[]; me?: LatLng | null }): Promise<MeetupResult> {
  const cands = p.candidates.filter((c) => Number.isFinite(c.lat) && Number.isFinite(c.lng)).slice(0, 6);
  if (cands.length < 2) return { ok: false, error: "I need at least two places to compare." };
  const clockwiseId = await getClockwiseUserId();
  const [members, journeys, locations, stay] = await Promise.all([
    prisma.tripMember.findMany({ where: { tripId: p.tripId }, include: { user: { select: { id: true, name: true } } }, orderBy: { participationStart: "asc" } }),
    prisma.travellerJourney.findMany({ where: { tripId: p.tripId, status: "CONFIRMED" } }),
    prisma.travellerLocation.findMany({ where: { tripId: p.tripId, consent: "SHARING" } }),
    prisma.booking.findFirst({ where: { tripId: p.tripId, type: "STAY", status: "CONFIRMED", latitude: { not: null }, longitude: { not: null } }, orderBy: { createdAt: "desc" } }),
  ]);
  const nowMs = Date.now();
  const people: MeetPerson[] = [];
  const starts: LatLng[] = [];
  for (const m of members.filter((x) => x.userId !== clockwiseId)) {
    let point: LatLng | null = null;
    let basis = "";
    const live = locations.find((l) => l.userId === m.userId && l.latitude != null && l.longitude != null && l.recordedAt && nowMs - l.recordedAt.getTime() < LIVE_FRESH_MS);
    const j = journeys.find((x) => x.userId === m.userId && x.arrivalLat != null && x.arrivalLng != null);
    if (m.userId === p.requesterId && p.me) {
      point = p.me;
      basis = "where they are now";
    } else if (live) {
      point = { lat: live.latitude!, lng: live.longitude! };
      basis = "their shared live location";
    } else if (j && j.arriveLocal && j.arriveLocal > new Date(nowMs).toISOString().slice(0, 16)) {
      point = { lat: j.arrivalLat!, lng: j.arrivalLng! };
      basis = `where they land (${j.arrivalPlaceName ?? "arrival point"})`;
    } else if (stay?.latitude != null && stay.longitude != null) {
      point = { lat: stay.latitude, lng: stay.longitude };
      basis = "the stay";
    }
    if (point) {
      people.push({ userId: m.userId, firstName: m.user.name.split(" ")[0], basis });
      starts.push(point);
    }
  }
  if (people.length < 2) return { ok: false, error: "I don't have a starting point for at least two travellers yet (a confirmed stay, a journey, or a shared location)." };

  const targets = cands.map((c) => ({ lat: c.lat, lng: c.lng }));
  const ids = people.map((x) => x.userId);
  const allIndia = [...starts, ...targets].every(inIndia);
  const decision = `Easiest place for ${people.length} travellers to meet`;

  if (isDelhiveryConfigured() && allIndia) {
    const r = await delhiveryMatrix(starts, targets, "auto", { decision, tripId: p.tripId, userId: p.requesterId });
    const grid = r.ok ? parseMatrix(r.data, starts.length, targets.length) : null;
    if (r.ok && grid) {
      const ranked = rankMeetup(cands, ids, grid);
      if (ranked.length) return { ok: true, people, ranked, provider: "delhivery", evidenceId: r.evidenceId, note: "Travel times from the Delhivery distance matrix (driving, no traffic model)." };
    }
    // fall through to per-pair routes, saying why
    const why = r.ok ? "Delhivery's matrix returned no usable times" : r.blocked === "DELHIVERY_RATE_LIMITED" || r.httpStatus === 429 ? "Delhivery is rate-limiting this token" : `Delhivery couldn't answer (${r.blocked ?? r.error})`;
    return fallbackRoutes(p, cands, people, starts, why);
  }
  return fallbackRoutes(p, cands, people, starts, isDelhiveryConfigured() ? "some points are outside India" : "Delhivery isn't connected");
}

// Per-pair driving routes (Geoapify via the shared route provider) when the matrix isn't available.
async function fallbackRoutes(p: { tripId: string; requesterId: string }, cands: MeetCandidate[], people: MeetPerson[], starts: LatLng[], why: string): Promise<MeetupResult> {
  const grid: (number | null)[][] = [];
  for (const s of starts) {
    const row: (number | null)[] = [];
    for (const c of cands.slice(0, 5)) {
      try {
        row.push((await driveRoute(s, { lat: c.lat, lng: c.lng }, { tripId: p.tripId, userId: p.requesterId, decision: "Easiest place to meet (matrix unavailable)" })).durationSeconds);
      } catch {
        row.push(null);
      }
    }
    grid.push(row);
  }
  const ranked = rankMeetup(cands.slice(0, 5), people.map((x) => x.userId), grid);
  if (!ranked.length) return { ok: false, error: "No routing provider could measure these journeys, so I can't rank them." };
  return { ok: true, people, ranked, provider: "geoapify", evidenceId: null, note: `${why}, so these are individual driving routes from Geoapify.` };
}
