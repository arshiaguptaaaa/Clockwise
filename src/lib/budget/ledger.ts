// Budget persistence. Every figure shown or stored goes through the pure
// functions in split.ts / balances.ts; this file only reads and writes rows,
// checks who may do what, and emits the events/notifications.
import { prisma } from "../prisma";
import { notify } from "../notifications";
import { computeShares, type SplitMethod, type SplitParticipant } from "./split";
import { computeBalances } from "./balances";
import { CATEGORIES, formatMoney, guessCategory, isCategory, type Category } from "./money";

export type Stage = "ESTIMATED" | "COMMITTED" | "PAID";

export type NewExpense = {
  tripId: string;
  actorUserId: string;
  title: string;
  category?: Category;
  amountMinor: number;
  currency: string;
  stage?: Stage;
  status?: "PROPOSED" | "ACTIVE";
  paidByUserId?: string | null;
  source?: "MANUAL" | "CHAT" | "RECEIPT" | "BOOKING" | "PINE_LABS" | "TICKET";
  sourceReferenceId?: string | null;
  splitMethod: SplitMethod;
  participants: SplitParticipant[];
  occurredAt?: Date;
  note?: string | null;
  proposalMessageId?: string | null;
  idempotencyKey?: string | null;
};

async function memberIds(tripId: string): Promise<Set<string>> {
  const rows = await prisma.tripMember.findMany({ where: { tripId }, select: { userId: true } });
  return new Set(rows.map((r) => r.userId));
}

async function nameMap(tripId: string): Promise<Map<string, string>> {
  const rows = await prisma.tripMember.findMany({ where: { tripId }, include: { user: { select: { name: true } } } });
  return new Map(rows.map((r) => [r.userId, r.user.name]));
}

async function event(tripId: string, kind: string, actorUserId: string | null, payload: Record<string, unknown>, scope: "GROUP" | "PERSONAL" = "GROUP", subjectUserId: string | null = null) {
  return prisma.tripEvent.create({
    data: {
      tripId,
      kind,
      scope,
      actorUserId,
      subjectUserId,
      sourceChannel: "SYSTEM",
      confidence: "HIGH",
      payload: JSON.stringify(payload),
      propagation: JSON.stringify(["budget", "notifications"]),
    },
  });
}

export type CreateResult = { ok: true; expenseId: string; duplicate?: boolean } | { ok: false; error: string };

