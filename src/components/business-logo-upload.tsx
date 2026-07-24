"use client";

import { useEffect, useState } from "react";
import { useFormStatus } from "react-dom";

const LOGO_MAX_BYTES = 2 * 1024 * 1024;
const LOGO_MAX_DIMENSION = 1200;
const LOGO_QUALITY_STEPS = [0.86, 0.78, 0.7, 0.62, 0.54];

type BusinessLogoUploadProps = {
  businessName: string;
  currentLogoUrl?: string | null;
  variant?: "standard" | "hero";
};

export function BusinessLogoUpload({
  businessName,
  currentLogoUrl,
  variant = "standard",
}: BusinessLogoUploadProps) {
  const { pending } = useFormStatus();
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState("");
  const [isCompressing, setIsCompressing] = useState(false);

  useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  async function handleChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }

    if (!file) {
      setPreviewUrl(null);
      setFileName("");
      setError("");
      setIsCompressing(false);
      return;
    }

    setError("");

    if (file.size > LOGO_MAX_BYTES) {
      setIsCompressing(true);

      try {
        const compressedFile = await compressLogo(file);
        const transfer = new DataTransfer();
        transfer.items.add(compressedFile);
        event.target.files = transfer.files;

        setPreviewUrl(URL.createObjectURL(compressedFile));
        setFileName(
          `${file.name} compressed to ${formatFileSize(compressedFile.size)}`,
        );
      } catch {
        event.target.value = "";
        setPreviewUrl(null);
        setFileName("");
        setError("Unable to compress this image. Please choose another logo.");
      } finally {
        setIsCompressing(false);
      }

      return;
    }

    setPreviewUrl(URL.createObjectURL(file));
    setFileName(file.name);
  }

  const imageUrl = previewUrl ?? currentLogoUrl;
  const statusMessage =
    error ||
    (isCompressing
      ? "Compressing logo..."
      : pending
        ? "Uploading logo..."
        : fileName
          ? `${fileName}. Click Save to upload.`
          : currentLogoUrl
            ? "Current logo is displayed."
            : "PNG, JPG, or WebP. Large images are compressed automatically.");

  if (variant === "hero") {
    return (
      <div className="business-logo-hero-control">
        <label className="business-logo-hero-upload">
          <span className="sr-only">Change company logo</span>
          <span className="company-settings-identity-logo">
            {imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={imageUrl} alt={`${businessName} logo preview`} />
            ) : (
              <span>{getInitials(businessName)}</span>
            )}
          </span>
          <span className="business-logo-edit-badge" aria-hidden="true">
            Edit
          </span>
          <input
            name="logo"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={handleChange}
          />
        </label>
        {error || fileName || isCompressing ? (
          <p className={error ? "business-logo-error" : undefined}>
            {statusMessage}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="business-logo-row">
      <div className="business-logo-preview">
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={imageUrl} alt={`${businessName} logo preview`} />
        ) : (
          <span>No logo</span>
        )}
      </div>
      <div className="business-logo-input">
        <label>
          <span>Upload logo</span>
          <input
            name="logo"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={handleChange}
          />
        </label>
        <p className={error ? "business-logo-error" : undefined}>
          {statusMessage}
        </p>
      </div>
    </div>
  );
}

function getInitials(name: string) {
  const initials = name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();

  return initials || "CO";
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
        return new File([blob], makeCompressedFileName(file.name), {
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

  if (!context) {
    throw new Error("Unable to compress image.");
  }

  context.clearRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);

  for (const quality of LOGO_QUALITY_STEPS) {
    const blob = await canvasToBlob(canvas, "image/webp", quality);

    if (blob.size <= LOGO_MAX_BYTES) {
      return blob;
    }
  }

  return canvasToBlob(canvas, "image/webp", LOGO_QUALITY_STEPS.at(-1) ?? 0.54);
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error("Unable to compress image."));
        }
      },
      type,
      quality,
    );
  });
}

function makeCompressedFileName(fileName: string) {
  const normalized = fileName.replace(/\.[^.]+$/, "");
  return `${normalized || "logo"}-compressed.webp`;
}

function formatFileSize(bytes: number) {
  return `${(bytes / (1024 * 1024)).toFixed(2)}MB`;
}

type BusinessSubmitButtonProps = {
  idleLabel: string;
};

export function BusinessSubmitButton({ idleLabel }: BusinessSubmitButtonProps) {
  const { pending } = useFormStatus();

  return (
    <button type="submit" disabled={pending}>
      {pending ? "Saving..." : idleLabel}
    </button>
  );
}
