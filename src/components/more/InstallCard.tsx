"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { Smartphone } from "lucide-react";
import { trackClientEventAction } from "@/app/analytics-actions";

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };
type Mode = "installed" | "promptable" | "ios" | "other";

// Install Clockwise as an app. Android Chrome gives a real install prompt (beforeinstallprompt); iPhone has no
// prompt API, so we say how to do it by hand. Nothing is claimed that the browser hasn't told us.
export function InstallCard({ tripId }: { tripId: string }) {
  const [evt, setEvt] = useState<InstallEvent | null>(null);
  // What this browser already is: installed (standalone window), iPhone, or something else. Server render says "other".
  const base = useSyncExternalStore<Mode>(
    () => () => undefined,
    () => {
      const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
      return standalone ? "installed" : /iphone|ipad|ipod/i.test(navigator.userAgent) ? "ios" : "other";
    },
    () => "other"
  );
  const mode: Mode = base === "other" && evt ? "promptable" : base;

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setEvt(e as InstallEvent);
      void trackClientEventAction("pwa_install_prompted", tripId).catch(() => undefined);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, [tripId]);

  async function install() {
    if (!evt) return;
    await evt.prompt();
    const choice = await evt.userChoice;
    if (choice.outcome === "accepted") void trackClientEventAction("pwa_install_accepted", tripId).catch(() => undefined);
    setEvt(null);
  }

  return (
    <section className="rounded-[18px] border border-border bg-surface px-4 py-4" data-install-card>
      <p className="eyebrow flex items-center gap-1.5"><Smartphone className="size-3.5" /> Install</p>
      <p className="mt-2 text-[14.5px] leading-snug">
        {mode === "installed" && "Clockwise is installed on this device."}
        {mode === "promptable" && "Add Clockwise to your home screen so delay alerts open like an app."}
        {mode === "ios" && "On iPhone: tap the Share button in Safari, then Add to Home Screen."}
        {mode === "other" && "On Android, open this page in Chrome, then use the browser menu → Install app. On desktop Chrome, use the install icon in the address bar."}
      </p>
      {mode === "promptable" && <button type="button" onClick={install} className="btn btn-primary mt-3" data-install-button>Install Clockwise</button>}
    </section>
  );
}