export async function createExpense(p: NewExpense): Promise<CreateResult> {
  const members = await memberIds(p.tripId);
  if (!members.has(p.actorUserId)) return { ok: false, error: "You're not on this trip." };
  if (p.paidByUserId && !members.has(p.paidByUserId)) return { ok: false, error: "The person who paid isn't on this trip." };
  if (p.participants.some((x) => !members.has(x.userId))) return { ok: false, error: "Everyone in the split must be on this trip." };
  if (!p.title.trim()) return { ok: false, error: "What was it? Add a short title." };
  if (!/^[A-Z]{3}$/.test(p.currency)) return { ok: false, error: "Currency should be a 3-letter code like INR." };

  const stage: Stage = p.stage ?? "PAID";
  const status = p.status ?? "ACTIVE";
  // A real, ledger-affecting expense needs evidence of who paid.
  if (stage === "PAID" && status === "ACTIVE" && !p.paidByUserId) return { ok: false, error: "Who paid? Pick the person who paid." };

  if (p.idempotencyKey) {
    const existing = await prisma.expense.findUnique({ where: { idempotencyKey: p.idempotencyKey } });
    if (existing) return { ok: true, expenseId: existing.id, duplicate: true };
  }

  const split = computeShares(p.splitMethod, p.amountMinor, p.participants);
  if (!split.ok) return { ok: false, error: split.error };

  const expense = await prisma.expense.create({
    data: {
      tripId: p.tripId,
      title: p.title.trim().slice(0, 120),
      category: p.category && isCategory(p.category) ? p.category : guessCategory(p.title),
      amountMinor: p.amountMinor,
      currency: p.currency,
      stage,
      status,
      paidByUserId: p.paidByUserId ?? null,
      source: p.source ?? "MANUAL",
      sourceReferenceId: p.sourceReferenceId ?? null,
      splitMethod: p.splitMethod,
      occurredAt: p.occurredAt ?? new Date(),
      createdByUserId: p.actorUserId,
      proposalMessageId: p.proposalMessageId ?? null,
      note: p.note ?? null,
      idempotencyKey: p.idempotencyKey ?? null,
      participants: { create: split.shares.map((s) => ({ userId: s.userId, shareMinor: s.shareMinor, inputValue: s.inputValue })) },
    },
  });

  const names = await nameMap(p.tripId);
  await event(p.tripId, status === "PROPOSED" ? "EXPENSE_PROPOSED" : "EXPENSE_ADDED", p.actorUserId, {
    expenseId: expense.id,
    title: expense.title,
    amountMinor: expense.amountMinor,
    currency: expense.currency,
    stage,
    source: expense.source,
    paidBy: p.paidByUserId ? names.get(p.paidByUserId) ?? null : null,
    splitMethod: p.splitMethod,
    shares: split.shares.map((s) => ({ name: names.get(s.userId) ?? "?", shareMinor: s.shareMinor })),
  });
  if (status === "ACTIVE") await afterLedgerChange(p.tripId, expense.id, p.actorUserId, "added");
  return { ok: true, expenseId: expense.id };
}

// Someone confirmed a proposed expense (optionally supplying who paid).
export async function confirmExpense(expenseId: string, actorUserId: string, paidByUserId?: string): Promise<CreateResult> {
  const e = await prisma.expense.findUnique({ where: { id: expenseId } });
  if (!e) return { ok: false, error: "That expense no longer exists." };
  const members = await memberIds(e.tripId);
  if (!members.has(actorUserId)) return { ok: false, error: "You're not on this trip." };
  const trip = await prisma.trip.findUnique({ where: { id: e.tripId }, select: { createdBy: true } });
  const payer = paidByUserId ?? e.paidByUserId;
  const allowed = actorUserId === e.createdByUserId || actorUserId === payer || actorUserId === trip?.createdBy;
  if (!allowed) return { ok: false, error: "Only the person who proposed it, the payer or the organiser can confirm this." };
  if (e.status !== "PROPOSED") return { ok: true, expenseId: e.id, duplicate: true };
  if (e.stage === "PAID" && !payer) return { ok: false, error: "Who paid? Pick the person who paid." };
  if (payer && !members.has(payer)) return { ok: false, error: "The payer isn't on this trip." };
  await prisma.expense.update({ where: { id: e.id }, data: { status: "ACTIVE", paidByUserId: payer ?? null } });
  await afterLedgerChange(e.tripId, e.id, actorUserId, "added");
  return { ok: true, expenseId: e.id };
}

export async function voidExpense(expenseId: string, actorUserId: string): Promise<{ ok: boolean; error?: string }> {
  const e = await prisma.expense.findUnique({ where: { id: expenseId } });
  if (!e) return { ok: false, error: "That expense no longer exists." };
  const trip = await prisma.trip.findUnique({ where: { id: e.tripId }, select: { createdBy: true } });
  if (!(await memberIds(e.tripId)).has(actorUserId)) return { ok: false, error: "You're not on this trip." };
  if (actorUserId !== e.createdByUserId && actorUserId !== e.paidByUserId && actorUserId !== trip?.createdBy) {
    return { ok: false, error: "Only whoever added it, the payer or the organiser can remove this." };
  }
  await prisma.expense.update({ where: { id: e.id }, data: { status: "VOID" } });
  await event(e.tripId, "EXPENSE_VOIDED", actorUserId, { expenseId: e.id, title: e.title, amountMinor: e.amountMinor, currency: e.currency });
  if (e.status === "ACTIVE") await recalcEvent(e.tripId, actorUserId);
  return { ok: true };
}

