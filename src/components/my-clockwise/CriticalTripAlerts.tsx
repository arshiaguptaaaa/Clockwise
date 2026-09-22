"use client";

import { useState, useTransition } from "react";
import { setVoiceEscalationOptIn } from "@/app/escalation-actions";

// Explicit, visible opt-in — never silently enrolled. See spec: "We'll
// only call for time-sensitive trip issues after normal reminders
// haven't worked."
export function CriticalTripAlerts({
  initialOptIn,
  initialPhone,
}: {
  initialOptIn: boolean;
  initialPhone: string | null;
}) {
  const [optIn, setOptIn] = useState(initialOptIn);
  const [phone, setPhone] = useState(initialPhone ?? "");
  const [, startTransition] = useTransition();

  function toggle() {
    const next = !optIn;
    setOptIn(next);
    startTransition(async () => {
      await setVoiceEscalationOptIn(next, phone || undefined);
    });
  }

  function savePhone() {
    startTransition(async () => {
      await setVoiceEscalationOptIn(optIn, phone || undefined);
    });
  }

  return (
    <div className="shrink-0 border-b border-border px-4 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        Critical trip alerts
      </p>
      <div className="mt-2 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">Allow Clockwise to call me</p>
          <p className="text-xs text-muted-foreground">
            We&apos;ll only call for time-sensitive trip issues after normal reminders haven&apos;t worked.
          </p>
        </div>
        <button
          type="button"
          onClick={toggle}
          aria-pressed={optIn}
          className={`shrink-0 cursor-pointer rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
            optIn
              ? "bg-accent text-accent-foreground"
              : "border border-border text-muted-foreground hover:border-accent hover:text-accent"
          }`}
        >
          {optIn ? "ON" : "OFF"}
        </button>
      </div>
      {optIn && (
        <input
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          onBlur={savePhone}
          placeholder="Phone, e.g. +919876543210"
          className="mt-2 w-full rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:border-accent focus:outline-none"
        />
      )}
    </div>
  );
}
