// Personal traveller state and its group-safe projection.
//
// The rule this module exists to enforce: the group sees EFFECT, never
// private CAUSE. A constraint a traveller shares privately is stored in full
// (including their own words) for them and for server-side feasibility
// maths, but every sentence that can reach the group is produced by
// groupSafeLine() from the structured fields only. There is deliberately no
// code path from `note` (or from model-written text) into a group-visible
// string.
import { prisma } from "./prisma";

export type ConstraintKind = "LATEST_END" | "EARLIEST_START";

export type ConstraintLike = {
  userId: string;
  kind: string;
  localTime: string;
  onDate: Date | null;
};

// "22:30" -> 1350. Accepts only strict 24h HH:MM; anything else is null so
// a malformed model value is rejected rather than guessed.
export function parseHHMM(value: string): number | null {
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(value.trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

export function formatTime12(hhmm: string): string {
  const minutes = parseHHMM(hhmm);
  if (minutes == null) return hhmm;
  const h24 = Math.floor(minutes / 60);
  const mm = String(minutes % 60).padStart(2, "0");
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${mm} ${h24 < 12 ? "AM" : "PM"}`;
}

export function groupSafeLine(name: string, kind: string, localTime: string): string {
  return kind === "LATEST_END"
    ? `${name} is unavailable after ${formatTime12(localTime)}`
    : `${name} is unavailable before ${formatTime12(localTime)}`;
}

const sameUtcDay = (a: Date, b: Date) => a.toISOString().slice(0, 10) === b.toISOString().slice(0, 10);

// Which constraints does an event starting at `time` (and lasting
// `durationMinutes`) violate? With no date supplied, dated constraints are
// still reported — warning too much is safer than silently missing one.
export function conflictsAt<T extends ConstraintLike>(
  constraints: T[],
  time: string,
  date: Date | null,
  durationMinutes = 0
): T[] {
  const start = parseHHMM(time);
  if (start == null) return [];
  const end = start + Math.max(0, durationMinutes);
  return constraints.filter((c) => {
    if (date && c.onDate && !sameUtcDay(c.onDate, date)) return false;
    const limit = parseHHMM(c.localTime);
    if (limit == null) return false;
    return c.kind === "LATEST_END" ? end > limit || start >= limit : start < limit;
  });
}

// --- persistence -----------------------------------------------------------

export type RecordConstraintInput = {
  tripId: string;
  subjectUserId: string;
  actorUserId: string;
  channel: "GROUP" | "PRIVATE";
  kind: ConstraintKind;
  localTime: string;
  onDate: Date | null;
  note: string | null;
  sourceMessageId: string | null;
  confidence: "MEDIUM" | "HIGH";
};

export async function recordPersonalConstraint(input: RecordConstraintInput) {
  if (parseHHMM(input.localTime) == null) {
    return { ok: false as const, error: `"${input.localTime}" isn't a valid 24-hour time (expected HH:MM).` };
  }
  const isPrivate = input.channel === "PRIVATE";

  // A newer statement of the same limit replaces the old one — never two
  // contradictory ACTIVE rows (the "6 PM" then "actually 5:30" case).
  const superseded = await prisma.travellerConstraint.updateMany({
    where: {
      tripId: input.tripId,
      userId: input.subjectUserId,
      kind: input.kind,
      onDate: input.onDate,
      status: "ACTIVE",
    },
    data: { status: "SUPERSEDED" },
  });

  const event = await prisma.tripEvent.create({
    data: {
      tripId: input.tripId,
      kind: "TRAVELLER_CONSTRAINT_SET",
      scope: isPrivate ? "PERSONAL" : "GROUP",
      actorUserId: input.actorUserId,
      subjectUserId: input.subjectUserId,
      sourceChannel: input.channel,
      sourceMessageId: input.sourceMessageId,
      confidence: input.confidence,
      // Structured fields only — the traveller's own words stay in the
      // constraint row's `note`, never in an event anyone else could render.
      payload: JSON.stringify({
        constraintKind: input.kind,
        localTime: input.localTime,
        onDate: input.onDate?.toISOString().slice(0, 10) ?? null,
        replacedPrevious: superseded.count > 0,
      }),
      propagation: JSON.stringify(["feasibility"]),
    },
  });

  const row = await prisma.travellerConstraint.create({
    data: {
      tripId: input.tripId,
      userId: input.subjectUserId,
      kind: input.kind,
      localTime: input.localTime,
      onDate: input.onDate,
      note: input.note,
      visibility: isPrivate ? "AGENT_ONLY" : "GROUP",
      sourceEventId: event.id,
    },
  });
  return { ok: true as const, constraintId: row.id, replacedPrevious: superseded.count > 0 };
}

export type FeasibilityResult = {
  conflicts: { userId: string; name: string; line: string }[];
  travellersChecked: number;
  withKnownLimits: number;
};

// Server-side feasibility over EVERYONE's active constraints — private ones
// included — returning only group-safe sentences. Callers (the agent) never
// receive raw private values.
export async function checkFeasibility(
  tripId: string,
  time: string,
  date: Date | null,
  durationMinutes = 0
): Promise<FeasibilityResult> {
  const [members, constraints] = await Promise.all([
    prisma.tripMember.findMany({ where: { tripId }, include: { user: true } }),
    prisma.travellerConstraint.findMany({ where: { tripId, status: "ACTIVE" } }),
  ]);
  const nameOf = new Map(members.map((m) => [m.userId, m.user.name]));
  const hit = conflictsAt(constraints, time, date, durationMinutes);
  return {
    conflicts: hit.map((c) => ({
      userId: c.userId,
      name: nameOf.get(c.userId) ?? "A traveller",
      line: groupSafeLine(nameOf.get(c.userId) ?? "A traveller", c.kind, c.localTime),
    })),
    travellersChecked: members.length,
    withKnownLimits: new Set(constraints.map((c) => c.userId)).size,
  };
}

// What the PRIVATE agent may recall about this one traveller — their own
// active limits and recent private understanding. Never anyone else's.
export async function privateStateLines(tripId: string, userId: string): Promise<string[]> {
  const [constraints, events] = await Promise.all([
    prisma.travellerConstraint.findMany({ where: { tripId, userId, status: "ACTIVE" }, orderBy: { createdAt: "desc" } }),
    prisma.tripEvent.findMany({
      where: { tripId, scope: "PERSONAL", subjectUserId: userId, kind: "PERSONAL_UNDERSTANDING" },
      orderBy: { createdAt: "desc" },
      take: 8,
    }),
  ]);
  const lines: string[] = [];
  const prefRows = await prisma.travellerPreference.findMany({ where: { tripId, userId, key: { not: "ORIGIN" } } });
  const byKey = new Map<string, string[]>();
  for (const r of prefRows) byKey.set(r.key, [...(byKey.get(r.key) ?? []), r.value]);
  if (byKey.size) {
    lines.push(`Private vibe-check preferences (never mention or hint at these in the group room): ${[...byKey.entries()].map(([k, v]) => `${k.toLowerCase()}=${v.join("/")}`).join("; ")}`);
  }
  for (const c of constraints) {
    const when = c.onDate ? ` on ${c.onDate.toISOString().slice(0, 10)}` : "";
    lines.push(`Recorded limit: ${c.kind === "LATEST_END" ? "must be done/back by" : "can't start before"} ${formatTime12(c.localTime)}${when}${c.note ? ` (${c.note})` : ""}`);
  }
  for (const e of events) {
    try {
      const p = JSON.parse(e.payload) as { category?: string; value?: string };
      if (p.value) lines.push(`Told privately: ${p.category ? `${p.category}: ` : ""}${p.value}`);
    } catch {
      // skip malformed legacy payloads
    }
  }
  return lines;
}
