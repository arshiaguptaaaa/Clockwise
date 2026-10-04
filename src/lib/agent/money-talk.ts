// Money said in plain chat is never money moved. These answer a payment directive or a "I already paid her" from the
// confirmed ledger, name what is and isn't known, and create NOTHING: no expense, no settlement, no payment request.
import { prisma } from "@/lib/prisma";
import { loadBudget, createExpense } from "@/lib/budget/ledger";
import { postActionCard } from "@/lib/action-cards";
import { rupees } from "@/lib/private-tell";
import type { PayDirective, SelfReportedPayment, Owes } from "@/lib/reply-talk";

const first = (n: string) => n.trim().split(/\s+/)[0] ?? n;
const list = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

export type PayDirectiveOutcome = { reply: string; settlement?: { fromId: string; toId: string; fromName: string; toName: string; amountMinor: number; currency: string; basis: string[]; statedByUser: boolean } };

// "Pay her the remaining amount": resolve WHO (a name, or "her" when exactly one person is owed), the DIRECTION (the speaker
// owes them) and the AMOUNT (the confirmed ledger's, not a figure typed in chat). The result is a confirmation to RECORD that
// the speaker has paid; it creates no expense, and Clockwise moves no money.
export async function payDirectiveOutcome(tripId: string, speakerId: string, d: PayDirective): Promise<PayDirectiveOutcome> {
  const budget = await loadBudget(tripId, speakerId);
  const nameOf = new Map(budget.members.map((m) => [m.id, first(m.name)]));
  const transfers = budget.balances.flatMap((b) => b.transfers.map((t) => ({ from: t.fromUserId, to: t.toUserId, minor: t.amountMinor, currency: b.currency })));
  const owed = transfers.filter((t) => t.from === speakerId);
  const money = (minor: number, cur: string) => (cur === "INR" ? rupees(minor) : `${cur} ${(minor / 100).toFixed(2)}`);
  const pronoun = /^(her|him|them)$/i.test(d.recipientWord);
  const named = pronoun ? null : budget.members.find((m) => first(m.name).toLowerCase() === d.recipientWord.toLowerCase());
  const confirm = (to: string, minor: number, currency: string, statedByUser: boolean): PayDirectiveOutcome => {
    const basis = budget.expenses.filter((e) => e.paidByUserId === to && e.participants.some((p) => p.userId === speakerId)).map((e) => e.title).slice(0, 4);
    const ledger = owed.filter((o) => o.to === to).reduce((n, o) => n + o.minor, 0);
    const compare = statedByUser ? (ledger === minor ? ` That matches what confirmed expenses say you owe ${nameOf.get(to)}.` : ledger > 0 ? ` Confirmed expenses say you owe ${nameOf.get(to)} ${money(ledger, currency)}; you asked for ${money(minor, currency)}.` : ` Confirmed expenses don't show a debt to ${nameOf.get(to)}, so this is a payment you chose to make.`) : "";
    return {
      reply: `${statedByUser ? "" : `On confirmed expenses you owe ${nameOf.get(to)} ${money(minor, currency)}. `}You'd pay ${nameOf.get(to)} ${money(minor, currency)}: from ${nameOf.get(speakerId)} to ${nameOf.get(to)}, not split with anyone.${compare} Authorise it below and I'll create a Pine Labs UAT payment link. Creating the link is not the payment: it counts as paid only when Pine Labs confirms it.`,
      settlement: { fromId: speakerId, toId: to, fromName: nameOf.get(speakerId) ?? "You", toName: nameOf.get(to) ?? "them", amountMinor: minor, currency, basis, statedByUser },
    };
  };
  // An amount in the instruction wins; the direction is checked against the ledger so a payment never runs backwards.
  if (d.amountMinor && named) {
    if (named.id === speakerId) return { reply: "That's you, so there's nobody to pay." };
    const reverse = transfers.filter((t) => t.from === named.id && t.to === speakerId).reduce((n, t) => n + t.minor, 0);
    if (reverse > 0) return { reply: `On confirmed expenses ${first(named.name)} owes YOU ${money(reverse, "INR")}, not the other way round, so I haven't set up a payment from you. If you meant ${first(named.name)} to pay you, they can ask me to pay you.` };
    return confirm(named.id, d.amountMinor, "INR", true);
  }
  if (d.amountMinor && !named) {
    if (owed.length === 1) return confirm(owed[0].to, d.amountMinor, "INR", true);
    return { reply: `Who should be paid ${rupees(d.amountMinor)}? Name them and I'll set it up. Nothing has been created.` };
  }
  if (owed.length === 0) return { reply: `On confirmed expenses you don't owe anyone, so there's no remaining amount to pay. Expense cards that aren't confirmed yet don't count. I haven't created anything.` };
  if (named) {
    const rows = owed.filter((o) => o.to === named.id);
    if (rows.length === 0) return { reply: `On confirmed expenses you don't owe ${first(named.name)} anything. I haven't created anything.` };
    return confirm(named.id, rows.reduce((n, r) => n + r.minor, 0), rows[0].currency, false);
  }
  if (owed.length === 1) return confirm(owed[0].to, owed[0].minor, owed[0].currency, false);
  return { reply: `Who do you mean? On confirmed expenses you owe ${list(owed.map((o) => `${nameOf.get(o.to) ?? "someone"} ${money(o.minor, o.currency)}`))}. I haven't created anything.` };
}

