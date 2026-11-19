// 🔔 Yakimma's notifications on your phone or laptop (see "Device notifications" in public/app.js). The browser keeps
// this running even when Yakimma is closed: the server sends each new notification here (see "Notifications on your
// phone or laptop" in server.js) and it pops up. Tapping it opens the page it's about.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));

self.addEventListener("push", e => {
  const n = e.data ? e.data.json() : {};
  e.waitUntil(self.clients.matchAll({ type: "window" }).then(windows => {
    // You're looking at Yakimma right now, so 🔔 there is enough.
    if (windows.some(w => w.focused)) return;
    return self.registration.showNotification(n.title || "Yakimma", { body: n.body || "", tag: n.tag, icon: "/badges/pastel-yakimma-cat.jpg", data: { url: n.url || "/" } });
  }));
});

self.addEventListener("notificationclick", e => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || "/", self.location.origin).href;
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async windows => {
    const open = windows.find(w => new URL(w.url).origin === self.location.origin);
    if (open) {
      try { return await (await open.navigate(url) || open).focus(); } catch {}
    }
    return self.clients.openWindow(url);
  }));
});
