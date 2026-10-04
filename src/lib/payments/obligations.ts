// Group payments: one COLLECTION, one OBLIGATION per traveller, one Pine Labs link per obligation.
//
//   approved split -> obligations (who owes exactly what, keyed by user id, never by name)
//   -> each traveller's PAY creates THEIR link (unique merchant reference) -> Pine Labs hosted checkout
//   -> status fetched from Pine Labs -> only THAT obligation becomes PAID -> collection SETTLED when all are.
//
// Clockwise is the single Pine Labs merchant: travellers never authenticate with Pine Labs or hold any
// credential, they only open the hosted checkout. Pressing a link, or merely opening it, never marks anything
// paid; PROCESSED is read from Pine Labs' API (see payment-lifecycle.ts) and applied here exactly once.
import { prisma } from "@/lib/prisma";
import { notify } from "@/lib/notifications";
import { postActionCard } from "@/lib/action-cards";
import { createExpense, recordSettlement } from "@/lib/budget/ledger";
import { createTripPaymentRequest } from "@/lib/trip-payments";
import { isPineLabsConfigured } from "./pine-labs-provider";
import { validatePineMinor, PAYMENT_FAILED_TITLE, PAYMENT_FAILED_BODY } from "./amount";
import type { ObligationLine } from "./obligations-math";

export const formatINR = (minor: number, currency = "INR") => `${currency === "INR" ? "₹" : `${currency} `}${(minor / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const first = (n: string) => n.split(" ")[0];
const LIVE_LINK = new Set(["CREATED", "CLICKED", "PAYMENT_INITIATED"]);

export async function createCollection(p: { tripId: string; title: string; totalMinor: number; currency: string; createdBy: string; sourceProposalId?: string | null; lines: ObligationLine[] }) {
  const collection = await prisma.paymentCollection.create({
    data: { tripId: p.tripId, title: p.title.slice(0, 120), totalMinor: p.totalMinor, currency: p.currency, createdBy: p.createdBy, sourceProposalId: p.sourceProposalId ?? null },
  });
  for (const l of p.lines) {
    const ref = `CW-${collection.id.slice(-10)}-${l.userId.slice(-10)}`.slice(0, 50);
    await prisma.paymentObligation.create({
      data: { collectionId: collection.id, tripId: p.tripId, userId: l.userId, amountMinor: l.amountMinor, merchantRef: ref, status: l.alreadyPaid ? "PAID" : "DUE", paidAt: l.alreadyPaid ? new Date() : null },
    });
    if (l.alreadyPaid) {
      // Paid outside Clockwise (the organiser said so): recorded in Budget, no link needed.
      await createExpense({ tripId: p.tripId, actorUserId: p.createdBy, title: `${p.title} (${first(l.name)})`, amountMinor: l.amountMinor, currency: p.currency, stage: "PAID", status: "ACTIVE", paidByUserId: l.userId, source: "MANUAL", splitMethod: "EXACT", participants: [{ userId: l.userId, value: l.amountMinor }], idempotencyKey: `oblig:${collection.id}:${l.userId}` }).catch(() => undefined);
    }
  }
  await prisma.tripEvent.create({
    data: {
      tripId: p.tripId,
      kind: "PAYMENT_COLLECTION_CREATED",
      scope: "GROUP",
      sourceChannel: "SYSTEM",
      confidence: "HIGH",
      payload: JSON.stringify({ collectionId: collection.id, title: p.title, totalMinor: p.totalMinor, currency: p.currency, obligations: p.lines.map((l) => ({ name: first(l.name), amountMinor: l.amountMinor, alreadyPaid: l.alreadyPaid })), paid: false }),
      propagation: JSON.stringify(["payments", "budget", "notifications"]),
    },
  });
  await postActionCard({
    tripId: p.tripId,
    channel: "GROUP",
    type: "BOOKING",
    status: "PENDING",
    data: { title: `PAYMENT'S READY · ${p.title}`, context: "Everyone pays their own share.", collectionId: collection.id, collection: true },
  });
  const owing = p.lines.filter((l) => !l.alreadyPaid);
  for (const l of owing) {
    await notify({ tripId: p.tripId, recipientIds: [l.userId], severity: "IMPORTANT", kind: "PAYMENT_DUE", title: `${formatINR(l.amountMinor, p.currency)} due for ${p.title}`, body: "Open Budget to pay your share securely.", href: `/trips/${p.tripId}/budget` });
  }
  return collection;
}

export type PayResult = { ok: true; url: string; already?: boolean } | { ok: false; title: string; body: string };
const failure = (): PayResult => ({ ok: false, title: PAYMENT_FAILED_TITLE, body: PAYMENT_FAILED_BODY });

