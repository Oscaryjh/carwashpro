"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

type WhatsAppSettingsAutoRefreshProps = {
  enabled: boolean;
  intervalMs?: number;
  status:
    | "starting"
    | "connecting"
    | "qr"
    | "connected"
    | "session_expired"
    | "disconnected"
    | "reconnecting"
    | "error";
};

export function WhatsAppSettingsAutoRefresh({
  enabled,
  intervalMs = 2000,
  status,
}: WhatsAppSettingsAutoRefreshProps) {
  const router = useRouter();

  useEffect(() => {
    if (!enabled) {
      return;
    }

    const timer = window.setInterval(() => {
      router.refresh();
    }, intervalMs);

    return () => window.clearInterval(timer);
  }, [enabled, intervalMs, router, status]);

  return null;
}
