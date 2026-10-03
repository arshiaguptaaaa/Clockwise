// Vibe Check: the questions, and the structured PRIVATE preference store behind
// them. Nothing here writes to group chat or to any group-visible record.
import { prisma } from "@/lib/prisma";
import type { CanonicalPlace } from "@/lib/location/types";

export type QuestionId = "origin" | "mode" | "food" | "energy" | "nearby" | "stayKind" | "stayMatters" | "movement" | "pace" | "hardNo";

export type Option = { value: string; label: string; icon?: string };
export type Question = {
  id: QuestionId;
  title: string;
  hint?: string;
  kind: "place" | "single" | "multi" | "text";
  options?: Option[];
  optional?: boolean;
};

// Preference KEYS stored in TravellerPreference.key.
export const PREF_KEY: Record<QuestionId, string> = {
  origin: "ORIGIN",
  mode: "ARRIVAL_MODE",
  food: "FOOD",
  energy: "ENERGY",
  nearby: "NEARBY",
  stayKind: "STAY_KIND",
  stayMatters: "STAY_MATTERS",
  movement: "MOVEMENT",
  pace: "PACE",
  hardNo: "HARD_NO",
};

export const QUESTIONS: Question[] = [
  { id: "origin", title: "WHERE ARE YOU COMING FROM?", kind: "place" },
  {
    id: "mode",
    title: "HOW ARE YOU GETTING THERE?",
    kind: "single",
    options: [
      { value: "FLIGHT", label: "Flying", icon: "✈" },
      { value: "TRAIN", label: "Train", icon: "🚆" },
      { value: "BUS", label: "Bus", icon: "🚌" },
      { value: "DRIVE", label: "Driving", icon: "🚗" },
      { value: "UNSURE", label: "Not sure yet", icon: "?" },
    ],
  },
  {
    id: "food",
    title: "WHAT DO YOU EAT?",
    hint: "Private. The group only ever sees a neutral count.",
    kind: "single",
    options: [
      { value: "VEGETARIAN", label: "Vegetarian", icon: "🥬" },
      { value: "NON_VEGETARIAN", label: "Non-vegetarian", icon: "🍗" },
      { value: "VEGAN", label: "Vegan", icon: "🌱" },
      { value: "EGGETARIAN", label: "Eggetarian", icon: "🥚" },
      { value: "OTHER", label: "Other", icon: "✦" },
    ],
  },
  {
    id: "energy",
    title: "WHAT'S YOUR TRAVEL ENERGY?",
    hint: "Pick any.",
    kind: "multi",
    options: [
      { value: "FOOD", label: "Food", icon: "🍜" },
      { value: "HIDDEN_GEMS", label: "Hidden gems", icon: "✦" },
      { value: "CLASSICS", label: "Classics", icon: "🏛" },
      { value: "PRETTY", label: "Pretty places", icon: "♡" },
      { value: "NATURE", label: "Nature", icon: "🌿" },
      { value: "NIGHTLIFE", label: "Nightlife", icon: "🌙" },
      { value: "SHOPPING", label: "Shopping", icon: "🛍" },
      { value: "CAFES", label: "Cafés", icon: "☕" },
      { value: "MUSEUMS", label: "Museums", icon: "🖼" },
      { value: "SLOW_MORNINGS", label: "Slow mornings", icon: "☀" },
      { value: "PACK_THE_DAY", label: "Pack the day", icon: "⚡" },
    ],
  },
  {
    id: "nearby",
    title: "WHAT DO YOU LIKE HAVING CLOSE?",
    hint: "Pick any. This shapes Around You.",
    kind: "multi",
    options: [
      { value: "cafe", label: "Cafés", icon: "☕" },
      { value: "convenience", label: "Convenience stores", icon: "🛒" },
      { value: "shopping", label: "Shopping", icon: "🛍" },
      { value: "pharmacy", label: "Pharmacy", icon: "💊" },
      { value: "atm", label: "ATM", icon: "🏧" },
      { value: "restaurant", label: "Food", icon: "🍜" },
      { value: "nightlife", label: "Nightlife", icon: "🌙" },
      { value: "park", label: "Parks", icon: "🌿" },
      { value: "attraction", label: "Attractions", icon: "🏛" },
      { value: "supermarket", label: "Supermarket", icon: "🛒" },
    ],
  },
  {
    id: "stayKind",
    title: "YOUR KIND OF STAY?",
    kind: "single",
    options: [
      { value: "HOTEL", label: "Hotel" },
      { value: "HOSTEL", label: "Hostel" },
      { value: "APARTMENT", label: "Apartment / home stay" },
      { value: "VILLA", label: "Villa" },
      { value: "RESORT", label: "Resort" },
      { value: "FLEXIBLE", label: "Flexible" },
    ],
  },
  {
    id: "stayMatters",
    title: "WHAT MATTERS IN A STAY?",
    hint: "Your preferences only — not something any listing is claimed to have.",
    kind: "multi",
    options: [
      { value: "CENTRAL", label: "Central" },
      { value: "BREAKFAST", label: "Breakfast" },
      { value: "POOL", label: "Pool" },
      { value: "KITCHEN", label: "Kitchen" },
      { value: "WORKSPACE", label: "Workspace" },
      { value: "PRETTY", label: "Pretty" },
      { value: "CHEAPEST", label: "Cheapest that works" },
      { value: "QUIET", label: "Quiet" },
      { value: "WALKABLE", label: "Walkable" },
    ],
  },
  {
    id: "movement",
    title: "HOW DO YOU LIKE GETTING AROUND?",
    kind: "single",
    options: [
      { value: "WALK", label: "Walk", icon: "🚶" },
      { value: "PUBLIC", label: "Public transport", icon: "🚌" },
      { value: "CAB", label: "Cab", icon: "🚕" },
      { value: "DRIVE", label: "Drive", icon: "🚗" },
      { value: "ANY", label: "Whatever's easiest" },
    ],
  },
  {
    id: "pace",
    title: "YOUR PACE?",
    kind: "single",
    options: [
      { value: "SLOW", label: "Slow" },
      { value: "BALANCED", label: "Balanced" },
      { value: "PACKED", label: "Pack it in" },
    ],
  },
  { id: "hardNo", title: "ANY HARD NO?", hint: "Optional. Private — never quoted to the group.", kind: "text", optional: true },
];

