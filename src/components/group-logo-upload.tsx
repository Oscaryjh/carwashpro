"use client";

import { useRouter } from "next/navigation";
import {
  useActionState,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import {
  type GroupLogoUploadState,
  updateGroupLogoAction,
} from "@/app/(group)/group-logo-actions";
import "./group-logo-upload.css";

const LOGO_MAX_BYTES = 2 * 1024 * 1024;
const LOGO_MAX_DIMENSION = 1200;
const LOGO_QUALITY_STEPS = [0.86, 0.78, 0.7, 0.62, 0.54];
const ACCEPTED_LOGO_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
]);
const initialGroupLogoUploadState: GroupLogoUploadState = {
  status: "idle",
  message: "",
};

type GroupLogoUploadProps = {
  groupId: string;
  groupName: string;
  currentLogoUrl?: string | null;
  canEdit: boolean;
};

export function GroupLogoUpload({
  groupId,
  groupName,
  currentLogoUrl,
  canEdit,
}: GroupLogoUploadProps) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [state, formAction, pending] = useActionState(
    updateGroupLogoAction,
    initialGroupLogoUploadState,
  );
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [clientError, setClientError] = useState("");
  const [isPreparing, setIsPreparing] = useState(false);
  const [failedImageUrl, setFailedImageUrl] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (previewUrl?.startsWith("blob:")) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  useEffect(() => {
    if (state.status === "success") {
      setPreviewUrl(state.logoUrl ?? null);
      setClientError("");
      setFailedImageUrl(null);
      if (inputRef.current) inputRef.current.value = "";
      router.refresh();
    } else if (state.status === "error") {
      setPreviewUrl(null);
      if (inputRef.current) inputRef.current.value = "";
    }
  }, [router, state]);

  async function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    if (!file) return;

    setClientError("");
    setFailedImageUrl(null);

    if (!ACCEPTED_LOGO_TYPES.has(file.type)) {
      event.target.value = "";
      setClientError("Choose a PNG, JPG, or WebP image.");
      return;
    }

    setIsPreparing(true);

    try {
      const uploadFile =
        file.size > LOGO_MAX_BYTES ? await compressLogo(file) : file;
      const transfer = new DataTransfer();
      transfer.items.add(uploadFile);
      event.target.files = transfer.files;
      setPreviewUrl(URL.createObjectURL(uploadFile));
      formRef.current?.requestSubmit();
    } catch {
      event.target.value = "";
      setPreviewUrl(null);
      setClientError(
        "Unable to prepare this image. Please choose another logo.",
      );
    } finally {
      setIsPreparing(false);
    }
  }

  const selectedImageUrl = previewUrl ?? currentLogoUrl;
  const imageUrl =
    selectedImageUrl && selectedImageUrl !== failedImageUrl
      ? selectedImageUrl
      : null;
  const isBusy = isPreparing || pending;
  const message =
    clientError ||
    (state.status === "error" ? state.message : "") ||
    (isPreparing
      ? "Compressing logo..."
      : pending
        ? "Uploading logo..."
        : state.status === "success"
          ? state.message
          : canEdit
            ? "Click the logo to upload"
            : "");

  const logo = (
    <>
      {imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          className="group-logo-image"
          src={imageUrl}
          alt={`${groupName} logo`}
          onError={() => setFailedImageUrl(imageUrl)}
        />
      ) : (
        <div aria-hidden="true" className="brand-fallback group-logo-fallback">
          {getInitials(groupName)}
        </div>
      )}
      {canEdit && isBusy ? (
        <div
          aria-hidden="true"
          className="group-logo-edit-indicator busy"
        >
          <span className="group-logo-spinner" />
        </div>
      ) : null}
    </>
  );

  if (!canEdit) {
    return (
      <div className="group-logo-control group-logo-static" title={groupName}>
        {logo}
      </div>
    );
  }

  return (
    <form
      ref={formRef}
      action={formAction}
      className="group-logo-form"
      title={message}
    >
      <input name="groupId" type="hidden" value={groupId} />
      <label
        className="group-logo-control group-logo-upload"
        aria-label="Upload group logo"
      >
        {logo}
        <input
          ref={inputRef}
          accept="image/png,image/jpeg,image/webp"
          disabled={isBusy}
          name="logo"
          onChange={handleChange}
          type="file"
        />
      </label>
      <span className="sr-only" aria-live="polite">
        {message}
      </span>
      {clientError || state.status === "error" ? (
        <div className="group-logo-error" role="alert">
          {message}
        </div>
      ) : null}
    </form>
  );
}

function getInitials(name: string) {
  return (
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0])
      .join("")
      .toUpperCase() || "TP"
  );
}

async function compressLogo(file: File) {
  const imageUrl = URL.createObjectURL(file);

  try {
    const image = await loadImage(imageUrl);
    let { width, height } = image;
    const largestSide = Math.max(width, height);

    if (largestSide > LOGO_MAX_DIMENSION) {
      const scale = LOGO_MAX_DIMENSION / largestSide;
      width = Math.round(width * scale);
      height = Math.round(height * scale);
    }

    for (let attempt = 0; attempt < 4; attempt += 1) {
      const blob = await renderCompressedBlob(image, width, height);

      if (blob.size <= LOGO_MAX_BYTES) {
        return new File([blob], "group-logo-compressed.webp", {
          type: blob.type,
        });
      }

      width = Math.max(320, Math.round(width * 0.82));
      height = Math.max(320, Math.round(height * 0.82));
    }

    throw new Error("Compressed logo is still too large.");
  } finally {
    URL.revokeObjectURL(imageUrl);
  }
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Unable to read image."));
    image.src = src;
  });
}

async function renderCompressedBlob(
  image: HTMLImageElement,
  width: number,
  height: number,
) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");

  if (!context) throw new Error("Unable to compress image.");

  context.clearRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);

  for (const quality of LOGO_QUALITY_STEPS) {
    const blob = await canvasToBlob(canvas, quality);
    if (blob.size <= LOGO_MAX_BYTES) return blob;
  }

  return canvasToBlob(canvas, LOGO_QUALITY_STEPS.at(-1) ?? 0.54);
}

function canvasToBlob(canvas: HTMLCanvasElement, quality: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) =>
        blob
          ? resolve(blob)
          : reject(new Error("Unable to compress image.")),
      "image/webp",
      quality,
    );
  });
}
