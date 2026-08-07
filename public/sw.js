// Service Worker: (1) macht die Seite als PWA installierbar, (2) empfängt Push-Nachrichten
// über Firebase Cloud Messaging – auch wenn die App geschlossen ist.

// Firebase Messaging (compat-Build für Service Worker).
importScripts("https://www.gstatic.com/firebasejs/11.6.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/11.6.0/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyDNGGeptGQ0DmPyH80Jaazp-poRwJgr0ac",
  authDomain: "wg-plan-a8a4d.firebaseapp.com",
  projectId: "wg-plan-a8a4d",
  messagingSenderId: "327458996781",
  appId: "1:327458996781:web:06ec823ba8bcbff4902ea4",
});

// Initialisiert den Push-Empfang. Nachrichten mit "notification"-Feld werden vom Browser
// automatisch angezeigt; hier zusätzlich ein Handler für saubere Darstellung + Klick-Ziel.
const messaging = firebase.messaging();
messaging.onBackgroundMessage((payload) => {
  const n = payload.notification || {};
  self.registration.showNotification(n.title || "WG-Plan", {
    body: n.body || "",
    icon: "/wg-plan/icon-192.png",
    badge: "/wg-plan/icon-192.png",
    data: { url: (payload.fcmOptions && payload.fcmOptions.link) || "/wg-plan/" },
  });
});

// Klick auf die Benachrichtigung öffnet die App.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/wg-plan/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if (c.url.includes("/wg-plan/") && "focus" in c) return c.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});

// PWA: bewusst kein Offline-Cache, damit nach Deploys immer die neueste Version geladen wird.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (event) => {
  if (event.request.mode === "navigate") {
    event.respondWith(fetch(event.request).catch(() => Response.error()));
  }
});
