// What the small clock statements in status-parse.ts DO. Every number here is stored state, a stated allowance, or a
// provider route; the words only decide which rule applies. Nothing moves a shared commitment: the worst this can do
// is raise (or withdraw) a clash, which a human still decides.
import { prisma } from "@/lib/prisma";
import { localNow, addDays, humanMoment } from "@/lib/when";
import { handleArrivalChange, evaluateConsequences } from "@/lib/disruption";
import { resolveFlightMinutes } from "./flight-time";
import { matchCommitment } from "@/lib/plan/parse";
import { geocodeAnchorText, genericLocations, appliesTo, buildRendezvousView } from "@/lib/rendezvous";
import { driveRoute } from "@/lib/travel/route-provider";
import { timeLabel } from "./journey";
import type { TravellerStatus } from "./status-parse";

const first = (n: string) => n.split(/\s+/)[0] ?? n;
const toMs = (l: string) => new Date(`${l}:00.000Z`).getTime();
const toLocal = (ms: number) => new Date(ms).toISOString().slice(0, 16);

export type StatusResult = { reply: string | null; changed: boolean; calls: { name: string; input: unknown }[] };

async function ev(tripId: string, kind: string, userId: string, sourceMessageId: string | null, payload: Record<string, unknown>) {
  await prisma.tripEvent
    .create({ data: { tripId, kind, scope: "GROUP", actorUserId: userId, subjectUserId: userId, sourceChannel: "GROUP", sourceMessageId, confidence: "HIGH", payload: JSON.stringify(payload), propagation: JSON.stringify(["plan", "chat"]) } })
    .catch(() => undefined);
}

const quietReply = (r: string | null) => (r && /already the time I have/i.test(r) ? null : r);