// PAY: opens THIS traveller's own link. The actor must be the obligation's owner, so one person's button can
// never pay (or reveal the link of) another's share.
export async function payObligation(obligationId: string, actorId: string): Promise<PayResult> {
  const o = await prisma.paymentObligation.findUnique({ where: { id: obligationId }, include: { collection: true } });
  if (!o || o.userId !== actorId) return failure();
  if (o.status === "PAID") return { ok: true, url: `/trips/${o.tripId}/budget`, already: true };
  if (o.collection.status === "CANCELLED") return failure();

  if (o.bookingId && o.paymentUrl) {
    const b = await prisma.booking.findUnique({ where: { id: o.bookingId }, select: { status: true } });
    if (b && LIVE_LINK.has(b.status)) return { ok: true, url: o.paymentUrl };
  }

  const check = validatePineMinor(o.amountMinor, o.collection.currency);
  if (!check.ok) {
    await prisma.paymentObligation.update({ where: { id: o.id }, data: { lastError: check.reason } });
    return failure();
  }
  if (!isPineLabsConfigured()) {
    await prisma.paymentObligation.update({ where: { id: o.id }, data: { lastError: "Pine Labs is not configured" } });
    return failure();
  }

  const attempts = await prisma.booking.count({ where: { tripId: o.tripId, payerId: o.userId, sourceProposalId: o.collectionId } });
  const user = await prisma.user.findUnique({ where: { id: o.userId }, select: { name: true, email: true, phone: true } });
  const result = await createTripPaymentRequest({
    tripId: o.tripId,
    purpose: o.collection.title,
    amountMinorUnits: check.minor,
    currency: o.collection.currency,
    payerId: o.userId,
    payerName: user?.name,
    payerContact: user?.email ?? user?.phone ?? undefined,
    sourceProposalId: o.collectionId,
    merchantReference: attempts === 0 ? o.merchantRef : `${o.merchantRef}-${attempts}`.slice(0, 50),
    skipBudgetCommit: true,
    decisionNote: o.collection.payeeUserId
      ? `${first(user?.name ?? "The payer")} authorised paying ${first((await prisma.user.findUnique({ where: { id: o.collection.payeeUserId }, select: { name: true } }))?.name ?? "the payee")} ${formatINR(check.minor, o.collection.currency)} (payer and payee fixed, not split) → create a Pine Labs payment link`
      : undefined,
  });
  if (!result.ok) {
    // The provider's own message stays in Developer Evidence; only a plain sentence is kept and shown.
    await prisma.paymentObligation.update({ where: { id: o.id }, data: { lastError: result.reason.slice(0, 300) } });
    return failure();
  }
  await prisma.paymentObligation.update({ where: { id: o.id }, data: { bookingId: result.bookingId, paymentUrl: result.paymentLinkUrl, status: "PAYING", lastError: null } });
  const booking = await prisma.booking.findUnique({ where: { id: result.bookingId }, select: { confirmationId: true } });
  if (booking?.confirmationId) await prisma.paymentObligation.update({ where: { id: o.id }, data: { paymentLinkId: booking.confirmationId } });
  return { ok: true, url: result.paymentLinkUrl };
}

