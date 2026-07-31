// Minimaler Service Worker — macht die Seite installierbar (PWA), ohne Inhalte zu cachen.
// Bewusst KEIN Offline-Cache: so bekommt jeder nach einem Deploy immer sofort die
// neueste Version, ohne dass eine alte gecachte App hängen bleibt.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (event) => {
  // Navigationsanfragen über das Netz bedienen (immer frisch). Der catch verhindert
  // einen harten Fehler, falls mal offline — dann greift das normale Browser-Verhalten.
  if (event.request.mode === "navigate") {
    event.respondWith(fetch(event.request).catch(() => Response.error()));
  }
});
