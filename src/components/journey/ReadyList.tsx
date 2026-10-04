"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { toggleChecklistAction } from "@/app/traveller-actions";
import type { ReadyItem } from "@/lib/traveller/ready";

// BEFORE YOU GO. Two quiet lists, no boxes: what Clockwise already knows about your trip, and what you may want.
// "Get it nearby" only searches; it never claims a shop stocks anything.
export function ReadyList({ tripId, items }: { tripId: string; items: ReadyItem[] }) {
  const [done, setDone] = useState<Record<string, boolean>>(Object.fromEntries(items.map((i) => [i.key, i.done])));
  const [, start] = useTransition();
  const known = items.filter((i) => i.auto);
  const want = items.filter((i) => !i.auto);

  return (
    <>
      {known.length > 0 && (
        <section className="section" data-ready-known>
          <p className="eyebrow">Your trip</p>
          <ul className="row-rule mt-2">
            {known.map((it) => (
              <li key={it.key} className="flex items-start gap-3 py-3.5" data-ready-item={it.key}>
                <span aria-hidden className={`mt-1 flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] ${done[it.key] ? "bg-success text-white" : "border border-foreground/30"}`}>{done[it.key] ? "✓" : ""}</span>
                <div className="min-w-0 flex-1">
                  <p className="font-display text-[19px] leading-tight tracking-[-0.01em]">{it.label}</p>
                  {it.detail && <p className="mt-0.5 text-[13px] leading-snug text-muted-foreground">{it.detail}</p>}
                  {it.source && <p className="mt-0.5 text-[11px] text-muted-foreground">{it.source}</p>}
                  {it.href && !done[it.key] && (
                    <Link href={it.href} className="mt-1 inline-flex min-h-9 items-center text-[12px] font-semibold uppercase tracking-[0.12em] text-accent">
                      Do this →
                    </Link>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {want.length > 0 && (
        <section className="section" data-ready-want>
          <p className="eyebrow">You may want</p>
          <ul className="row-rule mt-2">
            {want.map((it) => (
              <li key={it.key} className="py-1" data-ready-item={it.key}>
                <label className="flex min-h-12 cursor-pointer items-start gap-3 py-2.5">
                  <input
                    type="checkbox"
                    checked={Boolean(done[it.key])}
                    onChange={(e) => {
                      setDone((d) => ({ ...d, [it.key]: e.target.checked }));
                      start(() => toggleChecklistAction(tripId, it.key, e.target.checked));
                    }}
                    className="mt-0.5 size-6 shrink-0 accent-[var(--accent)]"
                  />
                  <span className="min-w-0 flex-1">
                    <span className={`block font-display text-[19px] leading-tight tracking-[-0.01em] transition-colors ${done[it.key] ? "text-muted-foreground line-through" : ""}`}>{it.label}</span>
                    {it.detail && <span className="mt-0.5 block text-[13px] leading-snug text-muted-foreground">{it.detail}</span>}
                  </span>
                </label>
                {it.nearby && !done[it.key] && (
                  <Link href={`/trips/${tripId}/agent/around?cat=${it.nearby}`} className="mb-2 ml-9 inline-flex min-h-9 items-center text-[12px] font-semibold uppercase tracking-[0.12em] text-accent">
                    Get it nearby →
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
