"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { ConnectorStatus } from "@/lib/whatsapp/connector-client";

type WhatsAppSessionRecoveryProps = {
  lastAckErrorAt: string | null;
  lastDisconnectedAt: string | null;
  reconnectAttempts: number;
  status: ConnectorStatus["status"];
};

const RECOVERABLE_STATUSES = new Set<ConnectorStatus["status"]>([
  "disconnected",
  "session_expired",
  "error",
]);
const CONNECTING_STATUSES = new Set<ConnectorStatus["status"]>([
  "connecting",
  "reconnecting",
]);
const MAX_STATUS_POLLS = 12;
const STATUS_POLL_INTERVAL_MS = 2500;

export function WhatsAppSessionRecovery({
  lastAckErrorAt,
  lastDisconnectedAt,
  reconnectAttempts,
  status,
}: WhatsAppSessionRecoveryProps) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const recoveryKey = useMemo(
    () =>
      [
        "whatsapp-session-recovery",
        status,
        lastAckErrorAt ?? "no-ack",
        lastDisconnectedAt ?? "no-disconnect",
        reconnectAttempts,
      ].join(":"),
    [lastAckErrorAt, lastDisconnectedAt, reconnectAttempts, status],
  );

  useEffect(() => {
    if (!RECOVERABLE_STATUSES.has(status) && !CONNECTING_STATUSES.has(status)) {
      setMessage("");
      return;
    }

    let pollTimer: number | undefined;
    const controller = new AbortController();
    const cleanup = () => {
      controller.abort();
      if (pollTimer) {
        window.clearTimeout(pollTimer);
      }
    };

    function pollStatus(attempt = 0) {
      pollTimer = window.setTimeout(() => {
        fetch("/api/whatsapp/recover-session", {
          method: "GET",
          signal: controller.signal,
        })
          .then(async (response) => {
            if (!response.ok) {
              throw new Error("Unable to read WhatsApp reconnect status.");
            }

            return response.json();
          })
          .then((payload: { status?: ConnectorStatus["status"] }) => {
            if (payload.status === "connected") {
              setMessage("WhatsApp reconnected.");
              router.refresh();
              return;
            }

            if (payload.status === "qr") {
              setMessage("Fresh QR is ready. Scan it to reconnect.");
              router.refresh();
              return;
            }

            if (attempt + 1 >= MAX_STATUS_POLLS) {
              setMessage("Reconnect requested. Refresh status or scan QR if shown.");
              router.refresh();
              return;
            }

            setMessage("Waiting for WhatsApp reconnect...");
            pollStatus(attempt + 1);
          })
          .catch((error) => {
            if (error instanceof DOMException && error.name === "AbortError") {
              return;
            }

            setMessage("Automatic reconnect failed. Use Reconnect by QR.");
            router.refresh();
          });
      }, STATUS_POLL_INTERVAL_MS);
    }

    if (CONNECTING_STATUSES.has(status)) {
      setMessage("Waiting for WhatsApp reconnect...");
      pollStatus();
      return cleanup;
    }

    if (window.sessionStorage.getItem(recoveryKey) === "attempted") {
      return;
    }

    window.sessionStorage.setItem(recoveryKey, "attempted");
    setMessage("Trying to reconnect WhatsApp automatically...");

    fetch("/api/whatsapp/recover-session", {
      method: "POST",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error("Automatic reconnect failed.");
        }

        return response.json();
      })
      .then((payload: { status?: ConnectorStatus["status"] }) => {
        if (payload.status === "connected") {
          setMessage("WhatsApp reconnected.");
          router.refresh();
        } else if (payload.status === "qr") {
          setMessage("Fresh QR is ready. Scan it to reconnect.");
          router.refresh();
        } else {
          setMessage("Reconnect requested. Waiting for WhatsApp...");
          pollStatus();
        }
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }

        setMessage("Automatic reconnect failed. Use Reconnect by QR.");
        router.refresh();
      });

    return cleanup;
  }, [recoveryKey, router, status]);

  return message ? <div className="success">{message}</div> : null;
}
