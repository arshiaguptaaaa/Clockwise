import { getCurrentMember } from "@/lib/trip";
import { loadBudget } from "@/lib/budget/ledger";
import { BudgetView, type BudgetViewData } from "@/components/budget/BudgetView";

export const dynamic = "force-dynamic";

export default async function BudgetPage({
  params,
  searchParams,
}: {
  params: Promise<{ tripId: string }>;
  searchParams: Promise<{ edit?: string }>;
}) {
  const { tripId } = await params;
  const { edit } = await searchParams;
  const session = await getCurrentMember(tripId);
  if (!session) return null;
  const viewerId = session.member.userId;
  const data = await loadBudget(tripId, viewerId);

  const row = (e: (typeof data.expenses)[number]) => ({
    id: e.id,
    title: e.title,
    category: e.category,
    amountMinor: e.amountMinor,
    currency: e.currency,
    stage: e.stage,
    status: e.status,
    paidByUserId: e.paidByUserId,
    splitMethod: e.splitMethod,
    occurredAt: e.occurredAt.toISOString(),
    note: e.note,
    source: e.source,
    createdByUserId: e.createdByUserId,
    participants: e.participants.map((p) => ({ userId: p.userId, shareMinor: p.shareMinor, inputValue: p.inputValue })),
  });

  const view: BudgetViewData = {
    tripId,
    viewerId,
    members: data.members,
    currencies: data.currencies,
    expenses: data.expenses.map(row),
    proposed: data.proposed.map(row),
    settlements: data.settlements.map((s) => ({
      id: s.id,
      fromUserId: s.fromUserId,
      toUserId: s.toUserId,
      amountMinor: s.amountMinor,
      currency: s.currency,
      method: s.method,
      settledAt: s.settledAt.toISOString(),
    })),
    balances: data.balances,
    totals: data.totals,
    byCategory: data.byCategory,
    you: data.currencies.map((c) => ({ currency: c, ...data.you(c) })),
    budget: data.budget
      ? {
          currency: data.budget.currency,
          totalMinor: data.budget.totalMinor,
          categories: (() => {
            try {
              return JSON.parse(data.budget.categoryJson) as Record<string, number>;
            } catch {
              return {};
            }
          })(),
        }
      : null,
    editId: edit ?? null,
  };

  return <BudgetView data={view} />;
}
