"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { toggleChecklistAction } from "@/app/traveller-actions";
import type { ReadyItem } from "@/lib/traveller/ready";

const KIND: Record<ReadyItem["kind"], { label: string; cls: string }> = {
  CONFIRMED: { label: "Confirmed", cls: "bg-success-tint text-success" },
  LIKELY: { label: "Likely needed", cls: "bg-pop-yellow-tint text-foreground" },
  OPTIONAL: { label: "Optional", cls: "bg-surface-muted text-muted-foreground" },
};

export function ReadyList({ tripId, items }: { tripId: string; items: ReadyItem[] }) {
  const [done, setDone] = useState<Record<string, boolean>>(Object.fromEntries(items.map((i) => [i.key, i.done])));
  const [, start] = useTransition();
  return (
    <ul className="space-y-2">
      {items.map((it) => (
        <li key={it.key} className="rounded-xl border border-border p-3" data-ready-item={it.key}>
          <div className="flex items-start gap-3">
            {it.auto ? (
              <span className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] ${done[it.key] ? "bg-success text-white" : "border border-border"}`}>{done[it.key] ? "✓" : ""}</span>
            ) : (
              <input
                type="checkbox"
                checked={Boolean(done[it.key])}
                onChange={(e) => {
                  setDone((d) => ({ ...d, [it.key]: e.target.checked }));
                  start(() => toggleChecklistAction(tripId, it.key, e.target.checked));
                }}
                className="mt-0.5 size-5 shrink-0 accent-[var(--accent)]"
              />
            )}
            <div className="min-w-0 flex-1">
              <p className={`text-sm font-semibold ${done[it.key] && !it.auto ? "text-muted-foreground line-through" : ""}`}>{it.label}</p>
              {it.detail && <p className="text-xs text-muted-foreground">{it.detail}</p>}
              {it.source && <p className="text-[11px] text-muted-foreground">{it.source}</p>}
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${KIND[it.kind].cls}`}>{KIND[it.kind].label}</span>
                {it.href && !done[it.key] && (
                  <Link href={it.href} className="text-xs font-semibold text-accent underline-offset-2 hover:underline">
                    Do this →
                  </Link>
                )}
                {it.nearby && !done[it.key] && (
                  <Link href={`/trips/${tripId}/agent/around?cat=${it.nearby}`} className="text-xs font-semibold text-accent underline-offset-2 hover:underline">
                    Show around me →
                  </Link>
                )}
              </div>
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}
