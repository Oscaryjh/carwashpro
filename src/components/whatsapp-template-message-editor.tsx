"use client";

import { useEffect, useId, useRef, useState } from "react";

type WhatsAppTemplateMessageEditorProps = {
  defaultValue: string;
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