// Replace an expense's details and split in one go.
export async function updateExpense(expenseId: string, actorUserId: string, patch: Omit<NewExpense, "tripId" | "actorUserId">): Promise<CreateResult> {
  const e = await prisma.expense.findUnique({ where: { id: expenseId } });
  if (!e) return { ok: false, error: "That expense no longer exists." };
  const trip = await prisma.trip.findUnique({ where: { id: e.tripId }, select: { createdBy: true } });
  const members = await memberIds(e.tripId);
  if (!members.has(actorUserId)) return { ok: false, error: "You're not on this trip." };
  if (actorUserId !== e.createdByUserId && actorUserId !== e.paidByUserId && actorUserId !== trip?.createdBy) {
    return { ok: false, error: "Only whoever added it, the payer or the organiser can edit this." };
  }
  if (patch.participants.some((x) => !members.has(x.userId)) || (patch.paidByUserId && !members.has(patch.paidByUserId))) {
    return { ok: false, error: "Everyone involved must be on this trip." };
  }
  const split = computeShares(patch.splitMethod, patch.amountMinor, patch.participants);
  if (!split.ok) return { ok: false, error: split.error };
  const stage = (patch.stage ?? e.stage) as Stage;
  if (stage === "PAID" && e.status === "ACTIVE" && !patch.paidByUserId) return { ok: false, error: "Who paid? Pick the person who paid." };
  await prisma.$transaction([
    prisma.expenseParticipant.deleteMany({ where: { expenseId } }),
    prisma.expense.update({
      where: { id: expenseId },
      data: {
        title: patch.title.trim().slice(0, 120),
        category: patch.category && isCategory(patch.category) ? patch.category : e.category,
        amountMinor: patch.amountMinor,
        currency: patch.currency,
        stage,
        paidByUserId: stage === "PAID" ? patch.paidByUserId ?? null : null,
        splitMethod: patch.splitMethod,
        occurredAt: patch.occurredAt ?? e.occurredAt,
        note: patch.note ?? null,
        participants: { create: split.shares.map((s) => ({ userId: s.userId, shareMinor: s.shareMinor, inputValue: s.inputValue })) },
      },
    }),
  ]);
  await event(e.tripId, "EXPENSE_UPDATED", actorUserId, { expenseId, title: patch.title, amountMinor: patch.amountMinor, currency: patch.currency });
  if (e.status === "ACTIVE") await afterLedgerChange(e.tripId, expenseId, actorUserId, "updated");
  return { ok: true, expenseId };
}

// --- reads -----------------------------------------------------------------

export type BudgetData = Awaited<ReturnType<typeof loadBudget>>;

