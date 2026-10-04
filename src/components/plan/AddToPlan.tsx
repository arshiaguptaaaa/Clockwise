"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { DateTimeField, resolvedMoment } from "@/components/DatePicker";
import { addCommitmentAction } from "@/app/plan-actions";

// "+ ADD TO THE PLAN": a name, an exact day and time from the calendar, and where. The resolved moment is
// shown back in words before anything is saved.
export function AddToPlan({ tripId }: { tripId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [when, setWhen] = useState("");
  const [place, setPlace] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} data-add-plan className="mt-5 min-h-11 cursor-pointer rounded-full border border-foreground/25 px-5 text-[12px] font-semibold tracking-[0.12em] hover:border-foreground">
        + ADD TO THE PLAN
      </button>
    );
  }
  return (
    <div className="mt-5 space-y-4 border-l-2 border-accent pl-4" data-add-plan-form>
      <label className="block">
        <span className="eyebrow">What is it?</span>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Birthday dinner" maxLength={80} className="mt-1 min-h-12 w-full rounded-xl border border-border bg-surface px-4 text-[16px] focus:border-accent focus:outline-none" />
      </label>
      <DateTimeField label="When" value={when} onChange={setWhen} />
      <label className="block">
        <span className="eyebrow">Where (optional)</span>
        <input value={place} onChange={(e) => setPlace(e.target.value)} placeholder="Toit, Indiranagar" maxLength={120} className="mt-1 min-h-12 w-full rounded-xl border border-border bg-surface px-4 text-[16px] focus:border-accent focus:outline-none" />
      </label>
      {name.trim() && when && (
        <p className="font-display text-[20px] tracking-[-0.01em]" data-resolved-plan>
          {name.trim()} · {resolvedMoment(when)}
        </p>
      )}
      {err && <p className="text-sm text-danger">{err}</p>}
      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={pending || !name.trim() || !when}
          onClick={() =>
            start(async () => {
              const r = await addCommitmentAction(tripId, { name, local: when, location: place });
              if (!r.ok) return setErr(r.error);
              setOpen(false);
              setName("");
              setWhen("");
              setPlace("");
              setErr(null);
              router.refresh();
            })
          }
          className="min-h-12 cursor-pointer rounded-full bg-accent px-7 text-[12.5px] font-semibold tracking-[0.12em] text-accent-foreground disabled:opacity-50"
        >
          {pending ? "ADDING…" : "ADD IT"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="min-h-11 cursor-pointer text-[13px] text-muted-foreground">
          Cancel
        </button>
      </div>
    </div>
  );
}
