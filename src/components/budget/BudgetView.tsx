"use client";

import { PayButton } from "@/components/payments/PayButton";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, X } from "lucide-react";
import { formatMoney, CATEGORIES, CATEGORY_LABEL, type Category } from "@/lib/budget/money";
import { computeShares, type SplitMethod } from "@/lib/budget/split";
import type { CurrencyBalances } from "@/lib/budget/balances";
import {
  addExpenseAction,
  updateExpenseAction,
  confirmExpenseAction,
  voidExpenseAction,
  settleAction,
  saveBudgetAction,
  type ExpenseInput,
} from "@/app/budget-actions";

type Member = { id: string; name: string };
type ExpenseRow = {
  id: string;
  title: string;
  category: string;
  amountMinor: number;
  currency: string;
  stage: string;
  status: string;
  paidByUserId: string | null;
  splitMethod: string;
  occurredAt: string;
  note: string | null;
  source: string;
  createdByUserId: string | null;
  participants: { userId: string; shareMinor: number; inputValue: number | null }[];
};
export type BudgetViewData = {
  tripId: string;
  viewerId: string;
  members: Member[];
  currencies: string[];
  expenses: ExpenseRow[];
  proposed: ExpenseRow[];
  settlements: { id: string; fromUserId: string; toUserId: string; amountMinor: number; currency: string; method: string; settledAt: string }[];
  balances: CurrencyBalances[];
  totals: { estimated: Record<string, number>; committed: Record<string, number>; paid: Record<string, number> };
  byCategory: Record<string, Record<string, number>>;
  you: { currency: string; paid: number; share: number; net: number }[];
  budget: { currency: string; totalMinor: number | null; categories: Record<string, number> } | null;
  editId: string | null;
};

const STAGE_STYLE: Record<string, string> = {
  ESTIMATED: "bg-surface-muted text-muted-foreground",
  COMMITTED: "bg-pop-yellow-tint text-foreground",
  PAID: "bg-success-tint text-success",
};
const STAGE_WORD: Record<string, string> = { ESTIMATED: "Estimated", COMMITTED: "Committed", PAID: "Paid" };
const METHODS: { id: SplitMethod; label: string }[] = [
  { id: "EQUAL", label: "Equal" },
  { id: "SELECT", label: "Select" },
  { id: "EXACT", label: "Exact" },
  { id: "PERCENT", label: "%" },
  { id: "SHARES", label: "Shares" },
];

const label = "eyebrow";
const input = "w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-sm outline-none focus:border-accent";

function sumLine(rec: Record<string, number>): string {
  const parts = Object.entries(rec).map(([c, v]) => formatMoney(v, c));
  return parts.length ? parts.join(" + ") : "—";
}