export async function loadBudget(tripId: string, viewerId: string) {
  const [members, expenses, settlements, budget] = await Promise.all([
    prisma.tripMember.findMany({ where: { tripId }, include: { user: { select: { id: true, name: true } } }, orderBy: { id: "asc" } }),
    prisma.expense.findMany({ where: { tripId, status: { in: ["ACTIVE", "PROPOSED"] } }, include: { participants: true }, orderBy: { occurredAt: "desc" } }),
    prisma.settlement.findMany({ where: { tripId }, orderBy: { settledAt: "desc" } }),
    prisma.tripBudget.findUnique({ where: { tripId } }),
  ]);
  // A PROPOSED expense is only visible to the person who proposed it until confirmed.
  const visible = expenses.filter((e) => e.status === "ACTIVE" || e.createdByUserId === viewerId);
  const active = visible.filter((e) => e.status === "ACTIVE");
  const proposed = visible.filter((e) => e.status === "PROPOSED");
  const ledger = active.filter((e) => e.stage === "PAID");

  const balances = computeBalances(
    ledger.map((e) => ({ amountMinor: e.amountMinor, currency: e.currency, paidByUserId: e.paidByUserId, participants: e.participants })),
    settlements
  );

  const sumBy = (rows: typeof active, stage: Stage) => {
    const m: Record<string, number> = {};
    for (const e of rows.filter((x) => x.stage === stage)) m[e.currency] = (m[e.currency] ?? 0) + e.amountMinor;
    return m;
  };
  const planned = active.filter((e) => e.stage !== "ESTIMATED");
  const byCategory: Record<string, Record<string, number>> = {};
  for (const e of planned) {
    byCategory[e.category] ??= {};
    byCategory[e.category][e.currency] = (byCategory[e.category][e.currency] ?? 0) + e.amountMinor;
  }

  const you = (currency: string) => {
    const paid = ledger.filter((e) => e.currency === currency && e.paidByUserId === viewerId).reduce((a, e) => a + e.amountMinor, 0);
    const share = ledger.filter((e) => e.currency === currency).reduce((a, e) => a + (e.participants.find((p) => p.userId === viewerId)?.shareMinor ?? 0), 0);
    const net = balances.find((b) => b.currency === currency)?.net[viewerId] ?? 0;
    return { paid, share, net };
  };

  return {
    members: members.map((m) => ({ id: m.userId, name: m.user.name })),
    expenses: active,
    proposed,
    settlements,
    budget,
    balances,
    totals: { estimated: sumBy(active, "ESTIMATED"), committed: sumBy(active, "COMMITTED"), paid: sumBy(active, "PAID") },
    byCategory,
    you,
    currencies: [...new Set([...active.map((e) => e.currency), ...proposed.map((e) => e.currency)])],
  };
}

// --- settlements & budget --------------------------------------------------

export async function recordSettlement(p: {
  tripId: string;
  actorUserId: string;
  fromUserId: string;
  toUserId: string;
  amountMinor: number;
  currency: string;
  method?: string;
  note?: string | null;
}): Promise<{ ok: boolean; error?: string }> {
  const members = await memberIds(p.tripId);
  const trip = await prisma.trip.findUnique({ where: { id: p.tripId }, select: { createdBy: true } });
  if (!members.has(p.actorUserId) || !members.has(p.fromUserId) || !members.has(p.toUserId)) return { ok: false, error: "Everyone involved must be on this trip." };
  if (p.fromUserId === p.toUserId) return { ok: false, error: "Pick two different people." };
  if (!Number.isInteger(p.amountMinor) || p.amountMinor <= 0) return { ok: false, error: "Enter an amount greater than zero." };
  if (![p.fromUserId, p.toUserId, trip?.createdBy].includes(p.actorUserId)) return { ok: false, error: "Only the two people involved (or the organiser) can record this." };
  const names = await nameMap(p.tripId);
  await prisma.settlement.create({
    data: {
      tripId: p.tripId,
      fromUserId: p.fromUserId,
      toUserId: p.toUserId,
      amountMinor: p.amountMinor,
      currency: p.currency,
      method: p.method ?? "MANUAL",
      note: p.note ?? null,
      createdByUserId: p.actorUserId,
    },
  });
  await event(p.tripId, "SETTLEMENT_RECORDED", p.actorUserId, {
    from: names.get(p.fromUserId),
    to: names.get(p.toUserId),
    amountMinor: p.amountMinor,
    currency: p.currency,
    method: p.method ?? "MANUAL",
  });
  const other = p.actorUserId === p.fromUserId ? p.toUserId : p.fromUserId;
  await notify({
    tripId: p.tripId,
    recipientIds: [other],
    severity: "IMPORTANT",
    kind: "SETTLEMENT_RECORDED",
    title: "Settlement recorded",
    body: `${names.get(p.fromUserId)} → ${names.get(p.toUserId)}: ${formatMoney(p.amountMinor, p.currency)} marked as settled.`,
    href: `/trips/${p.tripId}/budget`,
  });
  await recalcEvent(p.tripId, p.actorUserId);
  return { ok: true };
}

