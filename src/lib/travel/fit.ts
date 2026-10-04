// DOES THIS FIT? A place is judged against the traveller's own clock, not just its distance.
//   next shared commitment  +  Delhivery drive time there  +  time at the place (a stated assumption)
//   +  Delhivery drive time back  +  buffer   =  fits, is tight, or does not fit.
// Delhivery IsoSuite adds a reachability gate: the area reachable from the origin within HALF of the
// time left (there and back must both fit), tested against the place.
// All numbers are provider facts or labelled assumptions; Gemini decides nothing here.
import { driveRoute } from "./route-provider";
import { delhiveryIsochrone, pointInIsochrone, isDelhiveryConfigured, inIndia } from "@/lib/delhivery/client";
import { getHourlyContext } from "./open-meteo-weather";
import { nextCommitment, BUFFER_MIN, STAY_MIN, addMinutes } from "./window";
import type { LatLng } from "./types";

export type FitVerdict = "YES" | "TIGHT" | "NO" | "NOTHING_AHEAD";

export type FitResult =
  | {
      ok: true;
      verdict: FitVerdict;
      place: string;
      originLabel: string;
      commitment: { name: string; targetLocal: string; location: string | null } | null;
      // The moment the trip is being measured from, and whether that is "now" or a what-if.
      leaveLocal: string;
      whatIf: boolean;
      toMin: number | null;
      onMin: number | null;
      stayMin: number;
      spareMin: number | null;
      leaveByLocal: string | null;
      windowMin: number | null;
      reach: { checked: boolean; inside: boolean | null; budgetMin: number | null; provider: "delhivery" | null };
      routeProvider: "delhivery" | "geoapify" | null;
      basis: string[];
      evidenceIds: string[];
      reason: string;
    }
  | { ok: false; error: string };

const minutesBetween = (a: string, b: string) => Math.round((Date.parse(`${b}:00Z`) - Date.parse(`${a}:00Z`)) / 60000);
const roundMin = (s: number) => Math.max(1, Math.round(s / 60));

// Pure verdict from the numbers: the single rule.
export function fitVerdict(spareMin: number, insideReach: boolean | null): FitVerdict {
  if (insideReach === false) return "NO";
  if (spareMin >= 15) return "YES";
  if (spareMin >= 0) return "TIGHT";
  return "NO";
}

