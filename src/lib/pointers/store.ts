// Passive pointers: what Clockwise picked up, who said it, who agreed. Memory, not Plan.
//   PASSIVE POINTER -> SUGGESTION (src/lib/ideas.ts) -> PROPOSAL (Proposal) -> CONFIRMED PLAN (Commitment)
// Nothing in this file creates a Commitment, a Proposal or a chat message.
import { prisma } from "@/lib/prisma";
import { extractPointers, isAgreement, type ExtractedPointer, type PointerKind } from "./extract";

export type PointerRow = {
  id: string;
  userId: string;
  userName: string;
  kind: string;
  subject: string;
  label: string;
  supporterIds: string[];
  supporterNames: string[];
  mentions: number;
  status: string;
};

const parseIds = (json: string): string[] => {
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
};

const DIET_VALUE: Record<string, string> = { vegetarian: "VEGETARIAN", vegan: "VEGAN", eggetarian: "EGGETARIAN" };

async function logCaptured(tripId: string, userId: string, messageId: string | null, p: ExtractedPointer, mentions: number, isNew: boolean) {
  await prisma.tripEvent
    .create({
      data: {
        tripId,
        kind: "POINTER_CAPTURED",
        scope: "GROUP",
        actorUserId: userId,
        sourceChannel: "GROUP",
        sourceMessageId: messageId,
        confidence: "HIGH",
        payload: JSON.stringify({ kind: p.kind, subject: p.subject, label: p.label, mentions, isNew, stage: "PASSIVE_POINTER", note: "Memory only. Not a plan item." }),
        propagation: JSON.stringify(["picked-up", "my-clockwise"]),
      },
    })
    .catch(() => undefined);
}

export async function recordPointer(params: { tripId: string; userId: string; messageId: string | null } & ExtractedPointer): Promise<{ id: string; mentions: number; isNew: boolean }> {
  const { tripId, userId, messageId, kind, subject, label } = params;
  const key = { tripId_userId_kind_subject: { tripId, userId, kind, subject } };
  const existing = await prisma.tripPointer.findUnique({ where: key });
  if (existing) {
    const again = messageId && existing.sourceMessageId !== messageId;
    const row = again
      ? await prisma.tripPointer.update({ where: { id: existing.id }, data: { mentions: { increment: 1 }, sourceMessageId: messageId, status: existing.status === "DISMISSED" ? "ACTIVE" : existing.status } })
      : existing;
    if (again) await logCaptured(tripId, userId, messageId, { kind: kind as PointerKind, subject, label }, row.mentions, false);
    return { id: row.id, mentions: row.mentions, isNew: false };
  }
  const row = await prisma.tripPointer.create({ data: { tripId, userId, kind, subject, label, sourceMessageId: messageId } });
  await logCaptured(tripId, userId, messageId, { kind: kind as PointerKind, subject, label }, 1, true);
  return { id: row.id, mentions: 1, isNew: true };
}

// A diet the traveller STATED about themselves also lands in their own traveller memory (the same store the
// vibe check and Around You read), so "vegetarian" shows under My Clockwise and steers place ranking.
export async function rememberDiet(tripId: string, userId: string, subject: string) {
  const value = DIET_VALUE[subject];
  if (!value) return;
  await prisma.travellerPreference
    .upsert({
      where: { tripId_userId_key_value: { tripId, userId, key: "FOOD", value } },
      create: { tripId, userId, key: "FOOD", value, visibility: "GROUP", source: "CHAT" },
      update: {},
    })
    .catch((err) => console.error("[pointers] diet memory failed:", err instanceof Error ? err.message : err));
}

