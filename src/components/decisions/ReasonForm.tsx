"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { declineWithReasonAction } from "@/app/proposal-actions";

// "Tell Clockwise why": optional, private to Clockwise. The group learns that you can't
// make it - never your words - and Clockwise looks for another time that works.
export function ReasonForm({ proposalId, onDone, onCancel }: { proposalId: string; onDone: () => void; onCancel: () => void }) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!reason.trim()) return;
    setError(null);
    start(async () => {
      const r = await declineWithReasonAction(proposalId, reason);
      if (!r.ok) setError(r.error);
      else {
        onDone();
        router.refresh();
      }
    });
  }

  return (
    <form onSubmit={submit} className="mt-2">
      <input
        autoFocus
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        maxLength={200}
        placeholder="e.g. I have to leave by 10:30"
        className="w-full border-b border-foreground/30 bg-transparent py-1.5 text-[14px] outline-none placeholder:text-muted-foreground/70 focus:border-accent"
      />
      <p className="mt-1.5 text-[11.5px] text-muted-foreground">Only Clockwise sees this. The group is told you can&apos;t make it, not why.</p>
      <div className="mt-2 flex items-center gap-3">
        <button type="submit" disabled={pending || !reason.trim()} className="cursor-pointer rounded-full bg-accent px-4 py-1.5 text-[11.5px] font-semibold tracking-[0.12em] text-accent-foreground disabled:opacity-50">
          {pending ? "THINKING…" : "FIND ANOTHER TIME"}
        </button>
        <button type="button" onClick={onCancel} className="cursor-pointer text-[12px] text-muted-foreground hover:text-foreground">Cancel</button>
      </div>
      {error && <p className="mt-1.5 text-[11.5px] text-danger">{error}</p>}
    </form>
  );
}