export async function handleTravellerStatus(p: { tripId: string; userId: string; messageId: string | null; status: TravellerStatus }): Promise<StatusResult> {
  const { tripId, userId, messageId, status: st } = p;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { name: true } });
  const me = first(user?.name ?? "there");
  const calls = [{ name: `traveller_status_${st.kind.toLowerCase()}`, input: { kind: st.kind } }];
  const journey = await prisma.travellerJourney.findFirst({ where: { tripId, userId, status: "CONFIRMED" }, orderBy: { createdAt: "desc" } });
  const now = localNow();

  // ---- recognised, and deliberately NOT acted on
  if (st.kind === "TENTATIVE_DELAY" || st.kind === "HISTORICAL_DELAY") {
    await ev(tripId, "TRAVELLER_STATUS_NOTED", userId, messageId, {
      traveller: user?.name ?? null,
      status: st.kind,
      changedArrival: false,
      confirmedArrival: journey?.arriveLocal ?? null,
      note: st.kind === "TENTATIVE_DELAY" ? "Possible delay, nothing confirmed. The confirmed arrival is untouched; no time was invented." : "About a past trip. No change to this trip.",
    });
    return { reply: null, changed: false, calls };
  }

  // ---- "I'm still at baggage claim": read against the journey we know, not a fresh allowance.
  // The standard allowance (15 min for bags and exits) runs from LANDING. If they are still inside within it, nothing
  // has changed. If it is already used up, they cannot be out before now: that is a floor, and the route is added to it.
  // How much longer it will take is unknowable from here, so it is asked, and the figure is labelled an estimate.
  if (st.kind === "AT_AIRPORT") {
    if (!journey?.arriveLocal) return { reply: null, changed: false, calls };
    const nowLocal = `${now.date}T${now.time}`;
    const landedMs = toMs(journey.arriveLocal);
    const elapsed = Math.floor((toMs(nowLocal) - landedMs) / 60_000);
    const stageWord = st.stage === "baggage" ? "baggage claim" : st.stage === "airport" ? "the airport" : st.stage;
    if (elapsed < 0) {
      await ev(tripId, "TRAVELLER_STATUS_NOTED", userId, messageId, { traveller: user?.name ?? null, status: "AT_AIRPORT", stage: st.stage, note: "Said before the landing time on the journey; nothing changed.", changedArrival: false });
      return { reply: null, changed: false, calls };
    }
    if (elapsed > 12 * 60) return { reply: null, changed: false, calls };
    const allowance = 15;
    if (elapsed < allowance) {
      await ev(tripId, "TRAVELLER_STATUS_NOTED", userId, messageId, { traveller: user?.name ?? null, status: "AT_AIRPORT", stage: st.stage, minutesSinceLanding: elapsed, note: `Still inside the ${allowance}-minute exit allowance counted from landing, so the estimate is unchanged.`, changedArrival: false });
      return { reply: null, changed: false, calls };
    }
    await prisma.travellerJourney.update({ where: { id: journey.id }, data: { notOutBeforeLocal: nowLocal } });
    await ev(tripId, "TRAVELLER_STATUS_NOTED", userId, messageId, { traveller: user?.name ?? null, status: "AT_AIRPORT", stage: st.stage, minutesSinceLanding: elapsed, notOutBefore: nowLocal, note: "The standard exit allowance is used up. They cannot be out before now; that floor, plus the route, replaces the allowance. How much longer is unknown, so the result is an earliest-possible estimate.", changedArrival: false });
    const r = await evaluateConsequences({ tripId, userId, sourceMessageId: messageId });
    const view = await buildRendezvousView(tripId);
    const clock = view.clocks.find((c) => c.userId === userId);
    const upcoming = (await prisma.commitment.findMany({ where: { tripId, status: { not: "CANCELLED" } }, orderBy: { targetTime: "asc" } })).filter((c) => appliesTo(c.participantIds)(userId) && toLocal(c.targetTime.getTime()) > nowLocal)[0];
    const next = upcoming ? { name: upcoming.name, target: toLocal(upcoming.targetTime.getTime()) } : null;
    const lead = `Thanks ${me}. You're ${elapsed} min past landing and still at ${stageWord}, so the ${allowance}-minute exit allowance is already used up. I'm counting from now.`;
    if (r.clashIds.length) return { reply: lead, changed: true, calls };
    const earliest = clock?.status === "KNOWN" && clock.hotelBy ? `At the earliest you'd be at ${view.stayName ?? "the stay"} around ${timeLabel(clock.hotelBy)} (leaving now plus ${clock.routeMinutes} min by ${clock.routeProvider === "delhivery" ? "Delhivery" : "Geoapify"}); that is an estimate, not a promise.` : "I can't measure the trip from the airport just now, so I can't say when you'd arrive.";
    const fits = clock?.status === "KNOWN" && clock.hotelBy && next && clock.hotelBy <= next.target ? ` That still makes ${next.name} (${timeLabel(next.target)}) if you leave soon.` : "";
    return { reply: `${lead} ${earliest}${fits} How much longer do you think you'll be?`, changed: true, calls };
  }

  // ---- "Actually, 8:15 is take-off, not landing"
  // A landing time is worked out ONLY from the journey's own departure and arrival times, each read in its own place's
  // time zone for that date. Without that, nothing is inferred: the minimum we know (it lands after take-off) stands, and
  // the question is asked.
  if (st.kind === "TAKEOFF_NOT_LANDING") {
    if (!journey?.arriveLocal) return { reply: `Thanks ${me}. I don't have a confirmed journey for you, so there's nothing for me to correct. Add it under You → Journey.`, changed: false, calls };
    const onRecord = journey.arriveLocal;
    const base = journey.departLocal?.slice(0, 10) ?? onRecord.slice(0, 10);
    // Which instant did they mean? The time they gave (both am/pm readings if it was ambiguous) on the departure day or the
    // days around it, whichever sits nearest the number that was mistaken for a landing.
    const times = st.time ? (st.guessedMeridiem ? [st.time, `${String((Number(st.time.slice(0, 2)) + 12) % 24).padStart(2, "0")}${st.time.slice(2)}`] : [st.time]) : [onRecord.slice(11)];
    const days = [base, addDays(base, 1), onRecord.slice(0, 10), addDays(onRecord.slice(0, 10), 1)];
    const takeoff = days.flatMap((d) => times.map((t) => `${d}T${t}`)).sort((x, y) => Math.abs(toMs(x) - toMs(onRecord)) - Math.abs(toMs(y) - toMs(onRecord)))[0];
    const dur = await resolveFlightMinutes(journey);
    await ev(tripId, "TRAVELLER_STATUS_NOTED", userId, messageId, { traveller: user?.name ?? null, status: "TAKEOFF_NOT_LANDING", takeoff, wasTreatedAsLanding: onRecord, flightMinutes: dur.ok ? dur.minutes : null, crossesZones: dur.ok ? dur.crossesZones : null, basis: dur.ok ? dur.basis : null, notEstimatedBecause: dur.ok ? null : dur.reason });
    if (dur.ok) {
      const landing = toLocal(toMs(takeoff) + dur.minutes * 60_000);
      const r = await handleArrivalChange({ tripId, userId, arrivalTime: landing.slice(11), arrivalDate: landing.slice(0, 10), sourceMessageId: messageId });
      const h = Math.floor(dur.minutes / 60);
      const m = dur.minutes % 60;
      const lead = `Thanks ${me}, corrected: ${timeLabel(takeoff)} is take-off, not landing. From ${dur.basis}, the flight is ${h}h${m ? ` ${m}m` : ""}, so I estimate you land about ${timeLabel(landing)}. That's an estimate; tell me the real landing time when you have it.`;
      return { reply: [lead, quietReply(r.reply)].filter(Boolean).join(" "), changed: true, calls };
    }
    return { reply: `Thanks ${me}, so ${timeLabel(takeoff)} is take-off, not landing. I haven't worked out a landing time because ${dur.reason}. You land after ${timeLabel(takeoff)} at the earliest, so anything the warning I raised said still holds as a minimum. When do you expect to land?`, changed: false, calls };
  }

  // ---- "I'll join you directly at dinner"
  if (st.kind === "JOIN_DIRECT") {
    if (!journey) return { reply: null, changed: false, calls };
    const rows = await prisma.commitment.findMany({ where: { tripId, status: { not: "CANCELLED" }, targetTime: { gt: new Date(Date.now() - 12 * 3600_000) } }, orderBy: { targetTime: "asc" } });
    const mine = rows.filter((c) => appliesTo(c.participantIds)(userId));
    const pool = mine.map((c) => ({ id: c.id, name: c.name, target: toLocal(c.targetTime.getTime()), participantIds: [] as string[] }));
    const chosen = st.target ? matchCommitment(st.target, pool).hit : pool[0] ?? null;
    if (st.target && !chosen) {
      const cands = matchCommitment(st.target, pool).candidates;
      return { reply: cands.length > 1 ? `Which one are you joining directly: ${cands.map((c) => c.name).join(" or ")}?` : `I couldn't find "${st.target}" in the Plan, so I haven't changed how I count your trip. Which plan do you mean?`, changed: false, calls };
    }
    if (!chosen) return { reply: null, changed: false, calls };
    const commitment = rows.find((c) => c.id === chosen!.id)!;

    // Measure the venue only when it is a real place; otherwise say so rather than route to the city centre.
    const generic = await genericLocations(tripId);
    let seconds: number | null = null;
    let meters: number | null = null;
    let provider: string | null = null;
    let why = "";
    const venue = commitment.location.trim();
    if (!venue || generic.has(venue.toLowerCase())) why = `${commitment.name} has no venue address in the Plan yet`;
    else if (journey.arrivalLat == null || journey.arrivalLng == null) why = "your arrival point isn't confirmed";
    else {
      const g = await geocodeAnchorText(tripId, venue).catch(() => null);
      if (!g) why = `I couldn't place "${venue}" on the map`;
      else {
        try {
          const dep = journey.arriveLocal ? toLocal(toMs(journey.arriveLocal) + 15 * 60_000) : null;
          const r = await driveRoute({ lat: journey.arrivalLat, lng: journey.arrivalLng }, { lat: g.lat, lng: g.lng }, { departLocal: dep, tripId, userId, decision: "Traveller will join a commitment directly: arrival point to the venue" });
          seconds = Math.round(r.durationSeconds);
          meters = Math.round(r.distanceMeters);
          provider = r.provider;
        } catch {
          why = "no routing provider answered just now";
        }
      }
    }
    await prisma.travellerJourney.update({ where: { id: journey.id }, data: { directToCommitmentId: commitment.id, directRouteSeconds: seconds, directRouteMeters: meters, directProvider: provider } });
    await ev(tripId, "TRAVELLER_ROUTE_INTENT_UPDATED", userId, messageId, { traveller: user?.name ?? null, commitment: commitment.name, via: "directly to the venue, not via the stay", measured: seconds != null, provider, minutes: seconds != null ? Math.round(seconds / 60) : null, unmeasuredBecause: seconds == null ? why : null, movedCommitment: false });
    const r = await evaluateConsequences({ tripId, userId, sourceMessageId: messageId });
    const base = `Got it, ${me} is joining ${commitment.name} directly, so I'm no longer counting ${me}'s trip via the stay for it. Nothing in the Plan moved.`;
    const tail = seconds == null ? ` I can't check whether ${me} will make it (${why}). ${/venue address|couldn't place/.test(why) ? `Where is ${commitment.name}?` : ""}`.trimEnd() : r.clashIds.length ? "" : ` By the ${provider === "delhivery" ? "Delhivery" : "Geoapify"} route (${Math.round(seconds / 60)} min from the airport plus the bags-and-exits allowance), that works.`;
    return { reply: [base + tail, r.reply].filter(Boolean).join(" "), changed: true, calls };
  }

  // ---- "Kal subah aaungi, aaj nahi"
  if (st.kind === "REL_DAY") {
    if (!journey?.arriveLocal) return { reply: `Got it, ${me}: ${humanMoment(`${st.date}T${st.time ?? "00:00"}`).split(",")[0]}. I don't have a confirmed journey for you yet, so I can't check the Plan against it. Add it under You → Journey.`, changed: false, calls };
    const dayWord = st.date === addDays(now.date, 1) ? "tomorrow" : st.date === now.date ? "today" : humanMoment(`${st.date}T00:00`).split(",")[0];
    const stated = `${dayWord}${st.part ? ` ${st.part}` : ""}`;
    await ev(tripId, "TRAVELLER_STATUS_NOTED", userId, messageId, { traveller: user?.name ?? null, status: "RELATIVE_DAY", resolved: st.date, part: st.part, time: st.time, tripTimezone: "Asia/Kolkata", from: "Hindi/Hinglish, resolved against the trip's own calendar day", changedArrival: Boolean(st.time) });
    if (st.time) {
      const r = await handleArrivalChange({ tripId, userId, arrivalTime: st.time, arrivalDate: st.date, sourceMessageId: messageId });
      return { reply: [`Got it, ${me}: ${stated} (${humanMoment(`${st.date}T${st.time}`)}).`, quietReply(r.reply)].filter(Boolean).join(" "), changed: true, calls };
    }
    // Which stored commitments does arriving that day (not earlier) rule out? Only those clearly before it.
    const rows = await prisma.commitment.findMany({ where: { tripId, status: { not: "CANCELLED" } }, orderBy: { targetTime: "asc" } });
    const startOfPart = st.part === "morning" ? "06:00" : st.part === "afternoon" ? "12:00" : st.part === "evening" ? "17:00" : st.part === "night" ? "20:00" : "00:00";
    const earliest = `${st.date}T${startOfPart}`;
    const missed = rows.filter((c) => appliesTo(c.participantIds)(userId) && toLocal(c.targetTime.getTime()) < earliest && toLocal(c.targetTime.getTime()) >= `${journey.arriveLocal!.slice(0, 10)}T00:00`);
    const list = missed.map((c) => `${c.name} (${timeLabel(toLocal(c.targetTime.getTime()))})`);
    return {
      reply: `Got it, ${me}: ${stated}, not ${journey.arriveLocal.slice(0, 10) === st.date ? "earlier" : "today"}. ${list.length ? `That would mean missing ${list.join(" and ")}.` : "That doesn't clash with anything in the Plan."} What time does it land? I haven't changed your arrival yet.`,
      changed: false,
      calls,
    };
  }

  return { reply: null, changed: false, calls };
}