export type Prefs = Partial<Record<QuestionId, string[]>> & { originPlace?: CanonicalPlace | null };

export async function getPrefs(tripId: string, userId: string): Promise<Prefs> {
  const rows = await prisma.travellerPreference.findMany({ where: { tripId, userId } });
  const out: Prefs = {};
  for (const q of QUESTIONS) {
    const vals = rows.filter((r) => r.key === PREF_KEY[q.id]).map((r) => r.value);
    if (vals.length) out[q.id] = vals;
  }
  const o = rows.find((r) => r.key === PREF_KEY.origin && r.detailJson);
  if (o?.detailJson) {
    try {
      out.originPlace = JSON.parse(o.detailJson) as CanonicalPlace;
    } catch {
      out.originPlace = null;
    }
  }
  return out;
}

export async function setPref(tripId: string, userId: string, id: QuestionId, values: string[], detail?: unknown, source = "VIBE_CHECK") {
  const key = PREF_KEY[id];
  const clean = [...new Set(values.map((v) => v.trim()).filter(Boolean))].map((v) => v.slice(0, 200));
  await prisma.$transaction([
    prisma.travellerPreference.deleteMany({ where: { tripId, userId, key } }),
    ...(clean.length
      ? [prisma.travellerPreference.createMany({ data: clean.map((value) => ({ tripId, userId, key, value, detailJson: detail ? JSON.stringify(detail) : null, source })) })]
      : []),
  ]);
}

export async function getVibeStatus(tripId: string, userId: string): Promise<"NONE" | "DEFERRED" | "COMPLETED"> {
  const row = await prisma.vibeCheck.findUnique({ where: { tripId_userId: { tripId, userId } } });
  return (row?.status as "DEFERRED" | "COMPLETED" | undefined) ?? "NONE";
}

// Questions still worth asking: anything already known (a confirmed journey's
// origin/mode, an earlier answer) is skipped — never ask what we have.
export function questionsToAsk(prefs: Prefs, known: { origin?: string | null; mode?: string | null }): Question[] {
  return QUESTIONS.filter((q) => {
    if (q.id === "origin" && (known.origin || prefs.origin)) return false;
    if (q.id === "mode" && (known.mode || prefs.mode)) return false;
    if (q.id === "food" && prefs.food) return false;
    return true;
  });
}

// Neutral, group-safe aggregate: counts only, never who or what exactly.
export async function groupVibeSummary(tripId: string): Promise<{ respondents: number; vegetarianCompatible: number } | null> {
  const done = await prisma.vibeCheck.findMany({ where: { tripId, status: "COMPLETED" }, select: { userId: true } });
  if (done.length < 2) return null; // too few answers to be anonymous
  const veg = await prisma.travellerPreference.findMany({ where: { tripId, key: PREF_KEY.food, value: { in: ["VEGETARIAN", "VEGAN"] } }, select: { userId: true } });
  return { respondents: done.length, vegetarianCompatible: new Set(veg.map((v) => v.userId)).size };
}
