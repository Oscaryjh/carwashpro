"use client";

import { useState, type FormEvent } from "react";

type SendStatus = {
  type: "success" | "error";
  message: string;
};

export function WhatsAppSendTestForm() {
  const [phone, setPhone] = useState("");
  const [message, setMessage] = useState("Tetamu POS test message from system");
  const [isSending, setIsSending] = useState(false);
  const [status, setStatus] = useState<SendStatus | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSending(true);
    setStatus(null);

    try {
      const response = await fetch("/api/whatsapp/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, message }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        message?: string;
        messageId?: string;
      };

      if (!response.ok) {
        throw new Error(data.message ?? "Unable to send WhatsApp message.");
      }

      setStatus({
        type: "success",
        message: `Sent. Message ID: ${data.messageId ?? "-"}`,
      });
    } catch (error) {
      setStatus({
        type: "error",
        message:
          error instanceof Error ? error.message : "Unable to send WhatsApp message.",
      });
    } finally {
      setIsSending(false);
    }
  }

  return (
    <div className="panel">
      <div className="section-header">
        <h2>Manual send test</h2>
      </div>
      <form className="form" onSubmit={handleSubmit}>
        <div className="field-grid">
          <label>
            Phone
            <input
              inputMode="tel"
              name="phone"
              placeholder="601112212259"
              required
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
            />
          </label>
          <label>
            Message
            <input
              name="message"
              required
              value={message}
              onChange={(event) => setMessage(event.target.value)}
            />
          </label>
        </div>
        {status ? (
          <p className={status.type === "success" ? "form-success" : "form-error"}>
            {status.message}
          </p>
        ) : null}
        <button type="submit" disabled={isSending}>
          {isSending ? "Sending..." : "Send test WhatsApp"}
        </button>
      </form>
    </div>
  );
}
