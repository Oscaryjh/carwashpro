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

  function handleClick() {
    setError("");
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
    </span>
  );
}
