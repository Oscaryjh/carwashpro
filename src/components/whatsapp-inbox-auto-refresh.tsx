"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

type WhatsAppInboxAutoRefreshProps = {
  enabled: boolean;
  intervalMs?: number;
};

export function WhatsAppInboxAutoRefresh({
  enabled,
  intervalMs = 5000,
}: WhatsAppInboxAutoRefreshProps) {
  const router = useRouter();

  useEffect(() => {
    if (!enabled) {
      return;
    }

    function refreshWhenVisible() {
      if (document.visibilityState === "visible") {
        router.refresh();
      }
    }

    const intervalId = window.setInterval(refreshWhenVisible, intervalMs);
    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [enabled, intervalMs, router]);

  return null;
}
