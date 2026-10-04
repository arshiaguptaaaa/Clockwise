import { PersonFace, firstName } from "@/components/decisions/People";
import { PayButton } from "./PayButton";
import type { CollectionView } from "@/lib/payments/obligations";

const inr = (minor: number, currency = "INR") => `${currency === "INR" ? "₹" : `${currency} `}${(minor / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

// PAYMENT'S READY: one shared card, live from the collection. Everyone sees who has paid and who still owes;
// each traveller's button is THEIR share only.
export function CollectionCard({ c }: { c: CollectionView }) {
  const settled = c.status === "SETTLED";
  const mine = c.lines.find((l) => l.mine && !l.paid);
  return (
    <div className={`tile-in w-full max-w-md border-l-[3px] py-4 pl-4 pr-3 sm:max-w-lg ${settled ? "border-success bg-success-tint/50" : "border-accent bg-surface-muted/60"}`} data-collection={c.title}>
      <p className={`eyebrow ${settled ? "!text-success" : "!text-accent-strong"}`}><span className="cw-mark">◷</span> {settled ? "Everyone's settled ✓" : "Payment's ready"}</p>
      <p className="mt-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-foreground">{c.title}</p>
      <p className="t-number mt-0.5 text-[44px]">{inr(c.totalMinor, c.currency)}</p>

      <ul className="mt-3 space-y-2">
        {c.lines.map((l) => (
          <li key={l.userId} className="flex items-center gap-2.5 text-[14px]" data-line={firstName(l.name)}>
            <PersonFace userId={l.userId} name={l.name} className={`size-8 transition-[filter,opacity] duration-300 ${l.paid ? "" : "opacity-60 grayscale"}`} />
            <span className="text-[11.5px] font-semibold uppercase tracking-[0.14em]">{l.mine ? "You" : firstName(l.name)}</span>
            <span className={`t-number ml-auto text-[20px] ${l.paid ? "text-success" : ""}`}>{inr(l.amountMinor, c.currency)}</span>
            <span className={`w-14 text-right text-[10.5px] font-semibold uppercase tracking-[0.12em] ${l.paid ? "text-success" : "text-muted-foreground"}`}>{l.paid ? "Paid ✓" : "Due"}</span>
          </li>
        ))}
      </ul>

      <p className="mt-3 border-t border-border pt-2 text-[13px]" data-collected>
        <span className="font-semibold">{inr(c.collectedMinor, c.currency)} / {inr(c.totalMinor, c.currency)} collected</span>
        <span className="text-muted-foreground"> · {c.paidCount} of {c.lines.length} paid</span>
      </p>
      {settled && <p className="mt-1 font-display text-[16px] italic text-muted-foreground">Everyone&apos;s settled.</p>}

      {mine?.obligationId && <PayButton obligationId={mine.obligationId} label={`PAY MY ${inr(mine.amountMinor, c.currency)}`} className="mt-3" />}
    </div>
  );
}
