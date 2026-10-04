"use server";

// The buttons on "PAYMENT TO CONFIRM". Confirming RECORDS a settlement the payer says they made outside Clockwise; it moves no
// money and creates no expense. Authority and amount are re-checked here from the ledger, never trusted from the card.
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/session";
import { loadBudget, recordSettlement } from "@/lib/budget/ledger";
import type { ActionCardData } from "@/lib/action-cards";
import { payObligation } from "@/lib/payments/obligations";
import { refreshTripPaymentStatus } from "@/lib/trip-payments";

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

// AUTHORISE: the payer says yes to "pay <payee> ₹N" and Clockwise creates ONE Pine Labs UAT payment link for exactly that payment.
// Creating the link is recorded as exactly that. The debt is not marked paid, and the card does not say paid, until Pine Labs'
// own status says PROCESSED (see syncDirectPayment). A second tap returns the same link.
export async function authorisePineSettlementAction(messageId: string): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const userId = await getCurrentUserId();
  if (!userId) return { ok: false, error: "Sign in first." };
  const c = await load(messageId);
  if (!c) return { ok: false, error: "That payment isn't there any more." };
  const { m, s } = c;
  if (userId !== s.fromId) return { ok: false, error: `Only ${s.fromName} can authorise this payment.` };
  if (m.cardStatus !== "PENDING") return { ok: false, error: "This one is already settled or dismissed." };
  if (s.pine?.url && ["CREATED", "CLICKED", "PAYMENT_INITIATED"].includes(s.pine.status)) return { ok: true, url: s.pine.url };

  // One collection per card, keyed by the card itself, so two taps cannot make two links.
  const ref = `CW-pay-${m.id.slice(-14)}`;
  let ob = await prisma.paymentObligation.findUnique({ where: { merchantRef: ref }, include: { collection: true } });
  if (!ob) {
    try {
      // One transaction: if a concurrent tap already made this card's obligation, this rolls back and leaves no orphan collection.
      ob = await prisma.$transaction(async (tx) => {
        const col = await tx.paymentCollection.create({ data: { tripId: m.tripId, title: `Payment to ${s.toName}`, totalMinor: s.amountMinor, currency: s.currency, createdBy: userId, payeeUserId: s.toId } });
        return tx.paymentObligation.create({ data: { collectionId: col.id, tripId: m.tripId, userId: s.fromId, amountMinor: s.amountMinor, merchantRef: ref, status: "DUE" }, include: { collection: true } });
      });
    } catch {
      ob = await prisma.paymentObligation.findUnique({ where: { merchantRef: ref }, include: { collection: true } });
    }
  }
  if (!ob) return { ok: false, error: "Couldn't set that payment up. Nothing was created." };
  // Exactly one tap creates the link; a concurrent tap waits for it and gets the same one.
  const claim = await prisma.paymentObligation.updateMany({ where: { id: ob.id, status: "DUE", bookingId: null }, data: { status: "PAYING" } });
  if (claim.count === 0) {
    for (let i = 0; i < 25; i++) {
      const cur = await prisma.paymentObligation.findUnique({ where: { id: ob.id }, select: { paymentUrl: true, bookingId: true } });
      if (cur?.paymentUrl) {
        const again = JSON.parse((await prisma.message.findUnique({ where: { id: m.id }, select: { cardData: true } }))?.cardData ?? "{}") as ActionCardData;
        return { ok: true, url: again.settlement?.pine?.url ?? cur.paymentUrl };
      }
      await new Promise((res) => setTimeout(res, 400));
    }
    return { ok: false, error: "The payment link is still being created. Try again in a moment." };
  }
  const r = await payObligation(ob.id, userId);
  if (!r.ok) {
    await prisma.paymentObligation.updateMany({ where: { id: ob.id, bookingId: null }, data: { status: "DUE" } });
    return { ok: false, error: r.body || r.title };
  }
  const fresh = await prisma.paymentObligation.findUnique({ where: { id: ob.id }, select: { bookingId: true, collectionId: true } });
  const booking = fresh?.bookingId ? await prisma.booking.findUnique({ where: { id: fresh.bookingId }, select: { status: true } }) : null;
  const data = JSON.parse(m.cardData ?? "{}") as ActionCardData;
  data.settlement = { ...s, collectionId: ob.collectionId, pine: { bookingId: fresh?.bookingId ?? "", status: booking?.status ?? "CREATED", url: r.url } };
  await prisma.message.update({ where: { id: m.id }, data: { cardData: JSON.stringify(data) } });
  await prisma.tripEvent.create({
    data: { tripId: m.tripId, kind: "PAYMENT_AUTHORISED", scope: "GROUP", actorUserId: userId, subjectUserId: s.toId, sourceChannel: "GROUP", confidence: "HIGH", payload: JSON.stringify({ payer: s.fromName, payee: s.toName, amountMinor: s.amountMinor, currency: s.currency, collectionId: ob.collectionId, bookingId: fresh?.bookingId ?? null, linkStatus: booking?.status ?? "CREATED", paid: false, note: "Authorised by the payer. A payment link was created; the payment has NOT been made." }), propagation: JSON.stringify(["payments", "chat"]) },
  });
  for (const p of ["room", "budget"]) revalidatePath(`/trips/${m.tripId}/${p}`);
  return { ok: true, url: r.url };
}

// CHECK STATUS: asks Pine Labs (server-side, authenticated) and applies whatever it says. The page's own claim never moves anything.
export async function checkPineSettlementAction(messageId: string): Promise<{ ok: true; status: string } | { ok: false; error: string }> {
  const userId = await getCurrentUserId();
  if (!userId) return { ok: false, error: "Sign in first." };
  const c = await load(messageId);
  if (!c?.s.pine?.bookingId) return { ok: false, error: "No payment link has been created for this yet." };
  if (userId !== c.s.fromId && userId !== c.s.toId) return { ok: false, error: "Not your payment." };
  const r = await refreshTripPaymentStatus(c.s.pine.bookingId);
  for (const p of ["room", "budget"]) revalidatePath(`/trips/${c.m.tripId}/${p}`);
  return r.ok ? { ok: true, status: r.status } : { ok: false, error: "Couldn't check with Pine Labs just now. Nothing was changed." };
}
