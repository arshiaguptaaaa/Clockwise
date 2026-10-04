"use client";

export type ActiveItem = { key: string; domId: string; kind: "clash" | "proposal" | "payment" | "idea"; label: string };

const MARK: Record<ActiveItem["kind"], string> = { clash: "⚠", proposal: "◉", payment: "₹", idea: "✦" };
const TONE: Record<ActiveItem["kind"], string> = {
  clash: "border-danger/40 bg-danger-tint text-danger",
  proposal: "border-border bg-surface-muted text-foreground",
  payment: "border-border bg-tint-honey text-foreground",
  idea: "border-cw-line bg-cw-tint text-accent-strong",
};

// Whatever is still open in this trip - a clash, a proposal waiting on votes, money due, an idea - stays one tap away
// at the top of the Trip Room instead of scrolling off with the chat. Resolved items drop out (they stay in the chat
// and the Plan). Presentation only: it reads state the page already has.
export function ActiveStrip({ items }: { items: ActiveItem[] }) {
  if (items.length === 0) return null;
  return (
    <nav aria-label="Active in this trip" className="shrink-0 border-b border-border bg-surface px-4 py-2" data-active-strip>
      <div className="flex items-center gap-2">
        <span className="shrink-0 text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">Active</span>
        <div className="hscroll flex min-w-0 gap-1.5 overflow-x-auto">
          {items.map((i) => (
            <button
              key={i.key}
              type="button"
              onClick={() => document.getElementById(i.domId)?.scrollIntoView({ behavior: "smooth", block: "center" })}
              className={`flex min-h-9 shrink-0 cursor-pointer items-center gap-1.5 rounded-full border px-3 text-[12.5px] font-medium ${TONE[i.kind]}`}
              data-active-item={i.kind}
            >
              <span aria-hidden>{MARK[i.kind]}</span> {i.label}
            </button>
          ))}
        </div>
      </div>
    </nav>
  );
}