export async function payDirectiveReply(tripId: string, speakerId: string, d: PayDirective): Promise<string> {
  return (await payDirectiveOutcome(tripId, speakerId, d)).reply;
}

export async function selfReportedReply(tripId: string, speakerId: string, r: SelfReportedPayment, messageId: string | null): Promise<string> {
  const members = await prisma.tripMember.findMany({ where: { tripId }, include: { user: { select: { id: true, name: true } } } });
  const named = /^(her|him|them)$/i.test(r.recipientWord) ? null : members.find((m) => first(m.user.name).toLowerCase() === r.recipientWord.toLowerCase());
  const who = named ? first(named.user.name) : "them";
  await prisma.tripEvent
    .create({
      data: {
        tripId,
        kind: "SETTLEMENT_REPORTED",
        scope: "GROUP",
        actorUserId: speakerId,
        subjectUserId: named?.userId ?? null,
        sourceChannel: "GROUP",
        sourceMessageId: messageId,
        confidence: "LOW",
        payload: JSON.stringify({ to: named ? first(named.user.name) : null, amountMinor: r.amountMinor, outsideClockwise: r.outside, confirmed: false, ledgerChanged: false, note: "A traveller's own report. Not a confirmed settlement; the ledger is untouched." }),
        propagation: "[]",
      },
    })
    .catch(() => undefined);
  return `Noted that you say you paid ${who}${r.amountMinor ? ` ${rupees(r.amountMinor)}` : ""}${r.outside ? " outside Clockwise" : ""}. That's your own report, not a confirmed settlement, so Budget still shows what it showed. It counts once it's recorded under Budget → Settle up; a payment through Pine Labs is confirmed by Pine Labs, not by what anyone says in chat.`;
}

// "Ridhima owes me ₹1,000." One person owes one person. It becomes a PROPOSED expense paid by the creditor and shared by the debtor
// ALONE, so the ledger can only ever say Ridhima -> Arshia ₹1,000: never ₹500 each, never a group split. Nothing is recorded as a debt
// until a person confirms the card.
export async function proposeDebt(tripId: string, speakerId: string, o: Owes, messageId: string | null): Promise<string> {
  const members = await prisma.tripMember.findMany({ where: { tripId }, include: { user: { select: { id: true, name: true } } } });
  const byWord = (w: string) => (/^(me|i)$/i.test(w) ? members.find((m) => m.userId === speakerId) : members.find((m) => first(m.user.name).toLowerCase() === w.toLowerCase()));
  const debtor = byWord(o.debtorWord);
  const creditor = byWord(o.creditorWord);
  if (!debtor || !creditor || debtor.userId === creditor.userId) return "I couldn't tell who owes whom there, so I haven't recorded anything.";
  const dup = await prisma.expense.findFirst({ where: { tripId, amountMinor: o.amountMinor, paidByUserId: creditor.userId, status: "PROPOSED", participants: { some: { userId: debtor.userId } }, createdAt: { gt: new Date(Date.now() - 2 * 3600_000) } }, select: { id: true } });
  if (dup) return `That one is already waiting for confirmation above.`;
  const d = first(debtor.user.name);
  const c = first(creditor.user.name);
  const created = await createExpense({
    tripId,
    actorUserId: speakerId,
    title: `${d} owes ${c}`,
    amountMinor: o.amountMinor,
    currency: "INR",
    stage: "PAID",
    status: "PROPOSED",
    paidByUserId: creditor.userId,
    source: "CHAT",
    sourceReferenceId: messageId,
    splitMethod: "EXACT",
    participants: [{ userId: debtor.userId, value: o.amountMinor }],
    idempotencyKey: messageId ? `owes:${messageId}:${o.amountMinor}` : null,
  });
  if (!created.ok) return created.error;
  if (created.duplicate) return "That was already caught from this message.";
  await postActionCard({
    tripId,
    channel: "GROUP",
    type: "DECISION",
    status: "PENDING",
    data: {
      title: "Clockwise caught that ✦",
      context: `${d} owes ${c} ${rupees(o.amountMinor)}. One person owes one person: it is not split. Nothing is recorded until it's confirmed.`,
      values: [{ label: "Who owes", value: d }, { label: "Owed to", value: c }, { label: "Amount", value: rupees(o.amountMinor) }],
      expenseId: created.expenseId,
      proposerId: speakerId,
      payerId: creditor.userId,
      debt: true,
    },
  });
  return `${d} owes ${c} ${rupees(o.amountMinor)}. I've put that to be confirmed: it's one debt, ${d} to ${c}, not a split.`;
}
