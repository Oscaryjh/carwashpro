"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { BusinessIndustry } from "@prisma/client";

type WhatsAppTemplateMessageEditorProps = {
  defaultValue: string;
  industryType: BusinessIndustry;
  variables: readonly string[];
};

const TEMPLATE_EMOJIS = [
  "\u{1F600}",
  "\u{1F601}",
  "\u{1F602}",
  "\u{1F60A}",
  "\u{1F60D}",
  "\u{1F60E}",
  "\u{1F64F}",
  "\u{1F44D}",
  "\u{1F44C}",
  "\u{1F44F}",
  "\u{1F4AA}",
  "\u{2764}\u{FE0F}",
  "\u{1F525}",
  "\u{1F389}",
  "\u{2728}",
  "\u{2705}",
  "\u{1F697}",
  "\u{1F9FC}",
  "\u{1F4CD}",
  "\u{23F0}",
  "\u{1F4B0}",
  "\u{1F4B3}",
  "\u{1F4C5}",
  "\u{1F4DE}",
  "\u{1F6CE}\u{FE0F}",
  "\u{1F4E2}",
  "\u{1F381}",
  "\u{1F4A1}",
  "\u{1F6A8}",
  "\u{1F44B}",
];

export function WhatsAppTemplateMessageEditor({
  defaultValue,
  industryType,
  variables,
}: WhatsAppTemplateMessageEditorProps) {
  const textareaId = useId();
  const pickerRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [body, setBody] = useState(defaultValue);
  const [isPickerOpen, setIsPickerOpen] = useState(false);

  useEffect(() => {
    if (!isPickerOpen) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      if (!pickerRef.current?.contains(event.target as Node)) {
        setIsPickerOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsPickerOpen(false);
        textareaRef.current?.focus();
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isPickerOpen]);

  function insertEmoji(emoji: string) {
    const textarea = textareaRef.current;
    const selectionStart = textarea?.selectionStart ?? body.length;
    const selectionEnd = textarea?.selectionEnd ?? body.length;
    const nextBody =
      body.slice(0, selectionStart) + emoji + body.slice(selectionEnd);
    const nextCaretPosition = selectionStart + emoji.length;

    setBody(nextBody);
    setIsPickerOpen(false);

    requestAnimationFrame(() => {
      textarea?.focus();
      textarea?.setSelectionRange(nextCaretPosition, nextCaretPosition);
    });
  }

  function insertVariable(variable: string) {
    const textarea = textareaRef.current;
    const selectionStart = textarea?.selectionStart ?? body.length;
    const selectionEnd = textarea?.selectionEnd ?? body.length;
    const placeholder = `{{${variable}}}`;
    const nextBody =
      body.slice(0, selectionStart) + placeholder + body.slice(selectionEnd);
    const nextCaretPosition = selectionStart + placeholder.length;

    setBody(nextBody);
    requestAnimationFrame(() => {
      textarea?.focus();
      textarea?.setSelectionRange(nextCaretPosition, nextCaretPosition);
    });
  }

  const sampleValues: Record<string, string> = {
    companyName: industryType === "SALON_BEAUTY" ? "Glow Studio" : "Oscar Car Wash",
    companyPhone: "01112212259",
    customerName: industryType === "SALON_BEAUTY" ? "Siti Aminah" : "Oscar Yong",
    customerPhone: "01112212259",
    services: industryType === "SALON_BEAUTY" ? "Hair colouring" : "Basic Wash",
    appointmentDate: "18 July 2026",
    appointmentTime: "10:00 AM",
    orderNumber: "WO-260718-001",
    invoiceNumber: "INV-260718-001",
    subtotal: "RM100.00",
    total: "RM100.00",
    paidAmount: "RM100.00",
    balance: "RM0.00",
    paymentStatus: "paid",
    companyNo: "15161718",
    companyAddress: "Main Street",
    invoiceUrl: "https://example.com/invoice",
    plateNumber: "SAB0932A",
    vehicleBrand: "Perodua",
    vehicleModel: "Myvi",
    vehicleDisplayName: "Perodua Myvi",
    vehicleName: "Perodua Myvi",
  };

  const previewBody = body.replaceAll(
    /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g,
    (_, key: string) => sampleValues[key] ?? `{{${key}}}`,
  );

  return (
    <div className="template-message-editor">
      <div className="template-message-editor-header">
        <label htmlFor={textareaId}>Message body</label>
        <div className="template-emoji-control" ref={pickerRef}>
          <button
            aria-expanded={isPickerOpen}
            aria-label="Add emoji"
            className="template-emoji-trigger"
            onClick={() => setIsPickerOpen((isOpen) => !isOpen)}
            title="Add emoji"
            type="button"
          >
            <SmileIcon />
          </button>

          {isPickerOpen ? (
            <div
              aria-label="Emoji choices"
              className="template-emoji-picker"
              role="listbox"
            >
              {TEMPLATE_EMOJIS.map((emoji) => (
                <button
                  aria-label={`Insert ${emoji}`}
                  key={emoji}
                  onClick={() => insertEmoji(emoji)}
                  type="button"
                >
                  {emoji}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      <textarea
        className="template-body"
        id={textareaId}
        name="body"
        onChange={(event) => setBody(event.target.value)}
        ref={textareaRef}
        required
        value={body}
      />

      <div className="template-quick-variables">
        <span className="muted">Insert variable</span>
        <div className="template-variable-grid">
          {variables.map((variable) => (
            <button
              className="template-variable-chip"
              key={variable}
              onClick={() => insertVariable(variable)}
              type="button"
            >
              {"{{"}
              {variable}
              {"}}"}
            </button>
          ))}
        </div>
      </div>

      <div className="template-live-preview">
        <div className="template-preview-heading">
          <strong>Message preview</strong>
          <span className="muted">Sample values</span>
        </div>
        <div className="template-preview-bubble">{previewBody}</div>
      </div>
    </div>
  );
}

function SmileIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="9" />
      <path d="M8.5 10h.01" />
      <path d="M15.5 10h.01" />
      <path d="M8.5 14.5c1.8 1.7 5.2 1.7 7 0" />
    </svg>
  );
}
