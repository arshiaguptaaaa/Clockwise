"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { clashAction } from "@/app/clash-actions";

export type ClashView = {
  id: string;
  status: string;
  traveller: string;
  commitmentName: string;
  targetLabel: string;
  landsLabel: string;
  readyLabel: string;
  allowanceMin: number;
  routeMinutes: number;
  providerLabel: string;
  anchorLabel: string;
  suggestedLocal: string | null;
  suggestedLabel: string | null;
  options: { local: string; label: string }[];
  affected: string[];
};

// CLOCKWISE CAUGHT A CLASH. LANDS AT is not AVAILABLE AT: the card shows both, and the three numbers between them.
export function ClashCard({ clash, canCancel }: { clash: ClashView; canCancel: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [showOptions, setShowOptions] = useState(false);
  const live = clash.status === "OPEN" || clash.status === "INFORMED";

  function run(action: "PROPOSE" | "INFORM" | "CANCEL" | "LEAVE" | "LATER", local?: string) {
    setError(null);
    start(async () => {
      const r = await clashAction(clash.id, action, local);
      if (!r.ok) setError(r.reply);
      else router.refresh();
    });
  }

  if (clash.status === "SUPERSEDED") return null;
  if (clash.status === "RESOLVED") {
    return (
      <div className="border-l border-border py-1 pl-4 text-[12.5px] text-muted-foreground" data-clash-card data-clash-status={clash.status}>
        <span className="line-through decoration-[1px]">{clash.traveller} vs {clash.commitmentName}</span> — sorted ✓
      </div>
    );
  }

  return (
    <div className="vote-in w-full max-w-md border-l-[3px] border-danger bg-danger-tint/40 py-5 pl-4 pr-3 sm:max-w-lg" data-clash-card data-clash-status={clash.status}>
      <p className="eyebrow !text-danger"><span className="cw-mark !text-danger">◷</span> Clockwise caught a clash ✦</p>
      <p className="mt-2.5 font-display text-[24px] leading-[1.1] tracking-[-0.015em]">
        {clash.traveller} won&apos;t make the {clash.targetLabel} {clash.commitmentName}.
      </p>

      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[13.5px]" data-clash-math>
        <dt className="text-muted-foreground">Lands</dt>
        <dd className="font-semibold">{clash.landsLabel}</dd>
        <dt className="text-muted-foreground">Bags &amp; exits</dt>
        <dd>+ {clash.allowanceMin} min <span className="text-muted-foreground">(an assumption)</span></dd>
        <dt className="text-muted-foreground">To {clash.anchorLabel}</dt>
        <dd>+ {clash.routeMinutes} min <span className="text-muted-foreground">· {clash.providerLabel}</span></dd>
        <dt className="text-muted-foreground">Available at</dt>
        <dd className="font-semibold text-danger">≈ {clash.readyLabel}</dd>
      </dl>
      <p className="mt-1.5 text-[11.5px] text-muted-foreground">Lands at ≠ available at.</p>

      {clash.suggestedLabel ? (
        <p className="mt-3 text-[14.5px] leading-snug">I can move {clash.commitmentName} to <span className="font-semibold">{clash.suggestedLabel}</span>, which works for everyone I can measure. Should I propose that?</p>
      ) : (
        <p className="mt-3 text-[14.5px] leading-snug">I couldn&apos;t find a time that fits everyone&apos;s stated limits. What should I do?</p>
      )}

      {clash.status === "PROPOSED" && <p className="mt-3 text-[12.5px] font-medium">Proposed to {clash.affected.join(", ")} ✓ <span className="font-normal text-muted-foreground">· votes are in the card below. The Plan hasn&apos;t changed.</span></p>}
      {clash.status === "INFORMED" && <p className="mt-3 text-[12.5px] text-muted-foreground">{clash.affected.filter((n) => n !== clash.traveller).join(" and ")} {clash.affected.length > 2 ? "have" : "has"} been told. Nothing has moved.</p>}
      {clash.status === "LEFT" && <p className="mt-3 text-[12.5px] text-muted-foreground">Left as it is. It stays flagged on the Plan.</p>}
      {error && <p className="mt-2 text-[11px] text-danger">{error}</p>}

      {(live || clash.status === "LEFT") && (
        <div className="mt-3.5 flex flex-wrap gap-2">
          {clash.suggestedLabel && (
            <button type="button" disabled={pending} onClick={() => run("PROPOSE", clash.suggestedLocal ?? undefined)} className="btn btn-primary" data-clash-propose>
              {pending ? "Proposing…" : `Propose ${clash.suggestedLabel}`}
            </button>
          )}
          {clash.options.length > 0 && (
            <button type="button" disabled={pending} onClick={() => setShowOptions((v) => !v)} className="btn btn-ghost" data-clash-options>
              {clash.suggestedLabel ? "Other options" : "Find a later time"}
            </button>
          )}
          <button type="button" disabled={pending} onClick={() => run("INFORM")} className="btn btn-ghost" data-clash-inform>Inform {clash.affected.length > 2 ? "them" : "everyone"}</button>
          {canCancel && (
            <button type="button" disabled={pending} onClick={() => run("CANCEL")} className="btn btn-ghost" data-clash-cancel>Cancel {clash.commitmentName.toLowerCase()}</button>
          )}
          {clash.status !== "LEFT" && (
            <button type="button" disabled={pending} onClick={() => run("LEAVE")} className="btn btn-ghost" data-clash-leave>Leave it</button>
          )}
        </div>
      )}
      {showOptions && clash.options.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {clash.options.map((o) => (
            <button key={o.local} type="button" disabled={pending} onClick={() => run("PROPOSE", o.local)} className="btn btn-ghost">Propose {o.label}</button>
          ))}
        </div>
      )}
      <p className="mt-3 text-[11px] text-muted-foreground">Clockwise never moves or cancels a shared plan on its own.</p>
    </div>
  );
}
