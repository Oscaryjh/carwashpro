"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

type WhatsAppInboxAutoRefreshProps = {
  enabled: boolean;
  intervalMs?: number;
};

export function WhatsAppInboxAutoRefresh({
  enabled,
  intervalMs = 5000,
}: WhatsAppInboxAutoRefreshProps) {
  const router = useRouter();
  const navigationPauseUntilRef = useRef(0);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    function pauseRefreshForNavigation(event: MouseEvent) {
      const target = event.target;

      if (!(target instanceof Element)) {
        return;
      }

      const link = target.closest("a[href]");

      if (!link) {
        return;
      }

      navigationPauseUntilRef.current = Date.now() + 3000;
    }

    function refreshWhenVisible() {
      if (
        document.visibilityState === "visible" &&
        window.location.pathname === "/whatsapp/inbox" &&
        Date.now() > navigationPauseUntilRef.current
      ) {
        router.refresh();
      }
    }

    const intervalId = window.setInterval(refreshWhenVisible, intervalMs);
    document.addEventListener("pointerdown", pauseRefreshForNavigation, true);
    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);

    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener("pointerdown", pauseRefreshForNavigation, true);
      window.removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [enabled, intervalMs, router]);

  return null;
}
