// Clockwise service worker: Web Push, notification clicks, and ONE offline page. It does not cache app pages or
// API calls, so it cannot serve stale trip data or interfere with Next.js routing: it only steps in when a page
// navigation fails because the device is offline.
const OFFLINE_CACHE = "clockwise-offline-v1";
self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(OFFLINE_CACHE).then((c) => c.add("/offline")).catch(() => undefined).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (event) =>
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== OFFLINE_CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  )
);
self.addEventListener("fetch", (event) => {
  if (event.request.mode !== "navigate") return;
  event.respondWith(fetch(event.request).catch(() => caches.match("/offline").then((r) => r || Response.error())));
});

self.addEventListener("push", (event) => {
  let data = { title: "Clockwise", body: "", href: "/" };
  try {
    data = { ...data, ...event.data.json() };
  } catch {
    // keep defaults
  }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: "/icons/192",
      badge: "/icons/192",
      data: { href: data.href },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const href = (event.notification.data && event.notification.data.href) || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ("focus" in c) {
          c.navigate(href);
          return c.focus();
        }
      }
      return self.clients.openWindow(href);
    })
  );
});
