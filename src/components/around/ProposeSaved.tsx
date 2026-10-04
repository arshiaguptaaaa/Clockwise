"use client";

import { useState, useTransition } from "react";
import { proposePlaceAction } from "@/app/traveller-actions";
import type { AroundPlace } from "@/lib/travel/around";

export function ProposeSaved({ tripId, place, kind }: { tripId: string; place: AroundPlace; kind: string }) {
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, start] = useTransition();
  return (
    <div className="mt-2">
      <button
        type="button"
        data-propose-to-group
        disabled={busy || done}
        onClick={() =>
          start(async () => {
            const r = await proposePlaceAction(tripId, place, kind);
            if (r.ok) setDone(true);
            else setErr(r.error ?? "Couldn't propose it.");
          })
        }
        className="btn btn-primary"
      >
        {done ? "PROPOSED TO THE GROUP" : "PROPOSE TO GROUP"}
      </button>
      {err && <p className="mt-1 text-xs text-danger">{err}</p>}
    </div>
  );
}
