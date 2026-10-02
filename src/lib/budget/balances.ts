// Who owes whom — computed from the ledger, per currency, with plain integer
// arithmetic. Only PAID + ACTIVE expenses with a known payer count; estimates,
// commitments and proposals never touch a balance. Settlements are recorded
// repayments and shift balances the way real money did.
export type LedgerExpense = {
  amountMinor: number;
  currency: string;
  paidByUserId: string | null;
  participants: { userId: string; shareMinor: number }[];
};
export type LedgerSettlement = { fromUserId: string; toUserId: string; amountMinor: number; currency: string };

export type Transfer = { fromUserId: string; toUserId: string; amountMinor: number };
export type CurrencyBalances = {
  currency: string;
  // positive = is owed money, negative = owes money
  net: Record<string, number>;
  paid: Record<string, number>;
  owed: Record<string, number>;
  // The minimum-ish set of payments that clears every balance. The underlying
  // expenses are untouched — this is only a suggested way to settle up.
  transfers: Transfer[];
};

export function computeBalances(expenses: LedgerExpense[], settlements: LedgerSettlement[]): CurrencyBalances[] {
  const byCurrency = new Map<string, CurrencyBalances>();
  const get = (currency: string) => {
    let b = byCurrency.get(currency);
    if (!b) {
      b = { currency, net: {}, paid: {}, owed: {}, transfers: [] };
      byCurrency.set(currency, b);
    }
    return b;
  };
  const add = (rec: Record<string, number>, id: string, n: number) => {
    rec[id] = (rec[id] ?? 0) + n;
  };

  for (const e of expenses) {
    if (!e.paidByUserId) continue;
    const b = get(e.currency);
    add(b.paid, e.paidByUserId, e.amountMinor);
    add(b.net, e.paidByUserId, e.amountMinor);
    for (const p of e.participants) {
      add(b.owed, p.userId, p.shareMinor);
      add(b.net, p.userId, -p.shareMinor);
    }
  }
  for (const s of settlements) {
    const b = get(s.currency);
    add(b.net, s.fromUserId, s.amountMinor); // paying down a debt raises your balance
    add(b.net, s.toUserId, -s.amountMinor);
  }

  for (const b of byCurrency.values()) {
    const creditors = Object.entries(b.net).filter(([, n]) => n > 0).map(([id, n]) => ({ id, n })).sort((x, y) => y.n - x.n || x.id.localeCompare(y.id));
    const debtors = Object.entries(b.net).filter(([, n]) => n < 0).map(([id, n]) => ({ id, n: -n })).sort((x, y) => y.n - x.n || x.id.localeCompare(y.id));
    let ci = 0;
    let di = 0;
    while (ci < creditors.length && di < debtors.length) {
      const amount = Math.min(creditors[ci].n, debtors[di].n);
      if (amount > 0) b.transfers.push({ fromUserId: debtors[di].id, toUserId: creditors[ci].id, amountMinor: amount });
      creditors[ci].n -= amount;
      debtors[di].n -= amount;
      if (creditors[ci].n === 0) ci++;
      if (debtors[di].n === 0) di++;
    }
  }
  return [...byCurrency.values()];
}
