"use server";

// The buttons on "PAYMENT TO CONFIRM". Confirming RECORDS a settlement the payer says they made outside Clockwise; it moves no
// money and creates no expense. Authority and amount are re-checked here from the ledger, never trusted from the card.
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/session";
import { loadBudget, recordSettlement } from "@/lib/budget/ledger";
import type { ActionCardData } from "@/lib/action-cards";

type R = { ok: true } | { ok: false; error: string };

async function load(messageId: string) {
  const m = await prisma.message.findUnique({ where: { id: messageId }, select: { id: true, tripId: true, cardData: true, cardStatus: true } });
  if (!m?.cardData) return null;
  try {
    const s = (JSON.parse(m.cardData) as ActionCardData).settlement;
    return s ? { m, s } : null;
  } catch {
    return null;
  }
}

export async function confirmChatSettlementAction(messageId: string): Promise<R> {
  const userId = await getCurrentUserId();
  if (!userId) return { ok: false, error: "Sign in first." };
  const c = await load(messageId);
  if (!c) return { ok: false, error: "That confirmation isn't there any more." };
  const { m, s } = c;
  if (userId !== s.fromId) return { ok: false, error: `Only ${s.fromName} can confirm that they've paid.` };
  if (m.cardStatus !== "PENDING") return { ok: true }; // already handled: a second tap changes nothing

  // The balance is read again now: the card may be old.
  const budget = await loadBudget(m.tripId, userId);
  const owed = budget.balances.filter((b) => b.currency === s.currency).flatMap((b) => b.transfers).filter((t) => t.fromUserId === s.fromId && t.toUserId === s.toId).reduce((n, t) => n + t.amountMinor, 0);
  if (owed !== s.amountMinor) {
    await prisma.message.updateMany({ where: { id: m.id, cardStatus: "PENDING" }, data: { cardStatus: "DISMISSED" } });
    return { ok: false, error: owed === 0 ? `You no longer owe ${s.toName} anything on confirmed expenses, so nothing was recorded.` : `The balance changed (now ${(owed / 100).toLocaleString("en-IN")}). Nothing was recorded; ask again.` };
  }
  // Claim the card first so two taps record once.
  const claimed = await prisma.message.updateMany({ where: { id: m.id, cardStatus: "PENDING" }, data: { cardStatus: "CONFIRMED" } });
  if (claimed.count === 0) return { ok: true };
  const r = await recordSettlement({ tripId: m.tripId, actorUserId: userId, fromUserId: s.fromId, toUserId: s.toId, amountMinor: s.amountMinor, currency: s.currency, method: "MANUAL", note: `${s.fromName} confirmed in chat that they paid ${s.toName} outside Clockwise.` });
  if (!r.ok) {
    await prisma.message.updateMany({ where: { id: m.id, cardStatus: "CONFIRMED" }, data: { cardStatus: "PENDING" } });
    return { ok: false, error: r.error ?? "Couldn't record that." };
  }
  for (const p of ["room", "budget"]) revalidatePath(`/trips/${m.tripId}/${p}`);
  return { ok: true };
}

export async function dismissChatSettlementAction(messageId: string): Promise<R> {
  const userId = await getCurrentUserId();
  if (!userId) return { ok: false, error: "Sign in first." };
  const c = await load(messageId);
  if (!c || userId !== c.s.fromId) return { ok: false, error: "Not yours to dismiss." };
  await prisma.message.updateMany({ where: { id: c.m.id, cardStatus: "PENDING" }, data: { cardStatus: "DISMISSED" } });
  revalidatePath(`/trips/${c.m.tripId}/room`);
  return { ok: true };
}