export function BudgetView({ data, owe = [] }: { data: BudgetViewData; owe?: { obligationId: string; title: string; amountMinor: number; currency: string; paying: boolean }[] }) {
  const router = useRouter();
  const nameOf = (id: string | null) => data.members.find((m) => m.id === id)?.name ?? "Someone";
  const [sheet, setSheet] = useState<null | { kind: "expense"; edit?: ExpenseRow } | { kind: "settle"; from: string; to: string; amount: number; currency: string } | { kind: "budget" }>(
    data.editId ? { kind: "expense", edit: [...data.expenses, ...data.proposed].find((e) => e.id === data.editId) } : null
  );
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const done = () => {
    setSheet(null);
    setError(null);
    router.replace(`/trips/${data.tripId}/budget`);
    router.refresh();
  };

  const settledUp = data.balances.length > 0 && data.balances.every((b) => b.transfers.length === 0);
  const empty = data.expenses.length === 0 && data.proposed.length === 0;

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div className="flex-1 overflow-y-auto px-5 pb-28 pt-6 stack-sections">
        <header>
          <p className={label}>Budget</p>
          <h1 className="headline headline-xl mt-2">Money, without the group chat math.</h1>
        </header>

        {owe.length > 0 && (
          <section data-you-owe>
            <p className={label}>You owe</p>
            <ul className="mt-2 space-y-4">
              {owe.map((o) => (
                <li key={o.obligationId}>
                  <p className="font-display text-[22px] leading-tight tracking-[-0.01em]">{o.title}</p>
                  <p className="mt-0.5 font-display text-[34px] leading-[1.05] tracking-[-0.02em]">{formatMoney(o.amountMinor, o.currency)}</p>
                  <PayButton obligationId={o.obligationId} label={o.paying ? "FINISH PAYING SECURELY" : "PAY SECURELY"} className="mt-2" />
                  <p className="mt-1.5 text-[11.5px] text-muted-foreground">You&apos;ll pay on a secure checkout page. It counts as paid once the payment is confirmed.</p>
                </li>
              ))}
            </ul>
          </section>
        )}

        {data.you.length > 0 && (
          <section>
            <p className={label}>You</p>
            {data.you.map((y) => (
              <div key={y.currency} className="mt-3 first:mt-2">
                <div className="grid grid-cols-3 gap-2 text-sm">
                  <div>
                    <p className="text-[11px] text-muted-foreground">You paid</p>
                    <p className="font-display text-[22px] leading-tight tracking-[-0.01em]">{formatMoney(y.paid, y.currency)}</p>
                  </div>
                  <div>
                    <p className="text-[11px] text-muted-foreground">Your share</p>
                    <p className="font-display text-[22px] leading-tight tracking-[-0.01em]">{formatMoney(y.share, y.currency)}</p>
                  </div>
                  <div>
                    <p className="text-[11px] text-muted-foreground">{y.net >= 0 ? "You're owed" : "You owe"}</p>
                    <p className={`font-display text-[22px] leading-tight tracking-[-0.01em] ${y.net > 0 ? "text-success" : y.net < 0 ? "text-danger" : ""}`}>{formatMoney(Math.abs(y.net), y.currency)}</p>
                  </div>
                </div>
              </div>
            ))}
          </section>
        )}

        <section>
          <p className={label}>Where the money is</p>
          <div className="mt-2 grid grid-cols-3 gap-2">
            {(
              [
                ["ESTIMATED", data.totals.estimated, "A guess"],
                ["COMMITTED", data.totals.committed, "Approved"],
                ["PAID", data.totals.paid, "Money moved"],
              ] as const
            ).map(([stage, rec, hint]) => (
              <div key={stage} className="border-l border-border pl-3 first:border-l-0 first:pl-0">
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${STAGE_STYLE[stage]}`}>{STAGE_WORD[stage]}</span>
                <p className="mt-2 font-display text-[20px] leading-tight tracking-[-0.01em]" data-stage-total={stage}>{sumLine(rec)}</p>
                <p className="text-[11px] text-muted-foreground">{hint}</p>
              </div>
            ))}
          </div>
        </section>

        {data.proposed.length > 0 && (
          <section>
            <p className={label}>Waiting for your yes ✦</p>
            <div className="mt-2 space-y-2">
              {data.proposed.map((e) => (
                <div key={e.id} className="border-l-2 border-accent pl-3">
                  <p className="text-sm font-semibold">{e.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatMoney(e.amountMinor, e.currency)} · paid by {nameOf(e.paidByUserId)} · split {e.participants.length} ways
                  </p>
                  <div className="mt-2 flex gap-2">
                    <button
                      disabled={busy}
                      className="cursor-pointer rounded-full bg-accent px-4 py-1.5 text-xs font-semibold text-accent-foreground"
                      onClick={() => start(async () => { const r = await confirmExpenseAction(e.id); if (!r.ok) setError(r.error); else done(); })}
                    >
                      Add expense
                    </button>
                    <button className="cursor-pointer rounded-full border border-border px-4 py-1.5 text-xs font-semibold" onClick={() => setSheet({ kind: "expense", edit: e })}>
                      Edit
                    </button>
                    <button
                      className="cursor-pointer px-2 text-xs text-muted-foreground"
                      onClick={() => start(async () => { await voidExpenseAction(e.id); done(); })}
                    >
                      Not an expense
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        <section>
          <p className={label}>Who owes whom</p>
          {data.balances.length === 0 || settledUp ? (
            <p className="mt-2 text-sm text-muted-foreground">
              {empty ? "NO ONE OWES ANYONE. Enjoy it while it lasts." : settledUp ? "All square ✦ Nobody owes anybody." : "Nothing to settle yet — only paid expenses count."}
            </p>
          ) : (
            <div className="row-rule mt-2">
              {data.balances.flatMap((b) =>
                b.transfers.map((t, i) => (
                  <div key={`${b.currency}-${i}`} className="flex items-center justify-between gap-3 py-3" data-transfer>
                    <p className="text-sm">
                      <span className="font-semibold">{nameOf(t.fromUserId)}</span> pays <span className="font-semibold">{nameOf(t.toUserId)}</span>{" "}
                      <span className="font-semibold">{formatMoney(t.amountMinor, b.currency)}</span>
                    </p>
                    <button
                      className="shrink-0 cursor-pointer rounded-full border border-accent px-3 py-1.5 text-xs font-semibold text-accent"
                      onClick={() => setSheet({ kind: "settle", from: t.fromUserId, to: t.toUserId, amount: t.amountMinor, currency: b.currency })}
                    >
                      Mark as settled
                    </button>
                  </div>
                ))
              )}
              <p className="text-[11px] text-muted-foreground">A simplified way to settle. Every expense underneath stays exactly as entered. Clockwise records settlements — it doesn&apos;t move money.</p>
            </div>
          )}
        </section>

        <section>
          <div className="flex items-center justify-between">
            <p className={label}>Group budget</p>
            <button className="cursor-pointer text-xs font-semibold text-accent" onClick={() => setSheet({ kind: "budget" })}>
              {data.budget ? "Edit" : "Set a budget"}
            </button>
          </div>
          <BudgetBars data={data} />
        </section>

        <section>
          <p className={label}>Expenses</p>
          {empty ? (
            <p className="mt-2 text-sm text-muted-foreground">Tell Clockwise in chat — &ldquo;I paid 6k for dinner, split between us&rdquo; — or add one below.</p>
          ) : (
            <ul className="row-rule mt-1">
              {data.expenses.map((e) => (
                <li key={e.id}>
                  <button className="flex w-full cursor-pointer items-center justify-between gap-3 py-3.5 text-left" onClick={() => setSheet({ kind: "expense", edit: e })} data-expense={e.title}>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold">{e.title}</span>
                      <span className="block text-xs text-muted-foreground">
                        {CATEGORY_LABEL[e.category as Category] ?? e.category} · {e.stage === "PAID" ? `paid by ${nameOf(e.paidByUserId)}` : e.stage === "COMMITTED" ? "approved, not yet paid" : "estimate"}
                      </span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="block font-display text-[18px] leading-tight">{formatMoney(e.amountMinor, e.currency)}</span>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${STAGE_STYLE[e.stage]}`}>{STAGE_WORD[e.stage]}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {data.settlements.length > 0 && (
          <section>
            <p className={label}>Settled so far</p>
            <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
              {data.settlements.map((s) => (
                <li key={s.id}>
                  {nameOf(s.fromUserId)} paid {nameOf(s.toUserId)} {formatMoney(s.amountMinor, s.currency)} · {s.method.toLowerCase()} · {new Date(s.settledAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                </li>
              ))}
            </ul>
          </section>
        )}
        {error && !sheet && <p className="text-sm text-danger">{error}</p>}
      </div>

      <button
        onClick={() => setSheet({ kind: "expense" })}
        className="absolute bottom-4 right-4 flex cursor-pointer items-center gap-2 rounded-full bg-accent px-5 py-3 text-sm font-semibold text-accent-foreground shadow-lg"
        data-add-expense
      >
        <Plus className="size-4" /> Add expense
      </button>

      {sheet && (
        <Sheet onClose={done}>
          {sheet.kind === "expense" && <ExpenseForm data={data} edit={sheet.edit} onDone={done} />}
          {sheet.kind === "settle" && <SettleForm data={data} s={sheet} nameOf={nameOf} onDone={done} />}
          {sheet.kind === "budget" && <BudgetForm data={data} onDone={done} />}
        </Sheet>
      )}
    </div>
  );
}

function Sheet({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="absolute inset-0 z-30 flex items-end bg-black/40" onClick={onClose}>
      <div className="max-h-[92%] w-full overflow-y-auto rounded-t-3xl bg-surface p-5 pb-8" onClick={(e) => e.stopPropagation()}>
        <button aria-label="Close" onClick={onClose} className="float-right cursor-pointer rounded-full p-1 text-muted-foreground">
          <X className="size-5" />
        </button>
        {children}
      </div>
    </div>
  );
}

function BudgetBars({ data }: { data: BudgetViewData }) {
  const b = data.budget;
  if (!b) return <p className="mt-2 text-sm text-muted-foreground">Optional. Set a total and Stay / Transport / Food / Activities limits to see how the plan is tracking.</p>;
  const planned = (cat?: string) => {
    let s = 0;
    for (const [c, rec] of Object.entries(data.byCategory)) if (!cat || c === cat) s += rec[b.currency] ?? 0;
    return s;
  };
  const rows: { name: string; used: number; cap: number | null }[] = [];
  if (b.totalMinor) rows.push({ name: "Total", used: planned(), cap: b.totalMinor });
  for (const c of CATEGORIES) if (b.categories[c]) rows.push({ name: CATEGORY_LABEL[c], used: planned(c), cap: b.categories[c] });
  const other = Object.keys(data.byCategory).filter((c) => !b.categories[c]);
  return (
    <div className="mt-2 space-y-3">
      {rows.map((r) => {
        const pct = r.cap ? Math.min(100, Math.round((r.used / r.cap) * 100)) : 0;
        return (
          <div key={r.name}>
            <div className="flex justify-between text-xs">
              <span className="font-semibold">{r.name}</span>
              <span className="text-muted-foreground">
                {formatMoney(r.used, b.currency)} of {formatMoney(r.cap ?? 0, b.currency)}
              </span>
            </div>
            <div className="mt-1 h-2 overflow-hidden rounded-full bg-surface-muted">
              <div className={`h-full rounded-full ${r.used > (r.cap ?? 0) ? "bg-danger" : "bg-accent"}`} style={{ width: `${pct}%` }} />
            </div>
          </div>
        );
      })}
      <p className="text-[11px] text-muted-foreground">Bars show committed + paid only; estimates aren&apos;t counted.{other.length ? ` Also spending on: ${other.map((c) => CATEGORY_LABEL[c as Category] ?? c).join(", ")}.` : ""}</p>
    </div>
  );
}

function ExpenseForm({ data, edit, onDone }: { data: BudgetViewData; edit?: ExpenseRow; onDone: () => void }) {
  const everyone = data.members.map((m) => m.id);
  const [title, setTitle] = useState(edit?.title ?? "");
  const [amount, setAmount] = useState(edit ? String(edit.amountMinor / 100) : "");
  const [currency, setCurrency] = useState(edit?.currency ?? data.budget?.currency ?? data.currencies[0] ?? "INR");
  const [category, setCategory] = useState<string>(edit?.category ?? "OTHER");
  const [stage, setStage] = useState(edit?.stage ?? "PAID");
  const [payer, setPayer] = useState<string>(edit?.paidByUserId ?? data.viewerId);
  const [method, setMethod] = useState<SplitMethod>((edit?.splitMethod as SplitMethod) ?? "EQUAL");
  const [selected, setSelected] = useState<string[]>(edit ? edit.participants.map((p) => p.userId) : everyone);
  const [values, setValues] = useState<Record<string, string>>(() => {
    const v: Record<string, string> = {};
    for (const p of edit?.participants ?? []) if (p.inputValue != null) v[p.userId] = String(edit?.splitMethod === "EXACT" ? p.inputValue / 100 : p.inputValue);
    return v;
  });
  const [date, setDate] = useState((edit ? new Date(edit.occurredAt) : new Date()).toISOString().slice(0, 10));
  const [err, setErr] = useState<string | null>(null);
  const [busy, start] = useTransition();

  const participants = method === "EQUAL" ? everyone : selected;
  const preview = useMemo(() => {
    const minor = Math.round(Number(amount) * 100);
    if (!Number.isFinite(minor) || minor <= 0) return null;
    return computeShares(
      method,
      minor,
      participants.map((id) => {
        const raw = Number(values[id]);
        return { userId: id, value: values[id] === undefined || values[id] === "" || !Number.isFinite(raw) ? undefined : method === "EXACT" ? Math.round(raw * 100) : raw };
      })
    );
  }, [amount, method, participants, values]);

  const body = (): ExpenseInput => ({
    title,
    amount,
    currency,
    category,
    stage: stage as ExpenseInput["stage"],
    paidByUserId: stage === "PAID" ? payer : null,
    splitMethod: method,
    participants: participants.map((userId) => ({ userId, value: values[userId] })),
    occurredOn: date,
  });

  const submit = () =>
    start(async () => {
      const r = edit && edit.status === "ACTIVE" ? await updateExpenseAction(data.tripId, edit.id, body()) : edit ? await (async () => {
        const u = await updateExpenseAction(data.tripId, edit.id, body());
        return u.ok ? confirmExpenseAction(edit.id, undefined, stage === "PAID" ? payer : undefined) : u;
      })() : await addExpenseAction(data.tripId, body());
      if (!r.ok) setErr(r.error);
      else onDone();
    });

  const needsValue = method === "EXACT" || method === "PERCENT" || method === "SHARES";
  return (
    <div className="space-y-4">
      <h2 className="font-display text-xl">{edit ? "Edit expense" : "Add expense"}</h2>
      <div>
        <p className={label}>What was it?</p>
        <input className={`${input} mt-1`} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Dinner at the rooftop place" />
      </div>
      <div className="grid grid-cols-[1fr_96px] gap-2">
        <div>
          <p className={label}>Amount</p>
          <input className={`${input} mt-1`} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="6000" />
        </div>
        <div>
          <p className={label}>Currency</p>
          <input className={`${input} mt-1 uppercase`} maxLength={3} value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} />
        </div>
      </div>
      <div>
        <p className={label}>Money type</p>
        <div className="mt-1 grid grid-cols-3 gap-2">
          {["PAID", "COMMITTED", "ESTIMATED"].map((s) => (
            <button key={s} type="button" onClick={() => setStage(s)} className={`cursor-pointer rounded-xl border px-2 py-2 text-xs font-semibold ${stage === s ? "border-accent bg-accent-tint" : "border-border"}`}>
              {STAGE_WORD[s]}
            </button>
          ))}
        </div>
        <p className="mt-1 text-[11px] text-muted-foreground">Only Paid counts toward who owes whom.</p>
      </div>
      {stage === "PAID" && (
        <div>
          <p className={label}>Who paid?</p>
          <select className={`${input} mt-1`} value={payer} onChange={(e) => setPayer(e.target.value)}>
            {data.members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
                {m.id === data.viewerId ? " (you)" : ""}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <p className={label}>Category</p>
          <select className={`${input} mt-1`} value={category} onChange={(e) => setCategory(e.target.value)}>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>
            ))}
          </select>
        </div>
        <div>
          <p className={label}>Date</p>
          <input type="date" className={`${input} mt-1`} value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
      </div>
      <div>
        <p className={label}>Split</p>
        <div className="mt-1 flex gap-1.5">
          {METHODS.map((m) => (
            <button key={m.id} type="button" onClick={() => setMethod(m.id)} className={`flex-1 cursor-pointer rounded-full border px-2 py-1.5 text-xs font-semibold ${method === m.id ? "border-accent bg-accent-tint" : "border-border"}`}>
              {m.label}
            </button>
          ))}
        </div>
        <ul className="mt-2 space-y-1.5">
          {data.members.map((m) => {
            const on = participants.includes(m.id);
            const share = preview && preview.ok ? preview.shares.find((s) => s.userId === m.id)?.shareMinor : undefined;
            return (
              <li key={m.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={on}
                  disabled={method === "EQUAL"}
                  onChange={() => setSelected((cur) => (cur.includes(m.id) ? cur.filter((x) => x !== m.id) : [...cur, m.id]))}
                  className="size-4 accent-[var(--accent)]"
                />
                <span className="flex-1">{m.name}</span>
                {needsValue && on && (
                  <input
                    className="w-20 rounded-lg border border-border px-2 py-1 text-right text-sm"
                    inputMode="decimal"
                    value={values[m.id] ?? ""}
                    placeholder={method === "EXACT" ? "amt" : method === "PERCENT" ? "%" : "1"}
                    onChange={(e) => setValues((v) => ({ ...v, [m.id]: e.target.value }))}
                  />
                )}
                <span className="w-20 text-right text-xs text-muted-foreground">{on && share != null ? formatMoney(share, currency) : ""}</span>
              </li>
            );
          })}
        </ul>
        {preview && !preview.ok && <p className="mt-2 text-xs text-danger">{preview.error}</p>}
      </div>
      {err && <p className="text-sm text-danger">{err}</p>}
      <div className="flex gap-2">
        <button disabled={busy || !(preview?.ok ?? false) || !title.trim()} onClick={submit} className="flex-1 cursor-pointer rounded-full bg-accent py-3 text-sm font-semibold text-accent-foreground disabled:opacity-50">
          {busy ? "Saving…" : edit?.status === "PROPOSED" ? "Save & add" : edit ? "Save changes" : "Add expense"}
        </button>
        {edit && edit.status === "ACTIVE" && (
          <button
            disabled={busy}
            onClick={() => start(async () => { await voidExpenseAction(edit.id); onDone(); })}
            className="cursor-pointer rounded-full border border-border px-4 py-3 text-sm font-semibold"
          >
            Remove
          </button>
        )}
      </div>
    </div>
  );
}

function SettleForm({ data, s, nameOf, onDone }: { data: BudgetViewData; s: { from: string; to: string; amount: number; currency: string }; nameOf: (id: string | null) => string; onDone: () => void }) {
  const [amount, setAmount] = useState(String(s.amount / 100));
  const [method, setMethod] = useState("UPI");
  const [err, setErr] = useState<string | null>(null);
  const [busy, start] = useTransition();
  return (
    <div className="space-y-4">
      <h2 className="font-display text-xl">Mark as settled</h2>
      <p className="text-sm">
        {nameOf(s.from)} paid {nameOf(s.to)}. This records what already happened — Clockwise doesn&apos;t move money.
      </p>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <p className={label}>Amount ({s.currency})</p>
          <input className={`${input} mt-1`} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </div>
        <div>
          <p className={label}>How</p>
          <select className={`${input} mt-1`} value={method} onChange={(e) => setMethod(e.target.value)}>
            {["UPI", "CASH", "BANK", "OTHER"].map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
        </div>
      </div>
      {err && <p className="text-sm text-danger">{err}</p>}
      <button
        disabled={busy}
        onClick={() => start(async () => { const r = await settleAction(data.tripId, { fromUserId: s.from, toUserId: s.to, amount, currency: s.currency, method }); if (!r.ok) setErr(r.error); else onDone(); })}
        className="w-full cursor-pointer rounded-full bg-accent py-3 text-sm font-semibold text-accent-foreground disabled:opacity-50"
      >
        {busy ? "Recording…" : "Record settlement"}
      </button>
    </div>
  );
}

function BudgetForm({ data, onDone }: { data: BudgetViewData; onDone: () => void }) {
  const [currency, setCurrency] = useState(data.budget?.currency ?? data.currencies[0] ?? "INR");
  const [total, setTotal] = useState(data.budget?.totalMinor ? String(data.budget.totalMinor / 100) : "");
  const [cats, setCats] = useState<Record<string, string>>(() => Object.fromEntries(Object.entries(data.budget?.categories ?? {}).map(([k, v]) => [k, String(v / 100)])));
  const [err, setErr] = useState<string | null>(null);
  const [busy, start] = useTransition();
  return (
    <div className="space-y-4">
      <h2 className="font-display text-xl">Group budget</h2>
      <p className="text-xs text-muted-foreground">Shared with the whole group. Private budgets you mention to Clockwise never show up here.</p>
      <div className="grid grid-cols-[1fr_96px] gap-2">
        <div>
          <p className={label}>Total</p>
          <input className={`${input} mt-1`} inputMode="decimal" value={total} onChange={(e) => setTotal(e.target.value)} placeholder="optional" />
        </div>
        <div>
          <p className={label}>Currency</p>
          <input className={`${input} mt-1 uppercase`} maxLength={3} value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} />
        </div>
      </div>
      {CATEGORIES.map((c) => (
        <div key={c} className="flex items-center gap-3">
          <span className="w-24 text-sm">{CATEGORY_LABEL[c]}</span>
          <input className={input} inputMode="decimal" value={cats[c] ?? ""} placeholder="optional" onChange={(e) => setCats((v) => ({ ...v, [c]: e.target.value }))} />
        </div>
      ))}
      {err && <p className="text-sm text-danger">{err}</p>}
      <button
        disabled={busy}
        onClick={() => start(async () => { const r = await saveBudgetAction(data.tripId, { currency, total, categories: cats as Partial<Record<Category, string>> }); if (!r.ok) setErr(r.error); else onDone(); })}
        className="w-full cursor-pointer rounded-full bg-accent py-3 text-sm font-semibold text-accent-foreground disabled:opacity-50"
      >
        {busy ? "Saving…" : "Save budget"}
      </button>
    </div>
  );
}