export async function doesThisFit(p: {
  tripId: string;
  userId: string;
  place: { name: string; lat: number; lng: number };
  kind: string;
  origin: { label: string; point: LatLng };
  leaveLocal?: string | null;
}): Promise<FitResult> {
  let nowLocal: string;
  try {
    const h = await getHourlyContext(p.origin.point);
    nowLocal = new Date(Date.now() + h.utcOffsetSeconds * 1000).toISOString().slice(0, 16);
  } catch {
    return { ok: false, error: "I couldn't get the local time from the weather provider, so I can't work out your window." };
  }

  let leaveLocal = p.leaveLocal ?? nowLocal;
  let whatIf = Boolean(p.leaveLocal && p.leaveLocal !== nowLocal);
  let c = await nextCommitment(p.tripId, p.userId, leaveLocal);
  // The next plan is more than half a day away: "now" says nothing about it. Measure a what-if instead,
  // three hours before it, and say so plainly.
  if (c && !p.leaveLocal && minutesBetween(nowLocal, c.targetLocal) > 12 * 60) {
    leaveLocal = addMinutes(c.targetLocal, -180);
    whatIf = true;
    c = await nextCommitment(p.tripId, p.userId, leaveLocal);
  }
  const stayMin = STAY_MIN[p.kind.toLowerCase()] ?? 30;
  const dest: LatLng = { lat: p.place.lat, lng: p.place.lng };
  const basis: string[] = [`Time at the place (${stayMin} min) is Clockwise's assumption, not provider data.`];
  const evidenceIds: string[] = [];
  const decision = `Does ${p.place.name} fit before ${c?.name ?? "the next plan"}?`;

  // 1. Delhivery IsoSuite: can you even get there and back inside the window?
  const windowMin = c ? minutesBetween(leaveLocal, c.targetLocal) : null;
  const halfBudgetMin = windowMin != null ? Math.floor((windowMin - BUFFER_MIN - stayMin) / 2) : null;
  let reach: { checked: boolean; inside: boolean | null; budgetMin: number | null; provider: "delhivery" | null } = { checked: false, inside: null, budgetMin: halfBudgetMin, provider: null };
  if (c && halfBudgetMin != null && halfBudgetMin >= 3 && isDelhiveryConfigured() && inIndia(p.origin.point)) {
    const iso = await delhiveryIsochrone(p.origin.point, Math.min(halfBudgetMin * 60, 7200), "auto", { decision, tripId: p.tripId, userId: p.userId });
    if (iso.evidenceId) evidenceIds.push(iso.evidenceId);
    if (iso.ok && iso.polygons) {
      reach = { checked: true, inside: pointInIsochrone(dest, iso.polygons), budgetMin: halfBudgetMin, provider: "delhivery" };
      basis.push(`Delhivery IsoSuite: the area reachable by car from ${p.origin.label} in ${halfBudgetMin} min (half the time left).`);
    } else basis.push(`Delhivery reachability wasn't available (${iso.ok ? "no polygon returned" : (iso.blocked ?? iso.error)}), so only the route decides.`);
  }

  // 2. Routes: there, and back to where the next plan is (or to where you started).
  let to: Awaited<ReturnType<typeof driveRoute>> | null = null;
  let on: Awaited<ReturnType<typeof driveRoute>> | null = null;
  try {
    to = await driveRoute(p.origin.point, dest, { departLocal: leaveLocal, tripId: p.tripId, userId: p.userId, decision });
    if (to.evidenceId) evidenceIds.push(to.evidenceId);
    const back = addMinutes(leaveLocal, roundMin(to.durationSeconds) + stayMin);
    on = await driveRoute(dest, c?.point ?? p.origin.point, { departLocal: back, tripId: p.tripId, userId: p.userId, decision });
    if (on.evidenceId) evidenceIds.push(on.evidenceId);
  } catch {
    return { ok: false, error: "No routing provider could measure this, so I won't guess whether it fits." };
  }
  basis.push(to.basis);
  if (to.fellBackFrom) basis.push(`Fell back from ${to.fellBackFrom}.`);
  const toMin = roundMin(to.durationSeconds);
  const onMin = roundMin(on.durationSeconds);

  if (!c) {
    return { ok: true, verdict: "NOTHING_AHEAD", place: p.place.name, originLabel: p.origin.label, commitment: null, leaveLocal, whatIf, toMin, onMin, stayMin, spareMin: null, leaveByLocal: null, windowMin: null, reach, routeProvider: to.provider, basis, evidenceIds, reason: "Nothing in the Plan is waiting for you, so there's nothing to be late for." };
  }
  if (!c.point) basis.push(`${c.name}'s location couldn't be placed on the map, so the trip back is measured to ${p.origin.label}.`);

  const spare = windowMin! - BUFFER_MIN - (toMin + stayMin + onMin);
  const verdict = fitVerdict(spare, reach.inside);
  const leaveBy = addMinutes(c.targetLocal, -(BUFFER_MIN + onMin + stayMin + toMin));
  const reason =
    verdict === "YES"
      ? `${toMin} min each way, ${stayMin} min there, and still ${spare} min spare before ${c.name}.`
      : verdict === "TIGHT"
        ? `It works with only ${spare} min to spare before ${c.name}.`
        : reach.inside === false
          ? `It's outside what you can reach and get back from in the time you have.`
          : `You'd need ${toMin + stayMin + onMin} min and have ${windowMin! - BUFFER_MIN}, so you wouldn't comfortably make it back.`;
  return { ok: true, verdict, place: p.place.name, originLabel: p.origin.label, commitment: { name: c.name, targetLocal: c.targetLocal, location: c.pointLabel ?? c.location }, leaveLocal, whatIf, toMin, onMin, stayMin, spareMin: spare, leaveByLocal: leaveBy, windowMin, reach, routeProvider: to.provider, basis, evidenceIds, reason };
}
