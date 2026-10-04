"use client";

import { useState, useTransition } from "react";
import { fitCheckAction } from "@/app/traveller-actions";
import type { FitResult } from "@/lib/travel/fit";

type Ok = Extract<FitResult, { ok: true }>;
const t12 = (local: string) => {
  const [h, m] = local.slice(11, 16).split(":").map(Number);
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
};
const dayLabel = (local: string) => new Date(`${local.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });

// "Does this fit?" for one real place: the traveller's next commitment, Delhivery drive times there and
// back, and (where it can be checked) the area reachable in the time left. A verdict, a leave-by time,
// and the plain reason. A what-if (when the next plan is far off) is always labelled as one.
export function FitCheck({
  tripId,
  place,
  kind,
  anchor,
  me,
  onSave,
  saved,
}: {
  tripId: string;
  place: { name: string; lat: number; lng: number };
  kind: string;
  anchor: "me" | "stay" | "arrival" | "destination" | "anywhere";
  me?: { lat: number; lng: number; label?: string } | null;
  onSave?: () => void;
  saved?: boolean;
}) {
  const [r, setR] = useState<FitResult | null>(null);
  const [pending, start] = useTransition();

  const run = () =>
    start(async () => {
      setR(await fitCheckAction(tripId, { ...place, kind }, { anchor, me }));
    });

  if (!r) {
    return (
      <button type="button" onClick={run} disabled={pending} data-fit-button className="btn btn-ghost mt-3 !px-4 !text-[11.5px]">
        <span className="cw-mark">◷</span>
        {pending ? "Checking your clock…" : "Does this fit?"}
      </button>
    );
  }
  if (!r.ok) {
    return (
      <div className="vote-in mt-3" data-fit-error>
        <p className="font-display text-[18px] leading-snug">Couldn&apos;t work that out just now.</p>
        <button type="button" onClick={run} className="btn btn-ghost mt-2 !px-4 !text-[11.5px]">
          Retry
        </button>
      </div>
    );
  }
  const ok: Ok = r;
  const head = ok.verdict === "YES" ? "Yes. You have time." : ok.verdict === "TIGHT" ? "Tight, but it works." : ok.verdict === "NO" ? `Not before ${ok.commitment?.name.toLowerCase() ?? "your next plan"}.` : "Nothing to be late for.";
  const tone = ok.verdict === "YES" ? "text-success" : ok.verdict === "TIGHT" ? "text-foreground" : ok.verdict === "NO" ? "text-danger" : "text-muted-foreground";
  return (
    <div className="vote-in mt-4 border-l-2 border-accent pl-3.5" data-fit={ok.verdict}>
      <p className={`t-display text-[24px] ${tone}`}>{head}</p>
      <p className="mt-1.5 text-[13px] leading-snug">{ok.reason}</p>
      <ul className="mt-2 space-y-0.5 text-[12.5px] text-muted-foreground">
        {ok.toMin != null && (
          <li>
            {ok.toMin} min from {ok.originLabel}
            {ok.onMin != null && ok.verdict !== "NOTHING_AHEAD" ? ` · ${ok.onMin} min back` : ""}
          </li>
        )}
        {ok.verdict !== "NO" && ok.leaveByLocal && (
          <li>
            Leave by <span className="font-semibold text-foreground">{t12(ok.leaveByLocal)}</span>
          </li>
        )}
        {ok.commitment && (
          <li>
            {ok.commitment.name} at {t12(ok.commitment.targetLocal)}
          </li>
        )}
        {ok.reach.checked && (
          <li data-iso>
            {ok.reach.inside ? "Inside" : "Outside"} the {ok.reach.budgetMin}-minute reach from {ok.originLabel} (Delhivery IsoSuite)
          </li>
        )}
      </ul>
      {ok.whatIf && (
        <p className="mt-1.5 text-[11.5px] italic text-muted-foreground" data-whatif>
          What if you set off at {t12(ok.leaveLocal)} on {dayLabel(ok.leaveLocal)}. Your next plan is further away than that.
        </p>
      )}
      <div className="mt-2.5 flex items-center gap-3">
        {ok.verdict === "NO" && onSave && !saved && (
          <button type="button" onClick={onSave} className="cursor-pointer rounded-full border border-foreground/25 px-4 py-1.5 text-[11.5px] font-semibold tracking-[0.12em] hover:border-foreground">
            SAVE FOR TOMORROW
          </button>
        )}
        <button type="button" onClick={run} disabled={pending} className="cursor-pointer text-[11.5px] text-muted-foreground underline underline-offset-4 hover:text-foreground">
          Check again
        </button>
      </div>
      <details className="mt-1.5">
        <summary className="cursor-pointer text-[11px] text-muted-foreground">How this was worked out</summary>
        <ul className="mt-1 space-y-0.5 text-[11px] leading-snug text-muted-foreground">
          {ok.basis.map((b, i) => (
            <li key={i}>{b}</li>
          ))}
        </ul>
      </details>
    </div>
  );
}
