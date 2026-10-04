// "Anything except another dosa place 😭" is a mood about the NEXT meal. It is understood (the next search leaves
// dosa out, and says so) and it expires; it is never stored as a diet, a dislike or a pointer.
import { prisma } from "@/lib/prisma";
import { isTransientMood } from "./extract";

const clean = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}\s'-]/gu, " ").replace(/\s+/g, " ").trim();

export function parseTransientAvoid(text: string): string | null {
  if (!isTransientMood(text)) return null;
  const t = text.replace(/[“”]/g, '"');
  const m =
    /\b(?:except|but|other than|besides)\s+(?:for\s+)?(?:another|more|any more|the same|yet another|one more)?\s*([a-z][a-z' -]{1,30}?)(?=\s+(?:place|spot|restaurant|joint|cafe|café|again|please|pls|thanks)\b|[.!?,😭😩😫🙃]|\s*$)/iu.exec(t) ??
    /\b(?:not|no)\s+(?:another|more)\s+([a-z][a-z' -]{1,30}?)(?=\s+(?:place|spot|restaurant|joint|cafe|café|again|please|pls)\b|[.!?,😭😩😫🙃]|\s*$)/iu.exec(t) ??
    /\b(?:another|more)\s+([a-z][a-z' -]{1,24}?)\s+(?:place|spot|restaurant|joint|cafe|café)\b/iu.exec(t);
  const word = m ? clean(m[1]) : "";
  if (!word || word.split(" ").length > 3 || /^(one|place|thing|food|anything|something)$/.test(word)) return null;
  return word;
}

// "Anything except another dosa place" belongs to THE MEAL it was said about, not to a clock. Which meal is decided by
// the local time it was said (breakfast, lunch, snacks, dinner): searches for that meal, on that day, leave the item
// out. It ends by itself when the meal changes, when a search asks for the item by name, or when the day ends. It is
// never stored as a diet, a dislike or a pointer.
export type MealSlot = "breakfast" | "lunch" | "snacks" | "dinner" | "late";
export function mealSlot(hhmm: string): MealSlot {
  const m = Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
  if (m >= 5 * 60 && m < 11 * 60) return "breakfast";
  if (m >= 11 * 60 && m < 15 * 60) return "lunch";
  if (m >= 15 * 60 && m < 18 * 60) return "snacks";
  if (m >= 18 * 60 && m < 23 * 60 + 30) return "dinner";
  return "late";
}

export type MealMood = { avoid: string; by: string; slot: MealSlot; date: string };

// Pure: does a mood noted in (date, slot) still apply to a search being made at `nowLocal`?
export function moodApplies(m: { slot: MealSlot; date: string }, nowLocal: { date: string; time: string }): boolean {
  return m.date === nowLocal.date && m.slot === mealSlot(nowLocal.time);
}

export async function recordMealMood(tripId: string, userId: string, messageId: string, avoid: string, at: { date: string; time: string }) {
  const slot = mealSlot(at.time);
  await prisma.tripEvent
    .create({
      data: {
        tripId,
        kind: "MEAL_MOOD_NOTED",
        scope: "GROUP",
        actorUserId: userId,
        sourceChannel: "GROUP",
        sourceMessageId: messageId,
        confidence: "MEDIUM",
        payload: JSON.stringify({ avoid, slot, date: at.date, scope: `searches for ${slot} on ${at.date}`, stage: "NOT_A_PREFERENCE", note: "A mood about the current meal. Not a diet, not a stored dislike, not a Plan item." }),
        propagation: "[]",
      },
    })
    .catch(() => undefined);
}

export async function recentMealMoods(tripId: string, nowLocal: { date: string; time: string }): Promise<MealMood[]> {
  const rows = await prisma.tripEvent.findMany({ where: { tripId, kind: "MEAL_MOOD_NOTED", createdAt: { gt: new Date(Date.now() - 36 * 3600_000) } }, orderBy: { createdAt: "desc" }, take: 8, select: { payload: true, actorUserId: true } });
  if (!rows.length) return [];
  const users = await prisma.user.findMany({ where: { id: { in: rows.map((r) => r.actorUserId).filter((x): x is string => Boolean(x)) } }, select: { id: true, name: true } });
  const name = new Map(users.map((u) => [u.id, u.name.split(" ")[0]]));
  return rows.flatMap((r) => {
    try {
      const p = JSON.parse(r.payload) as { avoid?: string; slot?: MealSlot; date?: string };
      if (!p.avoid || !p.slot || !p.date || !moodApplies({ slot: p.slot, date: p.date }, nowLocal)) return [];
      return [{ avoid: p.avoid, by: name.get(r.actorUserId ?? "") ?? "Someone", slot: p.slot, date: p.date }];
    } catch {
      return [];
    }
  });
}

// Whole-word match on the place's name and cuisine text, with the common spellings of the dish.
const SYN: Record<string, string[]> = { dosa: ["dosa", "dosai", "dosas"], idli: ["idli", "idly"], biryani: ["biryani", "biriyani"], pizza: ["pizza", "pizzeria"] };
export function placeMatchesAvoid(placeText: string, avoid: string): boolean {
  const words = SYN[avoid] ?? [avoid];
  const t = ` ${clean(placeText)} `;
  return words.some((w) => t.includes(` ${w} `));
}