// Called with a status Clockwise fetched from Pine Labs itself. Idempotent: PAID is applied once, a stale or
// repeated callback changes nothing, and no other traveller's obligation is touched.
export async function syncObligationFromBooking(bookingId: string, liveStatus: string): Promise<boolean> {
  const o = await prisma.paymentObligation.findFirst({ where: { bookingId }, include: { collection: true } });
  if (!o) return false;
  if (o.collection.payeeUserId) return syncDirectPayment(o, liveStatus);
  if (liveStatus === "PROCESSED") {
    const claimed = await prisma.paymentObligation.updateMany({ where: { id: o.id, status: { not: "PAID" } }, data: { status: "PAID", paidAt: new Date(), lastError: null } });
    if (claimed.count === 0) return true;
    await createExpense({ tripId: o.tripId, actorUserId: o.userId, title: `${o.collection.title} (${first((await prisma.user.findUnique({ where: { id: o.userId }, select: { name: true } }))?.name ?? "Traveller")})`, amountMinor: o.amountMinor, currency: o.collection.currency, stage: "PAID", status: "ACTIVE", paidByUserId: o.userId, source: "PINE_LABS", sourceReferenceId: bookingId, splitMethod: "EXACT", participants: [{ userId: o.userId, value: o.amountMinor }], idempotencyKey: `oblig:${o.collectionId}:${o.userId}` }).catch((e) => console.error("[budget] obligation expense failed:", e instanceof Error ? e.message : e));
    const rows = await prisma.paymentObligation.findMany({ where: { collectionId: o.collectionId } });
    const paid = rows.filter((r) => r.status === "PAID");
    const collected = paid.reduce((s, r) => s + r.amountMinor, 0);
    const user = await prisma.user.findUnique({ where: { id: o.userId }, select: { name: true } });
    await prisma.tripEvent.create({
      data: { tripId: o.tripId, kind: "PAYMENT_OBLIGATION_PAID", scope: "GROUP", actorUserId: o.userId, subjectUserId: o.userId, sourceChannel: "PINELABS", confidence: "HIGH", payload: JSON.stringify({ collectionId: o.collectionId, title: o.collection.title, traveller: user?.name ?? null, amountMinor: o.amountMinor, collectedMinor: collected, totalMinor: o.collection.totalMinor, paidCount: paid.length, of: rows.length, verifiedBy: "pinelabs_api_fetch", bookingId }), propagation: JSON.stringify(["payments", "budget", "decision-strip"]) },
    });
    const settled = paid.length === rows.length;
    if (settled) {
      await prisma.paymentCollection.update({ where: { id: o.collectionId }, data: { status: "SETTLED" } });
      const members = (await prisma.tripMember.findMany({ where: { tripId: o.tripId }, select: { userId: true } })).map((m) => m.userId);
      await notify({ tripId: o.tripId, recipientIds: members, severity: "IMPORTANT", kind: "PAYMENT_SETTLED", title: "Everyone's settled", body: `${formatINR(o.collection.totalMinor, o.collection.currency)} collected for ${o.collection.title}.`, href: `/trips/${o.tripId}/room` });
    } else {
      await notify({ tripId: o.tripId, recipientIds: [o.collection.createdBy], severity: "INFO", kind: "PAYMENT_PAID", title: `${first(user?.name ?? "Someone")} paid ${formatINR(o.amountMinor, o.collection.currency)}`, body: `${paid.length} of ${rows.length} paid for ${o.collection.title}.`, href: `/trips/${o.tripId}/room` });
    }
    return true;
  }
  if (liveStatus === "EXPIRED" || liveStatus === "CANCELLED") {
    // The link can no longer be paid; the traveller simply gets a fresh one on their next PAY.
    await prisma.paymentObligation.updateMany({ where: { id: o.id, status: { not: "PAID" } }, data: { status: "DUE" } });
    return true;
  }
  await prisma.paymentObligation.updateMany({ where: { id: o.id, status: { in: ["DUE", "PAYING"] } }, data: { status: "PAYING" } });
  return true;
}

// For the UI: everything a screen needs, with the viewer's own obligation id exposed ONLY on their own line.
export type CollectionView = {
  id: string;
  title: string;
  totalMinor: number;
  currency: string;
  status: string;
  collectedMinor: number;
  paidCount: number;
  lines: { userId: string; name: string; amountMinor: number; paid: boolean; mine: boolean; obligationId: string | null }[];
};

export async function collectionsForTrip(tripId: string, viewerId: string | null): Promise<CollectionView[]> {
  const rows = await prisma.paymentCollection.findMany({ where: { tripId, status: { not: "CANCELLED" } }, orderBy: { createdAt: "asc" }, include: { obligations: true } });
  if (rows.length === 0) return [];
  const users = await prisma.user.findMany({ where: { id: { in: [...new Set(rows.flatMap((r) => r.obligations.map((o) => o.userId)))] } }, select: { id: true, name: true } });
  const name = new Map(users.map((u) => [u.id, u.name]));
  return rows.map((c) => {
    const lines = c.obligations
      .slice()
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .map((o) => ({ userId: o.userId, name: name.get(o.userId) ?? "Traveller", amountMinor: o.amountMinor, paid: o.status === "PAID", mine: o.userId === viewerId, obligationId: o.userId === viewerId ? o.id : null }));
    return { id: c.id, title: c.title, totalMinor: c.totalMinor, currency: c.currency, status: c.status, collectedMinor: lines.filter((l) => l.paid).reduce((s, l) => s + l.amountMinor, 0), paidCount: lines.filter((l) => l.paid).length, lines };
  });
}

export async function owedBy(tripId: string, userId: string) {
  const rows = await prisma.paymentObligation.findMany({ where: { tripId, userId, status: { not: "PAID" } }, include: { collection: true }, orderBy: { createdAt: "asc" } });
  return rows.filter((r) => r.collection.status !== "CANCELLED").map((r) => ({ obligationId: r.id, title: r.collection.title, amountMinor: r.amountMinor, currency: r.collection.currency, paying: r.status === "PAYING" }));
}

