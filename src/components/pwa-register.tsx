"use client";

import { useEffect } from "react";

export function PwaRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) {
      return;
    }

    function registerServiceWorker() {
      void navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch((error) => {
        if (process.env.NODE_ENV !== "production") {
          console.error("Unable to register the TETAMU POS service worker.", error);
        }
      });
    }

    if (document.readyState === "complete") {
      registerServiceWorker();
      return;
    }

    window.addEventListener("load", registerServiceWorker, { once: true });
    return () => window.removeEventListener("load", registerServiceWorker);
  }, []);

  return null;
}
