"use client";

import Image from "next/image";
import {
  useActionState,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import { useFormStatus } from "react-dom";
import styles from "./employee-avatar-upload.module.css";

export type EmployeeAvatarState = {
  status: "idle" | "success" | "error";
  message: string;
  avatarUrl?: string;
};

export type EmployeeAvatarAction = (
  state: EmployeeAvatarState,
  formData: FormData,
) => Promise<EmployeeAvatarState>;

const initialState: EmployeeAvatarState = { status: "idle", message: "" };
const MAX_SOURCE_BYTES = 10 * 1024 * 1024;

export function EmployeeAvatarUpload({
  action,
  avatarUrl,
  fullName,
}: {
  action?: EmployeeAvatarAction;
  avatarUrl: string | null;
  fullName: string;
}) {
  const [state, formAction] = useActionState(action ?? unchangedAction, initialState);
  const [displayAvatarUrl, setDisplayAvatarUrl] = useState(avatarUrl);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [clientError, setClientError] = useState("");
  const [open, setOpen] = useState(false);
  const [viewerOpen, setViewerOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const initials = getInitials(fullName);

  useEffect(() => {
    setDisplayAvatarUrl(avatarUrl);
  }, [avatarUrl]);

  useEffect(() => {
    if (state.status === "success" && state.avatarUrl) {
      setDisplayAvatarUrl(state.avatarUrl);
      setOpen(false);
      setPreviewUrl((current) => {
        if (current) URL.revokeObjectURL(current);
        return null;
      });
      if (inputRef.current) inputRef.current.value = "";
    }
  }, [state]);

  useEffect(
    () => () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    },
    [previewUrl],
  );

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const source = event.target.files?.[0];
    setClientError("");
    if (!source) return;
    if (!source.type.startsWith("image/")) {
      setClientError("Choose a JPG, PNG or WebP photo.");
      event.target.value = "";
      return;
    }
    if (source.size > MAX_SOURCE_BYTES) {
      setClientError("Choose a photo smaller than 10 MB.");
      event.target.value = "";
      return;
    }

    try {
      const processed = await prepareAvatar(source);
      const transfer = new DataTransfer();
      transfer.items.add(processed);
      event.target.files = transfer.files;
      setPreviewUrl((current) => {
        if (current) URL.revokeObjectURL(current);
        return URL.createObjectURL(processed);
      });
      setOpen(true);
    } catch {
      setClientError("We could not prepare this photo. Choose another image.");
      event.target.value = "";
    }
  }

  function choosePhoto() {
    setClientError("");
    inputRef.current?.click();
  }

  function closeModal() {
    setOpen(false);
    setPreviewUrl((current) => {
      if (current) URL.revokeObjectURL(current);
      return null;
    });
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <div className={styles.root}>
      <button
        aria-label={displayAvatarUrl ? `View profile photo for ${fullName}` : `${fullName} has no profile photo`}
        className={styles.avatarButton}
        disabled={!displayAvatarUrl}
        onClick={displayAvatarUrl ? () => setViewerOpen(true) : undefined}
        title={displayAvatarUrl ? "View profile photo" : undefined}
        type="button"
      >
        {displayAvatarUrl ? (
          <Image
            alt={`${fullName} profile photo`}
            className={styles.avatarImage}
            fill
            loading="eager"
            sizes="80px"
            src={displayAvatarUrl}
            unoptimized
          />
        ) : (
          <span aria-hidden="true" className={styles.initials}>{initials}</span>
        )}
      </button>

      {action ? (
        <button
          aria-label={`Edit profile photo for ${fullName}`}
          className={styles.editButton}
          onClick={choosePhoto}
          title="Change profile photo"
          type="button"
        >
          <svg aria-hidden="true" viewBox="0 0 24 24">
            <path d="M14.7 5.3 18.7 9.3M4 20l4.2-1 10.5-10.5a2.83 2.83 0 0 0-4-4L4.2 15 4 20Z" />
          </svg>
        </button>
      ) : null}

      {viewerOpen && displayAvatarUrl ? (
        <div
          aria-labelledby="employee-avatar-view-title"
          aria-modal="true"
          className={styles.backdrop}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setViewerOpen(false);
          }}
          role="dialog"
        >
          <div className={`${styles.modal} ${styles.viewerModal}`}>
            <div className={styles.modalHeader}>
              <div>
                <p>PROFILE PHOTO</p>
                <h2 id="employee-avatar-view-title">{fullName}</h2>
              </div>
              <button
                aria-label="Close profile photo"
                className={styles.closeButton}
                onClick={() => setViewerOpen(false)}
                type="button"
              >
                ×
              </button>
            </div>

            <div className={styles.viewerFrame}>
              <Image
                alt={`${fullName} profile photo enlarged`}
                className={styles.viewerImage}
                fill
                sizes="(max-width: 560px) 88vw, 460px"
                src={displayAvatarUrl}
                unoptimized
              />
            </div>
          </div>
        </div>
      ) : null}

      {action ? (
        <form action={formAction}>
          <input
            accept="image/jpeg,image/png,image/webp"
            className={styles.fileInput}
            name="avatar"
            onChange={handleFileChange}
            ref={inputRef}
            type="file"
          />
          {clientError ? <p className={styles.inlineError}>{clientError}</p> : null}

          {open && previewUrl ? (
            <div
              aria-labelledby="employee-avatar-title"
              aria-modal="true"
              className={styles.backdrop}
              onMouseDown={(event) => {
                if (event.target === event.currentTarget) closeModal();
              }}
              role="dialog"
            >
              <div className={styles.modal}>
                <div className={styles.modalHeader}>
                  <div>
                    <p>EMPLOYEE PROFILE</p>
                    <h2 id="employee-avatar-title">Profile photo</h2>
                  </div>
                  <button aria-label="Close" className={styles.closeButton} onClick={closeModal} type="button">×</button>
                </div>

                <div className={styles.previewFrame}>
                  {/* Blob previews cannot be optimized by the Next image pipeline. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img alt="New profile photo preview" src={previewUrl} />
                </div>
                <div className={styles.modalCopy}>
                  <strong>{fullName}</strong>
                  <span>The image will be cropped to a square.</span>
                </div>

                {(clientError || state.status === "error") ? (
                  <p className={styles.errorMessage} role="alert">
                    {clientError || state.message}
                  </p>
                ) : null}

                <div className={styles.actions}>
                  <button className={styles.secondaryButton} onClick={choosePhoto} type="button">Choose another</button>
                  <SubmitButton />
                </div>
              </div>
            </div>
          ) : null}
        </form>
      ) : null}
    </div>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button className={styles.primaryButton} disabled={pending} type="submit">
      {pending ? "Saving…" : "Save photo"}
    </button>
  );
}

async function prepareAvatar(source: File) {
  const imageUrl = URL.createObjectURL(source);
  try {
    const image = await loadImage(imageUrl);
    const side = Math.min(image.naturalWidth, image.naturalHeight);
    const sourceX = Math.max(0, (image.naturalWidth - side) / 2);
    const sourceY = Math.max(0, (image.naturalHeight - side) / 2);
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 512;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas is unavailable.");
    context.drawImage(image, sourceX, sourceY, side, side, 0, 0, 512, 512);
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (result) => result ? resolve(result) : reject(new Error("Image processing failed.")),
        "image/webp",
        0.84,
      );
    });
    return new File([blob], "employee-avatar.webp", { type: "image/webp" });
  } finally {
    URL.revokeObjectURL(imageUrl);
  }
}

function loadImage(url: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new window.Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Image could not be loaded."));
    image.src = url;
  });
}

function getInitials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

async function unchangedAction(state: EmployeeAvatarState) {
  return state;
}
