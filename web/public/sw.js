// Relive CRM service worker: shows push notifications and opens the right page when one is tapped.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("push", (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch { d = { title: "Relive CRM", body: event.data && event.data.text() }; }
  event.waitUntil(self.registration.showNotification(d.title || "Relive CRM", {
    body: d.body || "", icon: "/icon-192.png", badge: "/icon-192.png", data: { url: d.url || "/notifications" }, tag: d.lead_id || undefined,
  }));
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of all) { if ("focus" in c) { c.navigate(url); return c.focus(); } }
    return self.clients.openWindow(url);
  })());
});