// Reads one fresh group message: captures pointers, and counts a bare "same / yes / me too" as support for what
// the previous person just floated. Returns what it did so the caller can log it. Never replies.
export async function observeMessage(params: { tripId: string; userId: string; messageId: string; text: string; extraPointers?: ExtractedPointer[] }) {
  const { tripId, userId, messageId, text } = params;
  const captured: { id: string; kind: string; subject: string; label: string; mentions: number; isNew: boolean }[] = [];
  const supported: string[] = [];

  const found = [...extractPointers(text), ...(params.extraPointers ?? [])];
  for (const p of found) {
    const r = await recordPointer({ tripId, userId, messageId, ...p });
    captured.push({ id: r.id, ...p, mentions: r.mentions, isNew: r.isNew });
    if (p.kind === "DIET") await rememberDiet(tripId, userId, p.subject);
  }

  if (found.length === 0 && isAgreement(text)) {
    const prev = await prisma.message.findFirst({
      where: { tripId, channel: "GROUP", cardType: null, timestamp: { lt: (await prisma.message.findUnique({ where: { id: messageId }, select: { timestamp: true } }))?.timestamp ?? new Date() } },
      orderBy: { timestamp: "desc" },
      select: { id: true, senderId: true, timestamp: true },
    });
    if (prev && prev.senderId !== userId && Date.now() - prev.timestamp.getTime() < 30 * 60_000) {
      const rows = await prisma.tripPointer.findMany({ where: { tripId, sourceMessageId: prev.id, kind: { in: ["WANT", "MUST", "LIKE"] } } });
      for (const row of rows) {
        const ids = parseIds(row.supporterIds);
        if (ids.includes(userId) || row.userId === userId) continue;
        await prisma.tripPointer.update({ where: { id: row.id }, data: { supporterIds: JSON.stringify([...ids, userId]), mentions: { increment: 1 } } });
        supported.push(row.subject);
        await prisma.tripEvent
          .create({
            data: {
              tripId,
              kind: "POINTER_SUPPORTED",
              scope: "GROUP",
              actorUserId: userId,
              sourceChannel: "GROUP",
              sourceMessageId: messageId,
              confidence: "MEDIUM",
              payload: JSON.stringify({ subject: row.subject, label: row.label, supporters: ids.length + 1, stage: "PASSIVE_POINTER", note: "Interest, not permission. Not a plan item." }),
              propagation: JSON.stringify(["picked-up"]),
            },
          })
          .catch(() => undefined);
      }
    }
  }
  return { captured, supported };
}

export async function loadPointers(tripId: string, statuses: string[] = ["ACTIVE", "SUGGESTED", "PROPOSED"]): Promise<PointerRow[]> {
  const rows = await prisma.tripPointer.findMany({ where: { tripId, status: { in: statuses } }, orderBy: { createdAt: "asc" } });
  if (rows.length === 0) return [];
  const wanted = [...new Set(rows.flatMap((r) => [r.userId, ...parseIds(r.supporterIds)]))];
  const users = await prisma.user.findMany({ where: { id: { in: wanted } }, select: { id: true, name: true } });
  const name = new Map(users.map((u) => [u.id, u.name.split(" ")[0]]));
  return rows.map((r) => ({ id: r.id, userId: r.userId, userName: name.get(r.userId) ?? "Someone", kind: r.kind, subject: r.subject, label: r.label, supporterIds: parseIds(r.supporterIds), supporterNames: parseIds(r.supporterIds).map((i) => name.get(i) ?? "Someone"), mentions: r.mentions, status: r.status }));
}

// "Ridhima wants to try dosa." One line per pointer, in the order they came up.
export const pointerLine = (p: PointerRow) => `${p.userName} ${p.label}.`;

// Pointers about the same thing, across people: this is where "you both mentioned Cubbon Park" comes from.
export type Interest = { subject: string; people: string[]; peopleIds: string[]; floatedBy: string[]; agreedBy: string[]; mentions: number; must: boolean; pointerIds: string[]; kind: string };

export function groupInterests(rows: PointerRow[]): Interest[] {
  const by = new Map<string, Interest>();
  for (const r of rows) {
    if (!["WANT", "MUST", "LIKE"].includes(r.kind)) continue;
    const cur = by.get(r.subject) ?? { subject: r.subject, people: [], peopleIds: [], floatedBy: [], agreedBy: [], mentions: 0, must: false, pointerIds: [], kind: r.kind };
    const ids = [r.userId, ...r.supporterIds];
    for (const id of ids) if (!cur.peopleIds.includes(id)) cur.peopleIds.push(id);
    for (const n of [r.userName, ...r.supporterNames]) if (!cur.people.includes(n)) cur.people.push(n);
    if (!cur.floatedBy.includes(r.userName)) cur.floatedBy.push(r.userName);
    for (const n of r.supporterNames) if (!cur.agreedBy.includes(n) && !cur.floatedBy.includes(n)) cur.agreedBy.push(n);
    cur.mentions += r.mentions;
    cur.must = cur.must || r.kind === "MUST";
    cur.pointerIds.push(r.id);
    by.set(r.subject, cur);
  }
  return [...by.values()];
}

export async function dismissPointer(tripId: string, userId: string, pointerId: string) {
  await prisma.tripPointer.updateMany({ where: { id: pointerId, tripId, userId }, data: { status: "DISMISSED" } });
}
