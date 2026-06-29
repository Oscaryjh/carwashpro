"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

type WhatsAppReplyFormProps = {
  conversationId: string;
  disabled: boolean;
};

export function WhatsAppReplyForm({
  conversationId,
  disabled,
}: WhatsAppReplyFormProps) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await sendMessage();
  }

  async function sendMessage() {
    const message = body.trim();

    if (!message) {
      setError("Message is required.");
      return;
    }

    setError("");

    const response = await fetch("/api/whatsapp/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        conversationId,
        body: message,
      }),
    });
    const payload = (await response.json().catch(() => null)) as
      | { message?: string }
      | null;

    if (!response.ok) {
      setError(payload?.message ?? "Unable to send WhatsApp message.");
      return;
    }

    setBody("");
    startTransition(() => {
      router.refresh();
    });
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey || isDisabled) {
      return;
    }

    event.preventDefault();
    void sendMessage();
  }

  const isDisabled = disabled || isPending;

  return (
    <form className="whatsapp-reply-box" onSubmit={handleSubmit}>
      <textarea
        disabled={isDisabled}
        name="body"
        onChange={(event) => setBody(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={
          disabled
            ? "Connect WhatsApp before sending from the inbox."
            : "Type a reply..."
        }
        rows={2}
        value={body}
      />
      <button disabled={isDisabled} type="submit">
        {isPending ? "Sending..." : "Send"}
      </button>
      {error ? <span className="field-error whatsapp-send-error">{error}</span> : null}
    </form>
  );
}
