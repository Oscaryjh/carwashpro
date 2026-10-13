// The registration URL pins this worker to the build SHA supplied by the server.
const version = new URL(self.location.href).searchParams.get("v");
const CACHE_NAME = /^[a-f0-9]{40}$/i.test(version || "")
  ? `tetamu-pos-static-${version.toLowerCase()}`
  : null;
const APP_ASSETS = [
  "/manifest.webmanifest",
  "/staff/manifest.webmanifest",
  "/pwa/icon-192.png",
  "/pwa/icon-512.png",
  "/pwa/icon-maskable-512.png",
  "/pwa/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  if (!CACHE_NAME) return;
  event.waitUntil(caches.open(CACHE_NAME).then((cache) =>
    cache.addAll(APP_ASSETS.map((asset) => new Request(new URL(asset, self.location.origin), { cache: "reload" }))),
  ));
  // Updates wait until the user confirms. Never interrupt an in-progress form.
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  if (!CACHE_NAME) return;
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key.startsWith("tetamu-pos-static-") && key !== CACHE_NAME).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (!CACHE_NAME || request.method !== "GET") {
    return;
  }

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) {
    return;
  }

  // POS pages and APIs stay network-first so customer and payment data never goes stale.
  if (request.mode === "navigate" || url.pathname.startsWith("/api/") ||
      request.headers.has("RSC") || request.headers.has("Next-Action") ||
      url.searchParams.has("_rsc")) {
    return;
  }

  // Next.js chunks must always come from the active deployment. Caching route chunks
  // can hydrate new server props with an older client component after an update.
  const cacheable = !url.search && (
    (url.pathname.startsWith("/pwa/") && APP_ASSETS.includes(url.pathname)) ||
    url.pathname === "/manifest.webmanifest" ||
    url.pathname === "/staff/manifest.webmanifest"
  );

  if (!cacheable) {
    return;
  }

  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(request);
      if (cached) {
        return cached;
      }

      return fetch(request).then((response) => {
        if (response.ok) {
          const copy = response.clone();
          event.waitUntil(cache.put(request, copy));
        }
        return response;
      });
    }),
  );
});