export async function setTripBudget(p: { tripId: string; actorUserId: string; currency: string; totalMinor: number | null; categories: Partial<Record<Category, number>> }): Promise<{ ok: boolean; error?: string }> {
  if (!(await memberIds(p.tripId)).has(p.actorUserId)) return { ok: false, error: "You're not on this trip." };
  const clean: Record<string, number> = {};
  for (const c of CATEGORIES) {
    const v = p.categories[c];
    if (v != null && Number.isInteger(v) && v > 0) clean[c] = v;
  }
  if (p.totalMinor != null && (!Number.isInteger(p.totalMinor) || p.totalMinor <= 0)) return { ok: false, error: "The total must be greater than zero." };
  await prisma.tripBudget.upsert({
    where: { tripId: p.tripId },
    create: { tripId: p.tripId, currency: p.currency, totalMinor: p.totalMinor, categoryJson: JSON.stringify(clean) },
    update: { currency: p.currency, totalMinor: p.totalMinor, categoryJson: JSON.stringify(clean) },
  });
  await event(p.tripId, "BUDGET_SET", p.actorUserId, { currency: p.currency, totalMinor: p.totalMinor, categories: clean });
  await checkThreshold(p.tripId);
  return { ok: true };
}

// --- consequences of a ledger change ---------------------------------------

async function recalcEvent(tripId: string, actorUserId: string | null) {
  const names = await nameMap(tripId);
  const data = await loadBudget(tripId, actorUserId ?? "");
  await event(tripId, "BALANCES_RECALCULATED", actorUserId, {
    balances: data.balances.map((b) => ({
      currency: b.currency,
      transfers: b.transfers.map((t) => ({ from: names.get(t.fromUserId) ?? "?", to: names.get(t.toUserId) ?? "?", amountMinor: t.amountMinor })),
    })),
  });
}

async function afterLedgerChange(tripId: string, expenseId: string, actorUserId: string, verb: "added" | "updated") {
  const e = await prisma.expense.findUnique({ where: { id: expenseId }, include: { participants: true } });
  if (!e) return;
  const names = await nameMap(tripId);
  await recalcEvent(tripId, actorUserId);

  // Meaningful money events only: tell each person their own share, not everyone every figure.
  if (e.stage === "PAID" && e.paidByUserId) {
    for (const part of e.participants) {
      if (part.userId === e.paidByUserId) continue;
      await notify({
        tripId,
        recipientIds: [part.userId],
        severity: "INFO",
        kind: verb === "added" ? "EXPENSE_ADDED" : "EXPENSE_UPDATED",
        title: verb === "added" ? "New shared expense" : "An expense changed",
        body: `${names.get(e.paidByUserId) ?? "Someone"} ${verb === "added" ? "added" : "updated"} ${formatMoney(e.amountMinor, e.currency)} ${e.title}. Your share: ${formatMoney(part.shareMinor, e.currency)}.`,
        href: `/trips/${tripId}/budget`,
      });
    }
  }
  await checkThreshold(tripId);
}

