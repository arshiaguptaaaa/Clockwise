// Read-side guard for Decision rows. Decisions are shared state — the group
// agent's context and Agent Trace both read them for everyone — but before
// private rooms stopped writing them, a claim made in someone's private
// My Clockwise conversation could land here. A Decision is hidden from
// everyone but its own actor when ANY of its source messages was private.
// Rows with no recorded sources (pre-provenance) are treated as shared:
// they predate the private-room tool path and carry no evidence otherwise.
import { prisma } from "./prisma";

export async function excludePrivateSourced<T extends { sourceMessageIds: string; actorUserId: string | null }>(
  rows: T[],
  viewerId: string | null
): Promise<T[]> {
  const idsByRow = rows.map((r) => {
    try {
      const parsed = JSON.parse(r.sourceMessageIds);
      return Array.isArray(parsed) ? (parsed as string[]) : [];
    } catch {
      return [];
    }
  });
  const all = [...new Set(idsByRow.flat())];
  if (all.length === 0) return rows;

  const privateIds = new Set(
    (await prisma.message.findMany({ where: { id: { in: all }, channel: "PRIVATE" }, select: { id: true } })).map((m) => m.id)
  );
  return rows.filter((r, i) => {
    const touchesPrivate = idsByRow[i].some((id) => privateIds.has(id));
    return !touchesPrivate || (viewerId != null && r.actorUserId === viewerId);
  });
}
