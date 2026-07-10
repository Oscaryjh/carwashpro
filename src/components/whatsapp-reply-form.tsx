"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import type { ConnectorStatus } from "@/lib/whatsapp/connector-client";

type WhatsAppReplyFormProps = {
  connectionStatus: ConnectorStatus["status"];
  conversationId: string;
  disabled: boolean;
};

export function WhatsAppReplyForm({
  connectionStatus,
  conversationId,
  disabled,
}: WhatsAppReplyFormProps) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const sendAfterRecordingRef = useRef(false);
  const isRecordingRef = useRef(false);
  const stopWhenReadyRef = useRef(false);
  const [body, setBody] = useState("");
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioUrl, setAudioUrl] = useState("");
  const [fileAttachment, setFileAttachment] = useState<File | null>(null);
  const [error, setError] = useState("");
  const [isAttachMenuOpen, setIsAttachMenuOpen] = useState(false);
  const [isEmojiPickerOpen, setIsEmojiPickerOpen] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isPending, startTransition] = useTransition();

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await sendMessage();
  }

  async function sendMessage(recordedAudioBlob: Blob | null = audioBlob) {
    const message = body.trim();

    if (!message && !recordedAudioBlob && !fileAttachment) {
      setError("Message is required.");
      return;
    }

    setError("");
    const audioPayload = recordedAudioBlob ? await blobToBase64(recordedAudioBlob) : null;
    const documentPayload = fileAttachment ? await blobToBase64(fileAttachment) : null;

    const response = await fetch("/api/whatsapp/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        conversationId,
        body: message || getDefaultMessageBody(recordedAudioBlob, fileAttachment),
        audioBase64: audioPayload,
        audioFileName: recordedAudioBlob ? getAudioFileName(recordedAudioBlob.type) : null,
        audioMimeType: recordedAudioBlob?.type || null,
        documentBase64: documentPayload,
        documentFileName: fileAttachment?.name ?? null,
        documentMimeType: fileAttachment?.type || null,
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
    clearAudio();
    clearFileAttachment();
    startTransition(() => {
      router.refresh();
    });
  }

  async function startRecording(sendAfterStop = false) {
    if (isDisabled || isRecordingRef.current) {
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError("Voice recording is not supported in this browser.");
      return;
    }

    try {
      sendAfterRecordingRef.current = sendAfterStop;
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = getSupportedAudioMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      audioChunksRef.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        const blob = new Blob(audioChunksRef.current, {
          type: recorder.mimeType || "audio/webm",
        });
        const shouldSend = sendAfterRecordingRef.current;
        sendAfterRecordingRef.current = false;
        isRecordingRef.current = false;
        setIsRecording(false);

        if (shouldSend) {
          void sendMessage(blob);
          return;
        }

        setAudioBlob(blob);
        setAudioUrl((previousUrl) => {
          if (previousUrl) {
            URL.revokeObjectURL(previousUrl);
          }

          return URL.createObjectURL(blob);
        });
      };

      mediaRecorderRef.current = recorder;
      recorder.start();
      isRecordingRef.current = true;
      setIsRecording(true);
      if (stopWhenReadyRef.current) {
        stopWhenReadyRef.current = false;
        recorder.stop();
      }
      setError("");
    } catch (error) {
      sendAfterRecordingRef.current = false;
      isRecordingRef.current = false;
      stopWhenReadyRef.current = false;
      setIsRecording(false);
      setError(
        error instanceof Error
          ? error.message
          : "Unable to access microphone.",
      );
    }
  }

  function stopRecording() {
    const recorder = mediaRecorderRef.current;

    if (!recorder || recorder.state === "inactive") {
      isRecordingRef.current = false;
      setIsRecording(false);
      return;
    }

    recorder.stop();
  }

  function handleVoicePointerDown(event: React.PointerEvent<HTMLButtonElement>) {
    if (isDisabled || canSendContent) {
      return;
    }

    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    void startRecording(true);
  }

  function handleVoicePointerUp(event: React.PointerEvent<HTMLButtonElement>) {
    if (canSendContent) {
      return;
    }

    event.preventDefault();
    if (!isRecordingRef.current) {
      stopWhenReadyRef.current = true;
      return;
    }

    stopRecording();
  }

  function handleVoicePointerCancel() {
    if (!isRecordingRef.current) {
      stopWhenReadyRef.current = false;
      return;
    }

    sendAfterRecordingRef.current = false;
    stopRecording();
  }

  function clearAudio() {
    setAudioBlob(null);
    setAudioUrl((previousUrl) => {
      if (previousUrl) {
        URL.revokeObjectURL(previousUrl);
      }

      return "";
    });
  }

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const selectedFile = event.target.files?.[0] ?? null;

    if (!selectedFile) {
      return;
    }

    if (selectedFile.size > MAX_ATTACHMENT_SIZE_BYTES) {
      setError("File is too large. Maximum size is 8 MB.");
      event.target.value = "";
      return;
    }

    setFileAttachment(selectedFile);
    setIsAttachMenuOpen(false);
    setError("");
  }

  function clearFileAttachment() {
    setFileAttachment(null);

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }

    if (imageInputRef.current) {
      imageInputRef.current.value = "";
    }
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey || isDisabled) {
      return;
    }

    event.preventDefault();
    void sendMessage();
  }

  function insertEmoji(emoji: string) {
    const textarea = textareaRef.current;
    const selectionStart = textarea?.selectionStart ?? body.length;
    const selectionEnd = textarea?.selectionEnd ?? body.length;
    const nextBody =
      body.slice(0, selectionStart) + emoji + body.slice(selectionEnd);
    const nextCaretPosition = selectionStart + emoji.length;

    setBody(nextBody);
    setIsEmojiPickerOpen(false);
    requestAnimationFrame(() => {
      textarea?.focus();
      textarea?.setSelectionRange(nextCaretPosition, nextCaretPosition);
    });
  }

  function openImagePicker() {
    setIsAttachMenuOpen(false);
    imageInputRef.current?.click();
  }

  function openFilePicker() {
    setIsAttachMenuOpen(false);
    fileInputRef.current?.click();
  }

  const isDisabled = disabled || isPending;
  const placeholder = disabled
    ? getDisabledPlaceholder(connectionStatus)
    : "Type a reply...";
  const canSendContent = Boolean(body.trim() || audioBlob || fileAttachment);
  const actionLabel = isPending
    ? "Sending"
    : isRecording
      ? "Release to send"
      : canSendContent
        ? "Send"
        : "Hold to record voice";

  return (
    <form className="whatsapp-reply-box" onSubmit={handleSubmit}>
      <div className="whatsapp-reply-input-stack">
        <div className="whatsapp-reply-input-shell">
          <button
            aria-label="Choose emoji"
            className="whatsapp-emoji-button"
            disabled={isDisabled}
            onClick={() => setIsEmojiPickerOpen((isOpen) => !isOpen)}
            type="button"
          >
            <SmileIcon />
          </button>
          <button
            aria-label="Attach"
            className="whatsapp-attach-button"
            disabled={isDisabled}
            onClick={() => setIsAttachMenuOpen((isOpen) => !isOpen)}
            type="button"
          >
            <PaperclipIcon />
          </button>
          {isAttachMenuOpen ? (
            <div className="whatsapp-attach-menu">
              <button onClick={openImagePicker} type="button">
                <ImageIcon />
                <span>Image</span>
              </button>
              <button onClick={openFilePicker} type="button">
                <FileIcon />
                <span>File</span>
              </button>
            </div>
          ) : null}
          <input
            accept="image/*"
            className="whatsapp-file-input"
            disabled={isDisabled}
            onChange={handleFileChange}
            ref={imageInputRef}
            type="file"
          />
          <input
            className="whatsapp-file-input"
            disabled={isDisabled}
            onChange={handleFileChange}
            ref={fileInputRef}
            type="file"
          />
          <textarea
            disabled={isDisabled}
            name="body"
            onChange={(event) => setBody(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={audioBlob ? "Add a caption..." : placeholder}
            ref={textareaRef}
            rows={1}
            value={body}
          />
          {isEmojiPickerOpen ? (
            <div className="whatsapp-emoji-picker" role="listbox">
              {COMMON_EMOJIS.map((emoji) => (
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
        <div className="whatsapp-voice-controls">
          {fileAttachment ? (
            <div className="whatsapp-attachment-preview">
              <span>
                <strong>{fileAttachment.name}</strong>
                <small>{formatFileSize(fileAttachment.size)}</small>
              </span>
              <button
                aria-label="Remove attachment"
                disabled={isDisabled}
                onClick={clearFileAttachment}
                type="button"
              >
                Remove
              </button>
            </div>
          ) : null}
          {audioUrl ? (
            <audio controls preload="metadata" src={audioUrl}>
              Your browser does not support audio playback.
            </audio>
          ) : null}
          {audioBlob ? (
            <button
              className="secondary-light-button voice-clear-button"
              disabled={isDisabled}
              onClick={clearAudio}
              type="button"
            >
              Remove
            </button>
          ) : null}
        </div>
      </div>
      <button
        aria-label={actionLabel}
        className={
          canSendContent
            ? "whatsapp-reply-action send"
            : isRecording
              ? "whatsapp-reply-action recording"
              : "whatsapp-reply-action record"
        }
        disabled={isDisabled}
        onPointerCancel={handleVoicePointerCancel}
        onPointerDown={canSendContent ? undefined : handleVoicePointerDown}
        onPointerLeave={undefined}
        onPointerUp={canSendContent ? undefined : handleVoicePointerUp}
        onClick={
          canSendContent
            ? undefined
            : (event) => {
                event.preventDefault();
              }
        }
        title={actionLabel}
        type={canSendContent ? "submit" : "button"}
      >
        {isPending ? (
          <span className="whatsapp-action-spinner" aria-hidden="true" />
        ) : canSendContent ? (
          <SendIcon />
        ) : isRecording ? (
          <StopIcon />
        ) : (
          <MicIcon />
        )}
      </button>
      {error ? <span className="field-error whatsapp-send-error">{error}</span> : null}
    </form>
  );
}

const MAX_ATTACHMENT_SIZE_BYTES = 8 * 1024 * 1024;

const COMMON_EMOJIS = [
  "😀",
  "😁",
  "😂",
  "😊",
  "😍",
  "😘",
  "😎",
  "😅",
  "😭",
  "🙏",
  "👍",
  "👌",
  "👏",
  "💪",
  "❤️",
  "🔥",
  "🎉",
  "🚗",
  "🧽",
  "✨",
  "✅",
  "📍",
  "⏰",
  "💰",
];

function getDisabledPlaceholder(status: ConnectorStatus["status"]) {
  if (status === "qr") {
    return "Scan QR before sending from the inbox.";
  }

  return "Reconnect WhatsApp before sending from the inbox.";
}

function getSupportedAudioMimeType() {
  const candidates = [
    "audio/ogg; codecs=opus",
    "audio/ogg;codecs=opus",
    "audio/webm",
    "audio/webm;codecs=opus",
  ];

  return candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate)) ?? "";
}

function getAudioFileName(mimeType: string) {
  const extension = mimeType.includes("ogg") ? "ogg" : "webm";

  return `voice-message-${Date.now()}.${extension}`;
}

function getDefaultMessageBody(audioBlob: Blob | null, fileAttachment: File | null) {
  if (audioBlob) {
    return "Voice message";
  }

  if (fileAttachment?.type.startsWith("image/")) {
    return "Image";
  }

  if (fileAttachment) {
    return fileAttachment.name;
  }

  return "";
}

function formatFileSize(size: number) {
  if (size < 1024 * 1024) {
    return `${Math.max(1, Math.round(size / 1024))} KB`;
  }

  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function blobToBase64(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("Unable to read audio."));
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      resolve(result.split(",")[1] ?? "");
    };
    reader.readAsDataURL(blob);
  });
}

function MicIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M12 14a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v5a3 3 0 0 0 3 3Z" />
      <path d="M19 11a7 7 0 0 1-14 0" />
      <path d="M12 18v3" />
      <path d="M8 21h8" />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M4 4l17 8-17 8 3-8-3-8Z" />
      <path d="M7 12h14" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <rect x="7" y="7" width="10" height="10" rx="2" />
    </svg>
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

function PaperclipIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M21.4 11.6 12 21a6 6 0 0 1-8.5-8.5l9.9-9.9a4 4 0 0 1 5.7 5.7l-9.9 9.9a2 2 0 0 1-2.8-2.8l9.4-9.4" />
    </svg>
  );
}

function ImageIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <rect x="4" y="5" width="16" height="14" rx="2" />
      <path d="m4 15 4-4 4 4 2-2 6 6" />
      <path d="M14.5 9.5h.01" />
    </svg>
  );
}

function FileIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M7 3h7l5 5v13H7z" />
      <path d="M14 3v6h5" />
    </svg>
  );
}
