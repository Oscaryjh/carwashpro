"use client";

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import { isEmployeeSessionError, StaffApiError, staffApiFetch } from "@/lib/staff-pwa/client";

const MAX_SOURCE_BYTES = 10 * 1024 * 1024;

export function StaffAvatarUpload({
  avatarUrl,
  fullName,
  initials,
  onUpdated,
}: {
  avatarUrl: string | null;
  fullName: string;
  initials: string;
  onUpdated: (avatarUrl: string) => void;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [displayAvatarUrl, setDisplayAvatarUrl] = useState(avatarUrl);
  const [preparedFile, setPreparedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => setDisplayAvatarUrl(avatarUrl), [avatarUrl]);

  useEffect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  function choosePhoto() {
    setError("");
    inputRef.current?.click();
  }

  function closeSheet() {
    if (saving) return;
    setOpen(false);
    setPreparedFile(null);
    setPreviewUrl((current) => {
      if (current) URL.revokeObjectURL(current);
      return null;
    });
    if (inputRef.current) inputRef.current.value = "";
  }

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const source = event.currentTarget.files?.[0];
    setError("");
    if (!source) return;
    if (!source.type.startsWith("image/")) {
      setError("Choose a photo from your camera or photo library.");
      event.currentTarget.value = "";
      return;
    }
    if (source.size > MAX_SOURCE_BYTES) {
      setError("Choose a photo smaller than 10 MB.");
      event.currentTarget.value = "";
      return;
    }

    try {
      const prepared = await prepareAvatar(source);
      setPreparedFile(prepared);
      setPreviewUrl((current) => {
        if (current) URL.revokeObjectURL(current);
        return URL.createObjectURL(prepared);
      });
      setOpen(true);
    } catch {
      setError("This photo could not be prepared. Choose another photo.");
      event.currentTarget.value = "";
    }
  }

  async function savePhoto() {
    if (!preparedFile || saving) return;
    setSaving(true);
    setError("");
    try {
      const form = new FormData();
      form.set("avatar", preparedFile, preparedFile.name);
      const response = await staffApiFetch<{ ok: true; avatarUrl: string }>(
        "/api/employee-auth/avatar",
        { method: "POST", body: form },
      );
      setDisplayAvatarUrl(response.avatarUrl);
      onUpdated(response.avatarUrl);
      closeSheetAfterSave();
    } catch (caught) {
      if (caught instanceof StaffApiError && isEmployeeSessionError(caught.code)) {
        router.replace("/staff/login?reason=session-expired");
        return;
      }
      setError(caught instanceof Error ? caught.message : "Unable to save this photo.");
    } finally {
      setSaving(false);
    }
  }

  function closeSheetAfterSave() {
    setOpen(false);
    setPreparedFile(null);
    setPreviewUrl((current) => {
      if (current) URL.revokeObjectURL(current);
      return null;
    });
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <div className="staff-profile-avatar-editor">
      <button
        aria-label="Change profile photo"
        className="staff-profile-avatar-button"
        onClick={choosePhoto}
        type="button"
      >
        {displayAvatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img alt={`${fullName} profile photo`} src={displayAvatarUrl} />
        ) : (
          <span aria-hidden="true">{initials || "T"}</span>
        )}
        <i aria-hidden="true">
          <svg viewBox="0 0 24 24"><path d="M8.5 7 10 5h4l1.5 2H18a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h2.5Z" /><circle cx="12" cy="13" r="3" /></svg>
        </i>
      </button>
      <input
        accept="image/*"
        className="staff-profile-avatar-input"
        onChange={(event) => void handleFileChange(event)}
        ref={inputRef}
        type="file"
      />
      {error && !open ? <p className="staff-profile-avatar-inline-error" role="alert">{error}</p> : null}

      {open && previewUrl ? (
        <div
          aria-labelledby="staff-avatar-sheet-title"
          aria-modal="true"
          className="staff-avatar-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeSheet();
          }}
          role="dialog"
        >
          <section className="staff-avatar-sheet">
            <span className="staff-avatar-sheet-handle" aria-hidden="true" />
            <header>
              <div>
                <p className="staff-kicker">PROFILE PHOTO</p>
                <h2 id="staff-avatar-sheet-title">Choose your photo</h2>
              </div>
              <button aria-label="Close photo editor" disabled={saving} onClick={closeSheet} type="button">×</button>
            </header>
            <div className="staff-avatar-preview">
              {/* Blob previews cannot use the Next image optimizer. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img alt="New profile photo preview" src={previewUrl} />
            </div>
            <p>Your photo will be cropped to a square and shown on the Staff App.</p>
            {error ? <div className="staff-alert error" role="alert">{error}</div> : null}
            <div className="staff-avatar-actions">
              <button className="staff-secondary-button" disabled={saving} onClick={choosePhoto} type="button">Choose another</button>
              <button className="staff-primary-button" disabled={saving} onClick={() => void savePhoto()} type="button">
                {saving ? "Saving…" : "Save photo"}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
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
        .84,
      );
    });
    return new File([blob], "staff-profile-photo.webp", { type: "image/webp" });
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
