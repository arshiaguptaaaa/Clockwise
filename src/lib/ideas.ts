// CLOCKWISE HAS AN IDEA: connecting loose pointers into a possible plan.
//   PASSIVE POINTER  -> something Clockwise noticed                          (TripPointer)
//   SUGGESTION       -> several pointers + a real free window + real places  (TripSuggestion, this file)
//   PROPOSAL         -> the group is formally asked                          (Proposal, only after PROPOSE)
//   CONFIRMED PLAN   -> Commitments, only after votes + organiser confirmation
// This file builds suggestions. It never creates a Commitment and never creates a Proposal; those are separate,
// explicit steps with their own authority. Every number in a suggestion is a provider route or the Plan itself.
import { prisma } from "@/lib/prisma";
import { postActionCard } from "@/lib/action-cards";
import { getTripById } from "@/lib/trip";
import { getTripStay } from "@/lib/stays";
import { driveRoute } from "@/lib/travel/route-provider";
import { searchForIntent, resolveIntentAnchor, groupDietFor, type ChainStep } from "@/lib/travel/place-search";
import { parsePlaceIntent, KEYWORDS, type PlaceIntent } from "@/lib/travel/place-intent";
import { anchorsFor } from "@/lib/travel/around";
import { loadPointers, groupInterests, type Interest, type PointerRow } from "@/lib/pointers/store";
import { localNow, parseDay, addDays, humanMoment, type DayWindow } from "@/lib/when";
import { timeLabel } from "@/lib/traveller/journey";

export type IdeaStep = {
  kind: "place" | "food" | "return";
  name: string;
  at: string | null; // local wall-clock YYYY-MM-DDTHH:mm; null = not a Plan item (e.g. "back at the stay")
  location: string | null;
  note: string | null;
  provider: string | null;
  providerPlaceId: string | null;
  lat: number | null;
  lng: number | null;
};

export type IdeaCardData = { suggestionId: string; title: string; why: string; steps: IdeaStep[]; windowLabel: string; intro: string | null };

const FOODISH = /\b(dosa|dosai|idli|vada|biryani|thali|coffee|chai|tea|food|brunch|breakfast|lunch|dinner|cake|dessert|ice cream|pizza|momos?|chaat|south indian|street food|sweets?|bakery|cafe|café|filter coffee|burger)\b/i;
const first = (n: string) => n.split(/\s+/)[0] ?? n;
const title = (s: string) => s.replace(/\b([a-z])/g, (c) => c.toUpperCase());
const pad = (n: number) => String(n).padStart(2, "0");
const addMin = (local: string, m: number) => new Date(Date.parse(`${local}:00Z`) + m * 60_000).toISOString().slice(0, 16);
const diffMin = (a: string, b: string) => Math.round((Date.parse(`${b}:00Z`) - Date.parse(`${a}:00Z`)) / 60_000);
const ceilQuarter = (local: string) => {
  const d = new Date(`${local}:00Z`);
  const m = d.getUTCMinutes();
  const up = Math.ceil(m / 15) * 15;
  d.setUTCMinutes(up, 0, 0);
  return d.toISOString().slice(0, 16);
};

type Part = "morning" | "afternoon" | "evening" | "day";
const PART_RANGE: Record<Part, [string, string]> = { morning: ["09:00", "12:30"], afternoon: ["13:00", "18:00"], evening: ["17:30", "21:30"], day: ["09:00", "21:00"] };
export const partOf = (t: string): Part => (/\bmorning\b/i.test(t) ? "morning" : /\bafternoon\b/i.test(t) ? "afternoon" : /\b(evening|night|tonight)\b/i.test(t) ? "evening" : "day");

export async function tripDayWindow(tripId: string): Promise<DayWindow> {
  const t = await prisma.trip.findUnique({ where: { id: tripId }, select: { coreStartDate: true, coreEndDate: true } });
  return { start: t?.coreStartDate?.toISOString().slice(0, 10) ?? null, end: t?.coreEndDate?.toISOString().slice(0, 10) ?? null };
}

