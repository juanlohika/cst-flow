/* ARIMA Service Worker — handles Web Push events for CST OS.
 * Lives at /arima-sw.js so the scope covers the whole app.
 */

self.addEventListener("install", (event) => {
  // Activate immediately so we don't wait for a tab refresh
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  if (!event.data) return;

  let payload = {};
  try {
    payload = event.data.json();
  } catch {
    payload = { title: "ARIMA", body: event.data.text() };
  }

  const title = payload.title || "ARIMA";
  const body = payload.body || "";
  const link = payload.link || "/arima";
  const type = payload.type || "general";

  const options = {
    body,
    icon: "/tarkie-logo.svg",
    badge: "/tarkie-logo.svg",
    data: { link, type },
    tag: type,            // collapses duplicate notifications of the same type
    renotify: false,
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const link = event.notification.data?.link || "/arima";

  event.waitUntil((async () => {
    const allClients = await self.clients.matchAll({
      type: "window",
      includeUncontrolled: true,
    });

    // If a CST OS tab is already open, focus it and navigate
    for (const client of allClients) {
      if (client.url.includes(self.location.origin)) {
        client.focus();
        if ("navigate" in client) {
          try { await client.navigate(link); } catch {}
        }
        return;
      }
    }

    // Otherwise open a fresh window
    await self.clients.openWindow(link);
  })());
});
