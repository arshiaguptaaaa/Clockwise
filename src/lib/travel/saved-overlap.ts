// Overlap between travellers' PRIVATE saved places. Saving never tells the group.
// When two or more travellers independently saved the same real place, the
// signal is the COUNT ("three of you saved this"), shown only to travellers who
// saved it themselves. Never who.
import { prisma } from "@/lib/prisma";

export type SavedOverlap = { provider: string; providerPlaceId: string; name: string; address: string | null; kind: string; count: number; members: number };

export function groupOverlaps(rows: { userId: string; provider: string; providerPlaceId: string; name: string; address: string | null; kind: string }[], viewerId: string, members: number): SavedOverlap[] {
  const byPlace = new Map<string, typeof rows>();
  for (const r of rows) {
    const k = `${r.provider}:${r.providerPlaceId}`;
    byPlace.set(k, [...(byPlace.get(k) ?? []), r]);
  }
  const out: SavedOverlap[] = [];
  for (const group of byPlace.values()) {
    const savers = new Set(group.map((g) => g.userId));
    // Only people who saved it can see that others did too.
    if (savers.size < 2 || !savers.has(viewerId)) continue;
    const g = group[0];
    out.push({ provider: g.provider, providerPlaceId: g.providerPlaceId, name: g.name, address: g.address, kind: g.kind, count: savers.size, members });
  }
  return out.sort((a, b) => b.count - a.count);
}

export async function savedOverlaps(tripId: string, viewerId: string): Promise<SavedOverlap[]> {
  const [rows, members] = await Promise.all([
    prisma.savedPlace.findMany({ where: { tripId }, select: { userId: true, provider: true, providerPlaceId: true, name: true, address: true, kind: true } }),
    prisma.tripMember.count({ where: { tripId } }),
  ]);
  return groupOverlaps(rows, viewerId, members);
}

// Places EVERY member saved — safe to name in the group because nothing is revealed that each member doesn't already know.
export async function savedByEveryone(tripId: string): Promise<{ name: string; address: string | null; providerPlaceId: string }[]> {
  const [rows, members] = await Promise.all([
    prisma.savedPlace.findMany({ where: { tripId }, select: { userId: true, provider: true, providerPlaceId: true, name: true, address: true } }),
    prisma.tripMember.count({ where: { tripId } }),
  ]);
  const by = new Map<string, typeof rows>();
  for (const r of rows) by.set(`${r.provider}:${r.providerPlaceId}`, [...(by.get(`${r.provider}:${r.providerPlaceId}`) ?? []), r]);
  const out: { name: string; address: string | null; providerPlaceId: string }[] = [];
  for (const g of by.values()) if (members >= 2 && new Set(g.map((x) => x.userId)).size === members) out.push({ name: g[0].name, address: g[0].address, providerPlaceId: g[0].providerPlaceId });
  return out;
}
