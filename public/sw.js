const CACHE_NAME = "tetamu-pos-static-v4";
const APP_ASSETS = [
  "/manifest.webmanifest",
  "/staff/manifest.webmanifest",
  "/pwa/icon-192.png",
  "/pwa/icon-512.png",
  "/pwa/icon-maskable-512.png",
  "/pwa/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") {
    return;
  }

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) {
    return;
  }

  // POS pages and APIs stay network-first so customer and payment data never goes stale.
  if (request.mode === "navigate" || url.pathname.startsWith("/api/")) {
    return;
  }

  // Next.js chunks must always come from the active deployment. Caching route chunks
  // can hydrate new server props with an older client component after an update.
  const cacheable =
    url.pathname.startsWith("/pwa/") ||
    url.pathname === "/manifest.webmanifest" ||
    url.pathname === "/staff/manifest.webmanifest";

  if (!cacheable) {
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) {
        return cached;
      }

      return fetch(request).then((response) => {
        if (response.ok) {
          const copy = response.clone();
          void caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      });
    }),
  );
});
