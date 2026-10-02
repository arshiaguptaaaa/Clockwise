"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Consent = "NONE" | "SHARING" | "DECLINED" | "STOPPED";

const MIN_FIX_INTERVAL_MS = 30_000;

// Contextual, explicit opt-in. The browser's geolocation prompt is only ever
// triggered from the "Share live location" button below — never on load —
// and the card itself only renders when this traveller has a commitment
// coming up that location can actually help with.
export function LiveLocationCard({
  tripId,
  commitmentName,
  commitmentTimeLabel,
  initialConsent,
}: {
  tripId: string;
  commitmentName: string;
  commitmentTimeLabel: string;
  initialConsent: Consent;
}) {
  const [consent, setConsent] = useState<Consent>(initialConsent);
  const [message, setMessage] = useState<string | null>(null);
  const watchId = useRef<number | null>(null);
  const lastSent = useRef(0);
  const url = `/api/trips/${tripId}/location`;

  const post = useCallback(
    (body: Record<string, unknown>) =>
      fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    [url]
  );

  const stopWatching = useCallback(() => {
    if (watchId.current != null && typeof navigator !== "undefined" && navigator.geolocation) {
      navigator.geolocation.clearWatch(watchId.current);
    }
    watchId.current = null;
  }, []);

  // Returns false when the device has no geolocation; callers surface that.
  const startWatching = useCallback((): boolean => {
    if (!navigator.geolocation) return false;
    stopWatching();
    watchId.current = navigator.geolocation.watchPosition(
      (pos) => {
        const now = Date.now();
        if (now - lastSent.current < MIN_FIX_INTERVAL_MS) return;
        lastSent.current = now;
        void post({ action: "fix", latitude: pos.coords.latitude, longitude: pos.coords.longitude, accuracy: pos.coords.accuracy });
      },
      () => {
        stopWatching();
        setConsent("STOPPED");
        setMessage("Location permission wasn't granted, so sharing is off.");
        void post({ action: "stop" });
      },
      { enableHighAccuracy: false, maximumAge: 15_000 }
    );
    return true;
  }, [post, stopWatching]);

  // Resume only if the traveller had already turned sharing on.
  useEffect(() => {
    if (initialConsent === "SHARING") startWatching();
    return stopWatching;
  }, [initialConsent, startWatching, stopWatching]);

  async function share() {
    setMessage(null);
    await post({ action: "start" });
    setConsent("SHARING");
    if (!startWatching()) setMessage("This device can't share location.");
  }

  async function stop() {
    stopWatching();
    setConsent("STOPPED");
    await post({ action: "stop" });
  }

  async function notNow() {
    setConsent("DECLINED");
    await post({ action: "decline" });
  }

  if (consent === "DECLINED") return null;

  return (
    <div className="shrink-0 border-b border-border bg-surface-muted px-4 py-3" data-testid="live-location-card">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-accent">Clockwise Live</p>
      {consent === "SHARING" ? (
        <>
          <p className="mt-1 text-sm font-medium text-foreground">Sharing your live location</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Only while Clockwise is open. The group sees whether you&apos;re on track for {commitmentName} — never where you are.
          </p>
          <button
            type="button"
            onClick={stop}
            className="mt-2 cursor-pointer rounded-full border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:border-accent"
          >
            Stop sharing
          </button>
        </>
      ) : (
        <>
          <p className="mt-1 text-sm font-medium text-foreground">
            {commitmentName} · {commitmentTimeLabel}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Share your live location so I can tell the group if you&apos;re running late. They only ever see on track or at risk — never your position.
          </p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={notNow}
              className="cursor-pointer rounded-full border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              Not now
            </button>
            <button
              type="button"
              onClick={share}
              className="cursor-pointer rounded-full bg-accent px-3 py-1.5 text-xs font-medium text-accent-foreground"
            >
              Share live location
            </button>
          </div>
        </>
      )}
      {message && <p className="mt-2 text-xs text-muted-foreground">{message}</p>}
    </div>
  );
}
