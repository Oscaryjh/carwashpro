"use client";

import { useEffect } from "react";

export function PwaRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) {
      return;
    }

    // Development chunks change on every compile. A previously installed PWA
    // worker can otherwise keep an old CSS/JS response alive and make a newly
    // rendered page appear completely unstyled. Keep the PWA production-only
    // and clean up old local registrations left by earlier builds.
    if (process.env.NODE_ENV !== "production") {
      void navigator.serviceWorker
        .getRegistrations()
        .then((registrations) =>
          Promise.all(
            registrations
              .filter((registration) =>
                registration.scope.startsWith(window.location.origin),
              )
              .map((registration) => registration.unregister()),
          ),
        )
        .then(async () => {
          if (!("caches" in window)) {
            return;
          }

          const cacheNames = await window.caches.keys();
          await Promise.all(
            cacheNames
              .filter((cacheName) => cacheName.startsWith("tetamu-pos-static-"))
              .map((cacheName) => window.caches.delete(cacheName)),
          );
        })
        .catch((error) => {
          console.error(
            "Unable to clear the local TETAMU POS service worker.",
            error,
          );
        });
      return;
    }

    let reloadingForUpdate = false;
    function reloadForUpdatedWorker() {
      if (reloadingForUpdate) return;
      reloadingForUpdate = true;
      window.location.reload();
    }

    navigator.serviceWorker.addEventListener(
      "controllerchange",
      reloadForUpdatedWorker,
    );

    function registerServiceWorker() {
      void navigator.serviceWorker
        .register("/sw.js", { scope: "/", updateViaCache: "none" })
        .then((registration) => registration.update())
        .catch(() => undefined);
    }

    if (document.readyState === "complete") {
      registerServiceWorker();
    } else {
      window.addEventListener("load", registerServiceWorker, { once: true });
    }

    return () => {
      window.removeEventListener("load", registerServiceWorker);
      navigator.serviceWorker.removeEventListener(
        "controllerchange",
        reloadForUpdatedWorker,
      );
    };
  }, []);

  return null;
}
