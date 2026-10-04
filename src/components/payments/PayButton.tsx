"use client";

import { useState, useTransition } from "react";
import { payObligationAction } from "@/app/payment-actions";

// PAY MY SHARE. The server opens THIS signed-in traveller's own Pine Labs link (it refuses anyone else's), and
// the browser goes to Pine's hosted checkout in the same tab, which is more reliable on a phone than a pop-up.
// A failure shows a plain sentence and TRY AGAIN: never a provider message.
export function PayButton({ obligationId, label, className = "" }: { obligationId: string; label: string; className?: string }) {
  const [pending, start] = useTransition();
  const [fail, setFail] = useState<{ title: string; body: string } | null>(null);

  const go = () =>
    start(async () => {
      setFail(null);
      const r = await payObligationAction(obligationId);
      if (r.ok) window.location.assign(r.url);
      else setFail({ title: r.title, body: r.body });
    });

  return (
    <div className={className}>
      {fail ? (
        <div className="rounded-xl border border-danger/40 bg-danger-tint px-3.5 py-3" data-pay-failed>
          <p className="eyebrow !text-danger">{fail.title}</p>
          <p className="mt-1 text-[13px]">{fail.body}</p>
          <button type="button" onClick={go} disabled={pending} className="mt-2 min-h-11 cursor-pointer rounded-full bg-accent px-6 text-[12px] font-semibold tracking-[0.12em] text-accent-foreground disabled:opacity-50">
            {pending ? "TRYING…" : "TRY AGAIN"}
          </button>
        </div>
      ) : (
        <button type="button" onClick={go} disabled={pending} data-pay className="min-h-11 w-full cursor-pointer rounded-full bg-accent px-6 text-[12.5px] font-semibold tracking-[0.12em] text-accent-foreground transition-opacity hover:opacity-90 disabled:opacity-60 sm:w-auto">
          {pending ? "OPENING SECURE CHECKOUT…" : label}
        </button>
      )}
    </div>
  );
}