// Tells the group once when planned spend (committed + paid) reaches 80% / 100%
// of the group budget. Same-currency only — no conversion is ever guessed.
export async function checkThreshold(tripId: string) {
  const budget = await prisma.tripBudget.findUnique({ where: { tripId } });
  if (!budget?.totalMinor) return;
  const rows = await prisma.expense.findMany({ where: { tripId, status: "ACTIVE", stage: { in: ["COMMITTED", "PAID"] }, currency: budget.currency } });
  const planned = rows.reduce((a, e) => a + e.amountMinor, 0);
  const pct = Math.floor((planned / budget.totalMinor) * 100);
  for (const level of [100, 80]) {
    if (pct < level) continue;
    const prior = await prisma.tripEvent.findFirst({ where: { tripId, kind: "BUDGET_THRESHOLD_REACHED", payload: { contains: `"level":${level},` } } });
    if (prior) return;
    await event(tripId, "BUDGET_THRESHOLD_REACHED", null, { level, plannedMinor: planned, totalMinor: budget.totalMinor, currency: budget.currency });
    const members = [...(await memberIds(tripId))];
    await notify({
      tripId,
      recipientIds: members,
      severity: "IMPORTANT",
      kind: "BUDGET_THRESHOLD_REACHED",
      title: level >= 100 ? "The group budget is used up" : "80% of the group budget is planned",
      body: `${formatMoney(planned, budget.currency)} of ${formatMoney(budget.totalMinor, budget.currency)} is committed or paid (${pct}%).`,
      href: `/trips/${tripId}/budget`,
    });
    return;
  }
}

// --- automatic expenses ----------------------------------------------------

// A BOOKING proposal with an amount has been confirmed by the organiser: the
// money is now COMMITTED (approved, not yet paid). Split equally by default.
export async function commitFromProposal(p: { tripId: string; proposalId: string; title: string; amountMajor: number; currency: string; actorUserId: string }) {
  const members = [...(await memberIds(p.tripId))];
  return createExpense({
    tripId: p.tripId,
    actorUserId: p.actorUserId,
    title: p.title,
    amountMinor: Math.round(p.amountMajor * 100),
    currency: p.currency,
    stage: "COMMITTED",
    status: "ACTIVE",
    source: "BOOKING",
    sourceReferenceId: p.proposalId,
    splitMethod: "EQUAL",
    participants: members.map((userId) => ({ userId })),
    idempotencyKey: `commit:${p.proposalId}`,
  });
}

// Pine Labs reported PROCESSED (verified by an authoritative status fetch):
// turn the commitment into a PAID expense. Who paid is unknown unless the
// payment request recorded a payer — if not, it waits as PROPOSED for someone
// to say who paid, rather than guessing.
export async function markPaidFromPayment(p: { tripId: string; bookingId: string; proposalId: string | null; amountMinor: number; currency: string; payerId: string | null }) {
  const committed = p.proposalId ? await prisma.expense.findUnique({ where: { idempotencyKey: `commit:${p.proposalId}` } }) : null;
  if (committed) {
    if (committed.stage === "PAID") return;
    await prisma.expense.update({
      where: { id: committed.id },
      data: { stage: "PAID", source: "PINE_LABS", sourceReferenceId: p.bookingId, occurredAt: new Date(), paidByUserId: p.payerId, status: p.payerId ? "ACTIVE" : "PROPOSED", createdByUserId: committed.createdByUserId },
    });
    await event(p.tripId, "EXPENSE_PAID", null, { expenseId: committed.id, title: committed.title, amountMinor: committed.amountMinor, currency: committed.currency, verifiedBy: "pinelabs_api_fetch", needsPayer: !p.payerId });
    if (p.payerId) await afterLedgerChange(p.tripId, committed.id, p.payerId, "added");
    return;
  }
  const members = [...(await memberIds(p.tripId))];
  const organiser = await prisma.trip.findUnique({ where: { id: p.tripId }, select: { createdBy: true } });
  await createExpense({
    tripId: p.tripId,
    actorUserId: organiser?.createdBy ?? members[0],
    title: "Trip payment",
    amountMinor: p.amountMinor,
    currency: p.currency,
    stage: "PAID",
    status: p.payerId ? "ACTIVE" : "PROPOSED",
    paidByUserId: p.payerId,
    source: "PINE_LABS",
    sourceReferenceId: p.bookingId,
    splitMethod: "EQUAL",
    participants: members.map((userId) => ({ userId })),
    idempotencyKey: `pay:${p.bookingId}`,
  });
}