// The biggest stretch inside the part of the day that no shared plan item is using (with room either side).
async function freeSlot(tripId: string, date: string, part: Part): Promise<{ start: string; end: string; nextAfter: { name: string; at: string } | null } | null> {
  const [from, to] = PART_RANGE[part];
  let lo = `${date}T${from}`;
  const hi = `${date}T${to}`;
  const rows = await prisma.commitment.findMany({ where: { tripId, status: { not: "CANCELLED" } }, orderBy: { targetTime: "asc" } });
  const todays = rows.map((c) => ({ name: c.name, at: c.targetTime.toISOString().slice(0, 16) })).filter((c) => c.at.slice(0, 10) === date);
  // a plan item holds the room from 30 min before it to 90 min after it starts
  const blocks = todays.map((c) => [addMin(c.at, -30), addMin(c.at, 90), c] as const).sort((a, b) => (a[0] < b[0] ? -1 : 1));
  let best: { start: string; end: string } | null = null;
  let cursor = lo;
  for (const [bs, be] of blocks) {
    if (bs > cursor) {
      const end = bs < hi ? bs : hi;
      if (diffMin(cursor, end) > diffMin(best?.start ?? end, best?.end ?? end)) best = { start: cursor, end };
    }
    if (be > cursor) cursor = be;
  }
  if (cursor < hi && diffMin(cursor, hi) > diffMin(best?.start ?? hi, best?.end ?? hi)) best = { start: cursor, end: hi };
  if (!best || diffMin(best.start, best.end) < 90) return null;
  lo = best.start;
  const nextAfter = todays.filter((c) => c.at >= best!.end).sort((a, b) => (a.at < b.at ? -1 : 1))[0] ?? null;
  return { start: lo, end: best.end, nextAfter };
}

const isFood = (i: Interest) => FOODISH.test(i.subject);

function intentFor(subject: string, anchorText: string): PlaceIntent {
  const kw = KEYWORDS.find((k) => k.re.test(subject))?.keyword ?? null;
  const base = parsePlaceIntent(subject);
  const category = kw?.category ?? base.category ?? (/(coffee|cafe|café|chai|tea)/i.test(subject) ? "cafe" : "restaurant");
  return { raw: subject, what: kw?.word ?? null, keyword: kw, category, diet: null, anchor: { kind: "explicit", text: anchorText }, defaulted: false, nearWho: null };
}

export type IdeaOutcome =
  | { ok: true; suggestionId: string; messageId: string; card: IdeaCardData; chain: ChainStep[] }
  | { ok: false; reason: string };

