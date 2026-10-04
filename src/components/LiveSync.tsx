"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

// Keeps a trip feeling multiplayer: while the tab is visible it asks the server whether
// anything changed (new message, vote, arrival, plan change) and, if so, refreshes the
// server-rendered screen in place. Client state (what you are typing, open sheets) is
// preserved by router.refresh(). Short polling, honestly named: not a websocket.
export function LiveSync({ tripId, intervalMs = 6000 }: { tripId: string; intervalMs?: number }) {
  const router = useRouter();
  const last = useRef<string | null>(null);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;

    async function tick() {
      if (stopped) return;
      if (document.visibilityState === "visible") {
        try {
          const res = await fetch(`/api/trips/${tripId}/live`, { cache: "no-store" });
          if (res.ok) {
            failures = 0;
            const { signature } = (await res.json()) as { signature: string };
            if (last.current !== null && last.current !== signature) {
              // Every open screen notices at the same instant; spread the refreshes out so a
              // single vote doesn't become a burst of simultaneous page renders.
              const jitter = Math.random() * 1800;
              last.current = signature;
              await new Promise((r) => setTimeout(r, jitter));
              if (!stopped) router.refresh();
            } else last.current = signature;
          } else failures += 1;
        } catch {
          failures += 1;
        }
      }
      if (!stopped) timer = setTimeout(tick, intervalMs * Math.min(1 + failures, 6) + Math.random() * 1500);
    }

    function onVisible() {
      if (document.visibilityState === "visible") {
        if (timer) clearTimeout(timer);
        void tick();
      }
    }
    document.addEventListener("visibilitychange", onVisible);
    void tick();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [tripId, intervalMs, router]);

  return null;
}