// Pine Labs echoes our merchant reference; the obligation owns it (retries add a numeric suffix).
export async function bookingIdForReference(reference: string): Promise<string | null> {
  const base = reference.replace(/-\d+$/, "");
  const o = await prisma.paymentObligation.findFirst({ where: { merchantRef: { in: [reference, base] } }, select: { bookingId: true } });
  return o?.bookingId ?? null;
}

// "@Clockwise pay Ridhima ₹1,000": ONE obligation (the payer's) with a named payee. The card follows Pine Labs' own status word for
// word; only an authoritative PROCESSED records the payment as made (a settlement payer -> payee), and only once.
type DirectObligation = NonNullable<Awaited<ReturnType<typeof prisma.paymentObligation.findFirst>>> & { collection: NonNullable<Awaited<ReturnType<typeof prisma.paymentCollection.findFirst>>> };

async function syncDirectPaymentCard(o: DirectObligation, liveStatus: string) {
  const msgs = await prisma.message.findMany({ where: { tripId: o.tripId, cardData: { contains: `"collectionId":"${o.collectionId}"` } }, select: { id: true, cardData: true } });
  for (const m of msgs) {
    try {
      const data = JSON.parse(m.cardData ?? "{}") as { settlement?: { pine?: { bookingId: string; status: string; url: string | null } } };
      if (!data.settlement) continue;
      data.settlement.pine = { bookingId: o.bookingId ?? data.settlement.pine?.bookingId ?? "", status: liveStatus, url: o.paymentUrl ?? data.settlement.pine?.url ?? null };
      await prisma.message.update({ where: { id: m.id }, data: { cardData: JSON.stringify(data), ...(liveStatus === "PROCESSED" ? { cardStatus: "CONFIRMED" as const } : {}) } });
    } catch {
      // an unreadable card is left as it is
    }
  }
}

async function syncDirectPayment(o: DirectObligation, liveStatus: string): Promise<boolean> {
  await syncDirectPaymentCard(o, liveStatus);
  const payeeId = o.collection.payeeUserId!;
  if (liveStatus === "PROCESSED") {
    const claimed = await prisma.paymentObligation.updateMany({ where: { id: o.id, status: { not: "PAID" } }, data: { status: "PAID", paidAt: new Date(), lastError: null } });
    if (claimed.count === 0) return true;
    const names = new Map((await prisma.user.findMany({ where: { id: { in: [o.userId, payeeId] } }, select: { id: true, name: true } })).map((u) => [u.id, first(u.name)]));
    await recordSettlement({ tripId: o.tripId, actorUserId: o.userId, fromUserId: o.userId, toUserId: payeeId, amountMinor: o.amountMinor, currency: o.collection.currency, method: "PINE_LABS", note: `Paid through Pine Labs (link ${o.paymentLinkId ?? "?"}); PROCESSED confirmed by a status fetch from Pine Labs.` });
    await prisma.paymentCollection.update({ where: { id: o.collectionId }, data: { status: "SETTLED" } });
    await prisma.tripEvent.create({
      data: { tripId: o.tripId, kind: "PAYMENT_OBLIGATION_PAID", scope: "GROUP", actorUserId: o.userId, subjectUserId: payeeId, sourceChannel: "PINELABS", confidence: "HIGH", payload: JSON.stringify({ collectionId: o.collectionId, payer: names.get(o.userId), payee: names.get(payeeId), amountMinor: o.amountMinor, currency: o.collection.currency, verifiedBy: "pinelabs_api_fetch", bookingId: o.bookingId, direct: true }), propagation: JSON.stringify(["payments", "budget"]) },
    });
    await notify({ tripId: o.tripId, recipientIds: [payeeId], severity: "IMPORTANT", kind: "PAYMENT_PAID", title: `${names.get(o.userId)} paid you ${formatINR(o.amountMinor, o.collection.currency)}`, body: "Confirmed by Pine Labs.", href: `/trips/${o.tripId}/budget` });
    return true;
  }
  if (liveStatus === "EXPIRED" || liveStatus === "CANCELLED") {
    await prisma.paymentObligation.updateMany({ where: { id: o.id, status: { not: "PAID" } }, data: { status: "DUE" } });
    return true;
  }
  await prisma.paymentObligation.updateMany({ where: { id: o.id, status: { in: ["DUE", "PAYING"] } }, data: { status: "PAYING" } });
  return true;
}
