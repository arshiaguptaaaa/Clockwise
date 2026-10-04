// Money said in plain chat is never money moved. These answer a payment directive or a "I already paid her" from the
// confirmed ledger, name what is and isn't known, and create NOTHING: no expense, no settlement, no payment request.
import { prisma } from "@/lib/prisma";
import { loadBudget } from "@/lib/budget/ledger";
import { rupees } from "@/lib/private-tell";
import type { PayDirective, SelfReportedPayment } from "@/lib/reply-talk";

const first = (n: string) => n.trim().split(/\s+/)[0] ?? n;
const list = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

export type PayDirectiveOutcome = { reply: string; settlement?: { fromId: string; toId: string; fromName: string; toName: string; amountMinor: number; currency: string; basis: string[] } };

// "Pay her the remaining amount": resolve WHO (a name, or "her" when exactly one person is owed), the DIRECTION (the speaker
// owes them) and the AMOUNT (the confirmed ledger's, not a figure typed in chat). The result is a confirmation to RECORD that
// the speaker has paid; it creates no expense, and Clockwise moves no money.
export async function payDirectiveOutcome(tripId: string, speakerId: string, d: PayDirective): Promise<PayDirectiveOutcome> {
  const budget = await loadBudget(tripId, speakerId);
  const nameOf = new Map(budget.members.map((m) => [m.id, first(m.name)]));
  const owed = budget.balances.flatMap((b) => b.transfers.filter((t) => t.fromUserId === speakerId).map((t) => ({ to: t.toUserId, minor: t.amountMinor, currency: b.currency })));
  const money = (minor: number, cur: string) => (cur === "INR" ? rupees(minor) : `${cur} ${(minor / 100).toFixed(2)}`);
  const pronoun = /^(her|him|them)$/i.test(d.recipientWord);
  const named = pronoun ? null : budget.members.find((m) => first(m.name).toLowerCase() === d.recipientWord.toLowerCase());
  const confirm = (to: string, minor: number, currency: string): PayDirectiveOutcome => {
    const basis = budget.expenses.filter((e) => e.paidByUserId === to && e.participants.some((p) => p.userId === speakerId)).map((e) => e.title).slice(0, 4);
    const said = d.amountMinor && d.amountMinor !== minor ? ` You said ${rupees(d.amountMinor)}; the confirmed expenses say ${money(minor, currency)}, so that is the amount below.` : "";
    return {
      reply: `On confirmed expenses you owe ${nameOf.get(to)} ${money(minor, currency)}.${said} Clockwise doesn't move money, so I haven't paid anyone or created an expense. Once you've actually paid ${nameOf.get(to)}, confirm below and I'll record it.`,
      settlement: { fromId: speakerId, toId: to, fromName: nameOf.get(speakerId) ?? "You", toName: nameOf.get(to) ?? "them", amountMinor: minor, currency, basis },
    };
  };
  if (owed.length === 0) return { reply: `On confirmed expenses you don't owe anyone, so there's no remaining amount to pay. Expense cards that aren't confirmed yet don't count. I haven't created anything.` };
  if (named) {
    const rows = owed.filter((o) => o.to === named.id);
    if (rows.length === 0) return { reply: `On confirmed expenses you don't owe ${first(named.name)} anything. I haven't created anything.` };
    return confirm(named.id, rows.reduce((n, r) => n + r.minor, 0), rows[0].currency);
  }
  if (owed.length === 1) return confirm(owed[0].to, owed[0].minor, owed[0].currency);
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
