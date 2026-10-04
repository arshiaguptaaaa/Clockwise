// Who owes what. Pure, deterministic integer arithmetic (paise). The agent only INTERPRETS a request into
// this input ("split equally", "500 from Eva and the rest between us", "Arshia already paid", "don't include
// Shreya"); every paisa is computed here, and the lines always sum to exactly the total.
import { PINE_MIN_MINOR } from "./amount";

export type OwePerson = { userId: string; name: string };
export type ObligationLine = { userId: string; name: string; amountMinor: number; alreadyPaid: boolean };
export type ObligationsResult = { ok: true; lines: ObligationLine[] } | { ok: false; error: string };

const rupees = (minor: number) => `₹${(minor / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

export function computeObligations(p: { totalMinor: number; people: OwePerson[]; fixed?: Record<string, number>; alreadyPaid?: string[] }): ObligationsResult {
  const { totalMinor } = p;
  if (!Number.isInteger(totalMinor) || totalMinor < PINE_MIN_MINOR) return { ok: false, error: `The total has to be at least ${rupees(PINE_MIN_MINOR)}.` };
  const people = p.people.filter((x, i, all) => all.findIndex((y) => y.userId === x.userId) === i);
  if (people.length === 0) return { ok: false, error: "Nobody is included in this payment." };
  const fixed = p.fixed ?? {};
  for (const id of Object.keys(fixed)) if (!people.some((x) => x.userId === id)) return { ok: false, error: "A fixed amount was given for someone who isn't part of this payment." };
  for (const v of Object.values(fixed)) if (!Number.isInteger(v) || v < 0) return { ok: false, error: "A fixed amount isn't valid." };

  const fixedSum = Object.values(fixed).reduce((a, b) => a + b, 0);
  const rest = totalMinor - fixedSum;
  if (rest < 0) return { ok: false, error: `The fixed amounts add up to ${rupees(fixedSum)}, which is more than the ${rupees(totalMinor)} total.` };
  const floating = people.filter((x) => fixed[x.userId] == null);
  if (floating.length === 0 && rest !== 0) return { ok: false, error: `Everyone has a fixed amount, but they add up to ${rupees(fixedSum)}, not ${rupees(totalMinor)}.` };

  // Equal share of what's left, with the leftover paise handed out one each in roster order.
  const base = floating.length ? Math.floor(rest / floating.length) : 0;
  let extra = floating.length ? rest - base * floating.length : 0;
  const lines: ObligationLine[] = people.map((x) => {
    let amount: number;
    if (fixed[x.userId] != null) amount = fixed[x.userId];
    else {
      amount = base + (extra > 0 ? 1 : 0);
      if (extra > 0) extra -= 1;
    }
    return { userId: x.userId, name: x.name, amountMinor: amount, alreadyPaid: (p.alreadyPaid ?? []).includes(x.userId) };
  });

  if (lines.reduce((s, l) => s + l.amountMinor, 0) !== totalMinor) return { ok: false, error: "The split doesn't add up to the total." };
  const tooSmall = lines.find((l) => !l.alreadyPaid && l.amountMinor > 0 && l.amountMinor < PINE_MIN_MINOR);
  if (tooSmall) return { ok: false, error: `${tooSmall.name.split(" ")[0]}'s share would be ${rupees(tooSmall.amountMinor)}, below the ${rupees(PINE_MIN_MINOR)} minimum for a payment.` };
  return { ok: true, lines: lines.filter((l) => l.amountMinor > 0) };
}
