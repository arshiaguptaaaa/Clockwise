"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell } from "lucide-react";

type Item = {
  id: string;
  severity: string;
  title: string;
  body: string;
  href: string | null;
  readAt: string | null;
  createdAt: string;
};
type PushState = { configured: boolean; publicKey: string | null; subscribed: boolean };

const POLL_MS = 30_000;
const PUSH_DISMISSED_KEY = "clockwise.pushPrompt.dismissed";

function urlBase64ToUint8Array(base64: string) {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

function ago(iso: string) {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  if (m < 60 * 24) return `${Math.round(m / 60)}h ago`;
  return `${Math.round(m / 60 / 24)}d ago`;
}

export function NotificationBell({ tripId }: { tripId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Item[]>([]);
  const [unread, setUnread] = useState(0);
  const [push, setPush] = useState<PushState | null>(null);
  const [pushDismissed, setPushDismissed] = useState(() => {
    if (typeof window === "undefined") return true;
    try {
      return localStorage.getItem(PUSH_DISMISSED_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [pushMsg, setPushMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/notifications?tripId=${tripId}`, { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      setItems(data.items);
      setUnread(data.unread);
      setPush(data.push);
    } catch {
      // transient network failure — the next poll will retry
    }
  }, [tripId]);

  useEffect(() => {
    const first = setTimeout(load, 0);
    const t = setInterval(load, POLL_MS);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [load]);

  async function openItem(item: Item) {
    setOpen(false);
    if (!item.readAt) {
      setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, readAt: new Date().toISOString() } : i)));
      setUnread((u) => Math.max(0, u - 1));
      void fetch("/api/notifications", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "read", id: item.id }) });
    }
    if (item.href) router.push(item.href);
  }

  async function markAll() {
    setItems((prev) => prev.map((i) => ({ ...i, readAt: i.readAt ?? new Date().toISOString() })));
    setUnread(0);
    await fetch("/api/notifications", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "readAll", tripId }) });
  }

  // Only ever runs from the explicit "Turn on" tap below.
  async function enablePush() {
    setPushMsg(null);
    try {
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !push?.publicKey) {
        setPushMsg("This browser can't receive push alerts.");
        return;
      }
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setPushMsg("Notifications are blocked in this browser, so alerts stay in-app.");
        return;
      }
      const reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(push.publicKey) }));
      const res = await fetch("/api/notifications/subscribe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "subscribe", subscription: sub.toJSON() }) });
      if (!res.ok) throw new Error("subscribe failed");
      setPush({ ...push, subscribed: true });
      setPushMsg("Done — important alerts will reach you even when Clockwise is closed.");
    } catch {
      setPushMsg("Couldn't turn on push alerts on this device.");
    }
  }

  function dismissPush() {
    setPushDismissed(true);
    try {
      localStorage.setItem(PUSH_DISMISSED_KEY, "1");
    } catch {
      // per-viewer convenience only
    }
  }

  const showPushPrompt = push?.configured && !push.subscribed && !pushDismissed;

  return (
    <div className="relative">
      <button
        type="button"
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
        onClick={() => {
          setOpen((v) => !v);
          void load();
        }}
        className="relative cursor-pointer rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground"
      >
        <Bell className="size-5" />
        {unread > 0 && (
          <span
            data-testid="notification-unread"
            className="absolute -right-0.5 -top-0.5 flex min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-semibold leading-4 text-accent-foreground"
          >
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-10 z-20 w-80 max-w-[calc(100vw-2rem)] rounded-xl border border-border bg-surface shadow-lg">
            <div className="flex items-center justify-between border-b border-border px-3.5 py-2.5">
              <p className="text-sm font-semibold text-foreground">Notifications</p>
              {unread > 0 && (
                <button type="button" onClick={markAll} className="cursor-pointer text-xs font-medium text-accent hover:underline">
                  Mark all read
                </button>
              )}
            </div>

            {showPushPrompt && (
              <div className="border-b border-border bg-surface-muted px-3.5 py-3">
                <p className="text-xs font-medium text-foreground">Get important trip alerts even when Clockwise isn&apos;t open?</p>
                <div className="mt-2 flex gap-2">
                  <button type="button" onClick={dismissPush} className="cursor-pointer rounded-full border border-border px-3 py-1 text-xs font-medium text-muted-foreground hover:text-foreground">
                    Not now
                  </button>
                  <button type="button" onClick={enablePush} className="cursor-pointer rounded-full bg-accent px-3 py-1 text-xs font-medium text-accent-foreground">
                    Turn on
                  </button>
                </div>
              </div>
            )}
            {pushMsg && <p className="border-b border-border px-3.5 py-2 text-xs text-muted-foreground">{pushMsg}</p>}

            <div className="max-h-96 overflow-y-auto">
              {items.length === 0 ? (
                <p className="px-3.5 py-6 text-center text-xs text-muted-foreground">Nothing yet. Alerts about your trip show up here.</p>
              ) : (
                items.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => openItem(item)}
                    className="flex w-full cursor-pointer items-start gap-2.5 border-b border-border px-3.5 py-2.5 text-left last:border-b-0 hover:bg-surface-muted"
                  >
                    <span className={`mt-1.5 size-2 shrink-0 rounded-full ${item.readAt ? "bg-transparent" : "bg-accent"}`} />
                    <span className="min-w-0 flex-1">
                      <span className={`block text-sm text-foreground ${item.readAt ? "font-normal" : "font-semibold"}`}>{item.title}</span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">{item.body}</span>
                      <span className="mt-1 block text-[11px] text-muted-foreground">{ago(item.createdAt)}</span>
                    </span>
                  </button>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
