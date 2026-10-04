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
      <p className={`eyebrow ${settled ? "!text-success" : "!text-accent-strong"}`}>{settled ? "◷ Everyone's settled ✓" : "◷ Payment's ready"}</p>
      <p className="mt-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-foreground">{c.title}</p>
      <p className="mt-0.5 font-display text-[34px] leading-[1.02] tracking-[-0.02em]">{inr(c.totalMinor, c.currency)}</p>

      <ul className="mt-3 space-y-2">
        {c.lines.map((l) => (
          <li key={l.userId} className="flex items-center gap-2.5 text-[14px]" data-line={firstName(l.name)}>
            <PersonFace userId={l.userId} name={l.name} className={`size-7 ${l.paid ? "" : "opacity-60 grayscale"}`} />
            <span className="font-medium">{firstName(l.name)}{l.mine ? " (you)" : ""}</span>
            <span className={`ml-auto text-[13px] ${l.paid ? "font-semibold text-success" : "text-muted-foreground"}`}>
              {l.paid ? "✓ Paid" : `${inr(l.amountMinor, c.currency)} due`}
            </span>
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
