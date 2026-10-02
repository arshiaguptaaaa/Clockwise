"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUserId } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { createExpense, confirmExpense, voidExpense, updateExpense, recordSettlement, setTripBudget, type Stage } from "@/lib/budget/ledger";
import { parseMajorToMinor, isCategory, type Category } from "@/lib/budget/money";
import type { SplitMethod } from "@/lib/budget/split";

// Every action re-derives who is acting from the session; nothing a client
// sends is trusted for identity. Amounts arrive as what the person typed
// (major units) and are converted here; all arithmetic happens in
// src/lib/budget.
export type ExpenseInput = {
  title: string;
  amount: string;
  currency: string;
  category: string;
  stage?: Stage;
  paidByUserId: string | null;
  splitMethod: SplitMethod;
  // value = what the person typed for that row (major units for EXACT, percent, or shares)
  participants: { userId: string; value?: string }[];
  occurredOn?: string;
  note?: string;
};
export type ActionResult = { ok: true; expenseId?: string } | { ok: false; error: string };

function toSplit(input: ExpenseInput) {
  return input.participants.map((p) => {
    const raw = p.value == null || p.value === "" ? undefined : Number(p.value);
    const value = raw == null || !Number.isFinite(raw) ? undefined : input.splitMethod === "EXACT" ? Math.round(raw * 100) : raw;
    return { userId: p.userId, value };
  });
}

function refresh(tripId: string) {
  for (const path of [`/trips/${tripId}/budget`, `/trips/${tripId}/room`, `/trips/${tripId}/agent`]) revalidatePath(path);
}

export async function addExpenseAction(tripId: string, input: ExpenseInput): Promise<ActionResult> {
  const userId = await getCurrentUserId();
  if (!userId) return { ok: false, error: "Sign in first." };
  const amountMinor = parseMajorToMinor(input.amount);
  if (amountMinor == null) return { ok: false, error: "Enter an amount greater than zero." };
  const stage = input.stage ?? "PAID";
  const res = await createExpense({
    tripId,
    actorUserId: userId,
    title: input.title,
    category: isCategory(input.category) ? (input.category as Category) : undefined,
    amountMinor,
    currency: input.currency.toUpperCase(),
    stage,
    status: "ACTIVE",
    paidByUserId: stage === "PAID" ? input.paidByUserId : null,
    source: "MANUAL",
    splitMethod: input.splitMethod,
    participants: toSplit(input),
    occurredAt: input.occurredOn ? new Date(`${input.occurredOn}T12:00:00Z`) : undefined,
    note: input.note ?? null,
  });
  refresh(tripId);
  return res.ok ? { ok: true, expenseId: res.expenseId } : res;
}

export async function updateExpenseAction(tripId: string, expenseId: string, input: ExpenseInput): Promise<ActionResult> {
  const userId = await getCurrentUserId();
  if (!userId) return { ok: false, error: "Sign in first." };
  const amountMinor = parseMajorToMinor(input.amount);
  if (amountMinor == null) return { ok: false, error: "Enter an amount greater than zero." };
  const res = await updateExpense(expenseId, userId, {
    title: input.title,
    category: isCategory(input.category) ? (input.category as Category) : undefined,
    amountMinor,
    currency: input.currency.toUpperCase(),
    stage: input.stage,
    paidByUserId: input.paidByUserId,
    splitMethod: input.splitMethod,
    participants: toSplit(input),
    occurredAt: input.occurredOn ? new Date(`${input.occurredOn}T12:00:00Z`) : undefined,
    note: input.note ?? null,
  });
  refresh(tripId);
  return res.ok ? { ok: true, expenseId: res.expenseId } : res;
}

// Used by the chat card and the Budget page: confirms a PROPOSED expense.
export async function confirmExpenseAction(expenseId: string, messageId?: string, paidByUserId?: string): Promise<ActionResult> {
  const userId = await getCurrentUserId();
  if (!userId) return { ok: false, error: "Sign in first." };
  const res = await confirmExpense(expenseId, userId, paidByUserId);
  const expense = await prisma.expense.findUnique({ where: { id: expenseId }, select: { tripId: true } });
  if (res.ok && messageId) {
    await prisma.message.update({ where: { id: messageId }, data: { cardStatus: "CONFIRMED" } }).catch(() => undefined);
  }
  if (expense) refresh(expense.tripId);
  return res.ok ? { ok: true, expenseId } : res;
}

export async function voidExpenseAction(expenseId: string, messageId?: string): Promise<ActionResult> {
  const userId = await getCurrentUserId();
  if (!userId) return { ok: false, error: "Sign in first." };
  const expense = await prisma.expense.findUnique({ where: { id: expenseId }, select: { tripId: true } });
  const res = await voidExpense(expenseId, userId);
  if (res.ok && messageId) await prisma.message.update({ where: { id: messageId }, data: { cardStatus: "DISMISSED" } }).catch(() => undefined);
  if (expense) refresh(expense.tripId);
  return res.ok ? { ok: true } : { ok: false, error: res.error ?? "Couldn't remove that." };
}

export async function settleAction(
  tripId: string,
  input: { fromUserId: string; toUserId: string; amount: string; currency: string; method: string; note?: string }
): Promise<ActionResult> {
  const userId = await getCurrentUserId();
  if (!userId) return { ok: false, error: "Sign in first." };
  const amountMinor = parseMajorToMinor(input.amount);
  if (amountMinor == null) return { ok: false, error: "Enter an amount greater than zero." };
  const res = await recordSettlement({
    tripId,
    actorUserId: userId,
    fromUserId: input.fromUserId,
    toUserId: input.toUserId,
    amountMinor,
    currency: input.currency,
    method: input.method,
    note: input.note ?? null,
  });
  refresh(tripId);
  return res.ok ? { ok: true } : { ok: false, error: res.error ?? "Couldn't record that." };
}

export async function saveBudgetAction(
  tripId: string,
  input: { currency: string; total: string; categories: Partial<Record<Category, string>> }
): Promise<ActionResult> {
  const userId = await getCurrentUserId();
  if (!userId) return { ok: false, error: "Sign in first." };
  const cats: Partial<Record<Category, number>> = {};
  for (const [k, v] of Object.entries(input.categories)) {
    if (!v || !isCategory(k)) continue;
    const m = parseMajorToMinor(v);
    if (m == null) return { ok: false, error: `That ${k.toLowerCase()} amount isn't a valid number.` };
    cats[k] = m;
  }
  const total = input.total.trim() ? parseMajorToMinor(input.total) : null;
  if (input.total.trim() && total == null) return { ok: false, error: "The total isn't a valid number." };
  const res = await setTripBudget({ tripId, actorUserId: userId, currency: input.currency.toUpperCase(), totalMinor: total, categories: cats });
  refresh(tripId);
  return res.ok ? { ok: true } : { ok: false, error: res.error ?? "Couldn't save that." };
}
