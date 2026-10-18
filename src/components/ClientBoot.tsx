"use client";

import { useEffect } from "react";
import { reportClientError } from "@/lib/report-client-error";
import { trackClientEventAction } from "@/app/analytics-actions";

// Mounted once in the root layout. Renders nothing. It (1) registers the service worker so the app is installable
// and has its offline page, (2) reports uncaught browser errors, and (3) logs the moment Android/Chrome says the app
// was installed.
export function ClientBoot() {
  useEffect(() => {
    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    }
    const onError = (e: ErrorEvent) => reportClientError({ message: e.message || "Uncaught error", stack: e.error?.stack });
    const onRejection = (e: PromiseRejectionEvent) => {
      const r = e.reason as { message?: string; stack?: string } | string | undefined;
      reportClientError({ message: typeof r === "string" ? r : r?.message || "Unhandled promise rejection", stack: typeof r === "string" ? undefined : r?.stack });
    };
    const onInstalled = () => void trackClientEventAction("pwa_installed").catch(() => undefined);
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);
  return null;
}
