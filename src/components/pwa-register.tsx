"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { startPwaUpdates, type UpdateState } from "@/lib/pwa/update-client";
import styles from "./pwa-update.module.css";

export function PwaRegister() {
  const pathname = usePathname();
  const [state, setState] = useState<UpdateState>("upToDate");
  const [dismissedPath, setDismissedPath] = useState<string | null>(null);
  const [pagePath, setPagePath] = useState(pathname);
  if (pagePath !== pathname) {
    setPagePath(pathname);
    setDismissedPath(null);
  }
  const banner = useRef<HTMLElement | null>(null);
  const visible = state !== "upToDate" && dismissedPath !== pathname;
  const runtime = useRef<ReturnType<typeof startPwaUpdates> | null>(null);
  const version = process.env.APP_BUILD_SHA ?? "";
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
                registration.scope === window.location.origin + "/" &&
                [registration.active, registration.waiting, registration.installing].some(worker =>
                  worker && new URL(worker.scriptURL).pathname === "/sw.js"),
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

    runtime.current = startPwaUpdates(window, version, (next) => {
      setDismissedPath(null);
      setState(next);
    });
    return () => { runtime.current?.stop(); runtime.current = null; };
  }, [version]);

  useLayoutEffect(() => {
    const root = document.documentElement;
    const clear = () => {
      root.style.setProperty("--pwa-banner-height", "0px");
      root.classList.remove(styles.layoutActive);
    };
    if (!visible || !banner.current) { clear(); return; }
    const element = banner.current;
    const measure = () => {
      root.style.setProperty("--pwa-banner-height", `${element.getBoundingClientRect().height}px`);
      root.classList.add(styles.layoutActive);
    };
    measure();
    const observer = typeof window.ResizeObserver === "function" ? new window.ResizeObserver(measure) : null;
    observer?.observe(element);
    window.addEventListener("resize", measure);
    return () => { observer?.disconnect(); window.removeEventListener("resize", measure); clear(); };
  }, [visible]);

  return <>
    {pathname === "/business/settings" && /^[a-f0-9]{40}$/i.test(version) &&
      <small className={styles.version}>Version {version.slice(0, 7)}</small>}
    {visible && <aside ref={banner} className={styles.banner} aria-label="App update">
      <div role="status" aria-live="polite">
        <strong>{state === "recoveryRequired" ? "Tetamu POS needs to refresh after an update." : "Tetamu POS has been updated."}</strong>
        <span>Finish your current task, then refresh to continue. Unsaved changes may be lost.</span>
      </div>
      <div className={styles.actions}>
      <button type="button" disabled={state === "applyingUpdate"} onClick={() => runtime.current?.refresh()}>
        {state === "applyingUpdate" ? "Refreshing…" : state === "recoveryRequired" ? "Reload app" : "Refresh now"}
      </button>
      <button type="button" disabled={state === "applyingUpdate"} onClick={() => setDismissedPath(pathname)}>Later</button>
      </div>
    </aside>}
  </>;
}
