// YOUR TRIP IS TAKING SHAPE: a short, honest read of what the group has actually said and what the Plan actually
// holds. It restates pointers and checks the Plan; it never adds a personality, a mood or a preference nobody
// stated. It changes only when the underlying pointers or Plan change (it is computed from them, not cached).
import { prisma } from "@/lib/prisma";
import { loadPointers, groupInterests } from "@/lib/pointers/store";
import { tripDayWindow, partOf } from "@/lib/ideas";
import { parseDay, localNow, humanMoment } from "@/lib/when";
import { getTripById } from "@/lib/trip";

const FOODISH = /\b(dosa|dosai|idli|biryani|thali|coffee|chai|tea|food|brunch|breakfast|lunch|dinner|cake|dessert|pizza|momos?|chaat|south indian|street food|sweets?|cafes?|cafés?)\b/i;
const title = (s: string) => s.replace(/\b([a-z])/g, (c) => c.toUpperCase());
const list = (xs: string[]) => (xs.length <= 1 ? (xs[0] ?? "") : xs.length === 2 ? `${xs[0]} and ${xs[1]}` : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

export async function tripStory(tripId: string): Promise<string | null> {
  const [pointers, trip, window, commitments] = await Promise.all([loadPointers(tripId), getTripById(tripId), tripDayWindow(tripId), prisma.commitment.findMany({ where: { tripId, status: { not: "CANCELLED" } }, select: { targetTime: true } })]);
  if (pointers.length === 0) return null;
  const city = (trip.destinations[0]?.name ?? "").split(",")[0] || trip.name;
  const interests = groupInterests(pointers);
  const places = interests.filter((i) => !FOODISH.test(i.subject)).sort((a, b) => Number(b.must) - Number(a.must) || b.peopleIds.length - a.peopleIds.length);
  const bits: string[] = [];

  if (places.length) {
    const named = places.slice(0, 3).map((p) => title(p.subject));
    bits.push(`${list(named)} ${named.length > 1 ? "have" : "has"} come up${places[0].must ? `, and ${places[0].people[0]} says ${title(places[0].subject)} is a must` : ""}`);
  }
  // per person, only what they themselves said
  const byPerson = new Map<string, string[]>();
  for (const p of pointers) {
    if (p.kind === "DIET") (byPerson.get(p.userName) ?? byPerson.set(p.userName, []).get(p.userName)!).push(p.label);
    else if ((p.kind === "WANT" || p.kind === "LIKE") && FOODISH.test(p.subject)) (byPerson.get(p.userName) ?? byPerson.set(p.userName, []).get(p.userName)!).push(p.label);
  }
  for (const [name, labels] of [...byPerson.entries()].slice(0, 3)) bits.push(`${name} ${list([...new Set(labels)])}`);

  const win = pointers.find((p) => p.kind === "WINDOW");
  let windowBit: string | null = null;
  if (win) {
    const day = parseDay(win.subject, localNow(), window);
    const part = partOf(win.subject);
    if (day) {
      const onDay = commitments.filter((c) => c.targetTime.toISOString().slice(0, 10) === day.date);
      const hours = (c: { targetTime: Date }) => c.targetTime.getUTCHours();
      const busy = onDay.some((c) => (part === "afternoon" ? hours(c) >= 12 && hours(c) < 18 : part === "morning" ? hours(c) < 12 : part === "evening" ? hours(c) >= 17 : true));
      windowBit = `${title(humanMoment(`${day.date}T12:00`).split(" ")[0])}${part === "day" ? "" : ` ${part}`} is ${busy ? "spoken for" : "still open"}`;
    } else windowBit = `${win.userName} wants ${win.subject} kept open`;
  }
  if (windowBit) bits.push(windowBit);
  if (bits.length === 0) return null;
  return `So far in ${city}: ${bits.join(". ")}.`.replace(/\.\./g, ".");
}
