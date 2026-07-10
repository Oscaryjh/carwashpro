"use client";

import type { WhatsAppMessageType } from "@prisma/client";
import { useState, useTransition } from "react";
import { openWhatsAppDeepLinkAction } from "@/app/whatsapp/actions";

type SendWhatsAppButtonProps = {
  label: string;
  messageType: WhatsAppMessageType;
  customerId?: string;
  workOrderId?: string;
  invoiceId?: string;
  className?: string;
};

export function SendWhatsAppButton({
  label,
  messageType,
  customerId,
  workOrderId,
  invoiceId,
  className = "button-link",
}: SendWhatsAppButtonProps) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [fallbackUrl, setFallbackUrl] = useState("");

  function handleClick() {
    setError("");
    setFallbackUrl("");
    startTransition(async () => {
      const result = await openWhatsAppDeepLinkAction({
        messageType,
        customerId,
        workOrderId,
        invoiceId,
      });

      if (result.error || !result.url) {
        setError(result.error ?? "Unable to open WhatsApp.");
        return;
      }

      setFallbackUrl(result.url);

      if (result.appUrl) {
        const appLink = document.createElement("a");
        appLink.href = result.appUrl;
        appLink.rel = "noopener noreferrer";
        document.body.append(appLink);
        appLink.click();
        appLink.remove();
        return;
      }

      window.open(result.url, "_blank", "noopener,noreferrer");
    });
  }

  return (
    <span className="whatsapp-send-control">
      <button
        className={className}
        disabled={isPending}
        onClick={handleClick}
        type="button"
      >
        {isPending ? "Opening..." : label}
      </button>
      {error ? <small className="error">{error}</small> : null}
      {fallbackUrl ? (
        <a href={fallbackUrl} rel="noopener noreferrer" target="_blank">
          Open WhatsApp Web
        </a>
      ) : null}
    </span>
  );
}