const peopleList = (names: string[]) => (names.length <= 1 ? names[0] ?? "" : names.length === 2 ? `${names[0]} and ${names[1]}` : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`);

// Builds ONE idea for a window and posts it as a card. `when` is the user's own words ("Saturday afternoon"); if
// it names no day, the first WINDOW pointer is used. Returns why not, honestly, when it can't.
export async function buildIdea(params: { tripId: string; userId: string; when?: string | null; intro?: string | null; focusSubject?: string | null }): Promise<IdeaOutcome> {
  const { tripId, userId } = params;
  const chain: ChainStep[] = [];
  const [pointers, window, stay, anchors, trip] = await Promise.all([loadPointers(tripId), tripDayWindow(tripId), getTripStay(tripId), anchorsFor(tripId, userId), getTripById(tripId)]);
  const now = localNow();

  // WHEN
  const windowPointer = pointers.find((p) => p.kind === "WINDOW");
  const whenText = params.when ?? windowPointer?.subject ?? "";
  const day = parseDay(whenText, now, window);
  if (!day) return { ok: false, reason: "Which day should I plan around? Say something like “Saturday afternoon” and I'll find what fits." };
  const part = partOf(whenText);
  const slot = await freeSlot(tripId, day.date, part);
  if (!slot) return { ok: false, reason: `${humanMoment(`${day.date}T12:00`).split(",")[0]} ${part === "day" ? "" : part} is already taken by the Plan, so there's no free stretch to build around.`.replace(/\s+/g, " ") };

  // WHAT: the group's interests, strongest first
  const interests = groupInterests(pointers).sort((a, b) => Number(b.must) - Number(a.must) || b.peopleIds.length - a.peopleIds.length || b.mentions - a.mentions);
  const focus = params.focusSubject ? interests.find((i) => i.subject === params.focusSubject) : null;
  const place = focus && !isFood(focus) ? focus : interests.find((i) => !isFood(i));
  const food = interests.find((i) => isFood(i) && i.subject !== place?.subject && !/coffee|cafe|café|chai|tea/i.test(i.subject)) ?? interests.find((i) => isFood(i) && i.subject !== place?.subject);
  if (!place && !food) return { ok: false, reason: "Nobody has said what they'd like to do yet. Tell me a place or a dish and I'll build around it." };

  const origin = anchors.stay?.point ?? anchors.destination?.point ?? null;
  const originLabel = anchors.stay ? "the stay" : "the centre";
  const cityText = (trip.destinations[0]?.name ?? "").split(",")[0];
  const steps: IdeaStep[] = [];
  let cursor = slot.start;

  const hops: string[] = [];
  let placePoint: { lat: number; lng: number } | null = null;
  if (place) {
    const res = await resolveIntentAnchor(tripId, userId, intentFor(place.subject, `${title(place.subject)} ${cityText}`.trim()), null, chain);
    if (!res.ok) return { ok: false, reason: `I couldn't find ${title(place.subject)} on the map, so I won't build an idea around it.` };
    placePoint = res.anchor.point;
    let travel = 20;
    if (origin) {
      try {
        const r = await driveRoute(origin, res.anchor.point, { departLocal: cursor, tripId, userId, decision: "Idea: leg from the stay to the place the group wants" });
        travel = Math.max(5, Math.round(r.durationSeconds / 60));
        chain.push({ step: "route", provider: r.provider, status: r.fellBackFrom ? "fallback" : "ok", detail: r.fellBackFrom });
        hops.push(`${travel} min from ${originLabel} (${r.provider === "delhivery" ? "Delhivery" : "Geoapify"})`);
      } catch {
        hops.push(`route unavailable`);
      }
    }
    const at = ceilQuarter(addMin(cursor, travel));
    steps.push({ kind: "place", name: title(res.anchor.label), at, location: title(res.anchor.label), note: hops[0] ? `${hops[0]} · ~75 min there` : "~75 min there", provider: null, providerPlaceId: null, lat: res.anchor.point.lat, lng: res.anchor.point.lng });
    cursor = addMin(at, 75);
  }

  if (food) {
    const dietG = await groupDietFor(tripId);
    const fromPoint = placePoint ?? origin;
    const intent = intentFor(food.subject, "");
    const out = fromPoint
      ? await searchForIntent({ tripId, userId, intent, groupDiet: dietG, atLocal: addMin(cursor, 15), anchorOverride: { anchor: { kind: "anywhere", label: place ? title(place.subject) : originLabel, point: fromPoint }, why: place ? title(place.subject) : originLabel } })
      : null;
    if (out && out.ok && out.places.length > 0) {
      chain.push(...out.chain);
      // Never suggest a place its own opening hours say is shut at that time.
      const top = out.places.find((x) => !x.hours?.startsWith("Closed")) ?? null;
      if (!top) {
        chain.push(...out.chain);
      } else {
      let travel = top.walkMinutes ?? 12;
      if (placePoint && top.walkMinutes == null) {
        try {
          const r = await driveRoute(placePoint, { lat: top.latitude, lng: top.longitude }, { departLocal: cursor, tripId, userId, decision: "Idea: leg from the place to the food stop" });
          travel = Math.max(5, Math.round(r.durationSeconds / 60));
          chain.push({ step: "route", provider: r.provider, status: r.fellBackFrom ? "fallback" : "ok", detail: r.fellBackFrom });
        } catch {
          // keep the walk estimate
        }
      }
      const at = ceilQuarter(addMin(cursor, travel));
      const word = intent.keyword?.word ?? title(food.subject);
      steps.push({ kind: "food", name: top.name, at, location: top.formattedAddress ?? top.name, note: [top.why ?? top.matched, top.hours].filter(Boolean).join(" · ") || `${word}, from ${out.provider === "geoapify" ? "Geoapify" : out.provider}`, provider: top.provider, providerPlaceId: top.providerPlaceId, lat: top.latitude, lng: top.longitude });
      cursor = addMin(at, 50);
      }
    }
  }
  if (steps.length === 0) return { ok: false, reason: "I couldn't find real places to build that around right now, so I haven't suggested anything." };

  // BACK IN TIME: the way back is a real route, and the whole thing must end before the next shared item.
  if (origin && steps.length) {
    const last = steps[steps.length - 1];
    if (last.lat != null && last.lng != null) {
      try {
        const r = await driveRoute({ lat: last.lat, lng: last.lng }, origin, { departLocal: cursor, tripId, userId, decision: "Idea: the way back to the stay" });
        const back = ceilQuarter(addMin(cursor, Math.max(5, Math.round(r.durationSeconds / 60))));
        chain.push({ step: "route", provider: r.provider, status: r.fellBackFrom ? "fallback" : "ok", detail: r.fellBackFrom });
        steps.push({ kind: "return", name: `Back at ${anchors.stay ? anchors.stay.label.split(",")[0] : "the centre"}`, at: null, location: null, note: `about ${timeLabel(back)}`, provider: r.provider, providerPlaceId: null, lat: null, lng: null });
        if (slot.nextAfter && back > addMin(slot.nextAfter.at, -20)) {
          return { ok: false, reason: `That wouldn't get everyone back before ${slot.nextAfter.name} (${timeLabel(slot.nextAfter.at)}), so I haven't suggested it.` };
        }
      } catch {
        // no return leg without a real route
      }
    }
  }

  // WHY: only what was actually said and what the Plan actually holds.
  const said: string[] = [];
  const names = (i: Interest) => peopleList(i.people);
  if (place) said.push(place.must && place.people.length === 1 ? `${names(place)} said ${title(place.subject)} is a must` : `${names(place)} ${place.people.length > 1 ? "both mentioned" : "mentioned"} ${title(place.subject)}`);
  if (food) said.push(`${names(food)} ${food.people.length > 1 ? "both " : ""}${food.kind === "LIKE" ? (food.people.length > 1 ? "like" : "likes") : food.people.length > 1 ? "want" : "wants"} ${food.subject}`);
  const dietRows = pointers.filter((p) => p.kind === "DIET");
  if (dietRows.length) said.push(`${peopleList([...new Set(dietRows.map((p) => p.userName))])} ${dietRows.length > 1 ? "are" : "is"} ${[...new Set(dietRows.map((p) => p.subject))].join("/")}`);
  const coffee = pointers.find((p) => /coffee|cafe|café/.test(p.subject) && p.kind !== "AVOID");
  if (coffee && !food?.subject.match(/coffee|cafe|café/)) said.push(`${coffee.userName} likes ${coffee.subject}`);
  const dayName = new Date(`${day.date}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", timeZone: "UTC" });
  const windowLabel = `${dayName}${part === "day" ? "" : ` ${part}`}`;
  const why = `${said.join("; ")}. ${windowLabel} is open${slot.nextAfter ? ` until ${slot.nextAfter.name}` : ""}.`.replace(/^\s*;\s*/, "");

  const ideaTitle = steps.filter((s) => s.kind !== "return").map((s) => s.name).join(" → ");
  const row = await prisma.tripSuggestion.create({
    data: {
      tripId,
      title: ideaTitle,
      why,
      steps: JSON.stringify(steps),
      windowStart: slot.start,
      windowEnd: slot.end,
      pointerIds: JSON.stringify([place, food].filter(Boolean).flatMap((i) => i!.pointerIds)),
      createdBy: userId,
    },
  });
  await prisma.tripPointer.updateMany({ where: { id: { in: [place, food].filter(Boolean).flatMap((i) => i!.pointerIds) }, status: "ACTIVE" }, data: { status: "SUGGESTED" } });

  const card: IdeaCardData = { suggestionId: row.id, title: ideaTitle, why, steps, windowLabel, intro: params.intro ?? null };
  const msg = await postActionCard({
    tripId,
    channel: "GROUP",
    type: "IDEA",
    status: "PENDING",
    data: { title: ideaTitle, context: why, idea: card },
  });
  await prisma.tripSuggestion.update({ where: { id: row.id }, data: { messageId: msg.id } });
  await prisma.tripEvent
    .create({
      data: {
        tripId,
        kind: "SUGGESTION_CREATED",
        scope: "GROUP",
        actorUserId: userId,
        sourceChannel: "SYSTEM",
        confidence: "MEDIUM",
        payload: JSON.stringify({ suggestionId: row.id, title: ideaTitle, window: { start: slot.start, end: slot.end }, steps: steps.map((s) => ({ kind: s.kind, name: s.name, at: s.at, provider: s.provider })), chain, stage: "SUGGESTION", note: "Nothing is in the Plan. The group has not been asked yet." }),
        propagation: JSON.stringify(["chat", "plan"]),
      },
    })
    .catch(() => undefined);
  return { ok: true, suggestionId: row.id, messageId: msg.id, card, chain };
}

// The intervention threshold for passive ideas: more than one person is leaning the same way, or it keeps coming
// up, AND there is a real free day to put it in. A single "Cubbon Park is non-negotiable" stays a quiet pointer.
export async function maybeSurfaceIdea(tripId: string, userId: string): Promise<IdeaOutcome | null> {
  const open = await prisma.tripSuggestion.findFirst({ where: { tripId, status: { in: ["OPEN", "PROPOSED"] } }, orderBy: { createdAt: "desc" } });
  if (open && Date.now() - open.createdAt.getTime() < 30 * 60_000) return null;
  const pointers = await loadPointers(tripId, ["ACTIVE"]);
  const interests = groupInterests(pointers).filter((i) => !isFood(i) || i.peopleIds.length > 1);
  const hot = interests.find((i) => i.peopleIds.length >= 2 || i.mentions >= 3);
  if (!hot) return null;
  const windowPointer = pointers.find((p) => p.kind === "WINDOW");
  const win = await tripDayWindow(tripId);
  // Without a stated window, the first free afternoon inside the trip.
  let when = windowPointer?.subject ?? "";
  if (!parseDay(when, localNow(), win)) {
    const start = win.start && win.start > localNow().date ? win.start : addDays(localNow().date, 1);
    for (let d = 0; d < 7; d++) {
      const date = addDays(start, d);
      if (win.end && date > win.end) break;
      if (await freeSlot(tripId, date, "afternoon")) {
        when = `${date} afternoon`;
        break;
      }
    }
  }
  if (!when) return null;
  const crowd = peopleList(hot.people);
  const intro = hot.people.length >= 2 ? `Looks like ${title(hot.subject)} is winning 👀 ${crowd} are up for it.` : `${title(hot.subject)} has come up ${hot.mentions} times.`;
  const out = await buildIdea({ tripId, userId, when, intro, focusSubject: hot.subject });
  return out;
}

export type { PointerRow };
