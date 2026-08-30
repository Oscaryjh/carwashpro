import { createHash } from "node:crypto";
import path from "node:path";

export const CLAIM_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;

export const CLAIM_ATTACHMENT_ALLOWED_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
] as const;

export type ClaimAttachmentMimeType =
  (typeof CLAIM_ATTACHMENT_ALLOWED_MIME_TYPES)[number];

export type ClaimAttachmentMalwareStatus =
  | "NOT_SCANNED"
  | "PENDING"
  | "CLEAN"
  | "INFECTED"
  | "ERROR";

export type ClaimAttachmentPrivacyMetadataStatus =
  | "NOT_CHECKED"
  | "DETECTED"
  | "SANITIZED"
  | "SAFE";

export type ValidatedClaimAttachment = Readonly<{
  bytes: Buffer;
  byteLength: number;
  checksumSha256: string;
  detectedMimeType: ClaimAttachmentMimeType;
  extension: "jpg" | "png" | "webp" | "pdf";
  sanitizedFileName: string;
  malwareStatus: "NOT_SCANNED";
  privacyMetadataStatus: "NOT_CHECKED" | "DETECTED";
  disposition: "QUARANTINED";
}>;

export class ClaimAttachmentSecurityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClaimAttachmentSecurityError";
  }
}

export function validateClaimAttachment(input: {
  bytes: Uint8Array;
  claimedMimeType: string;
  originalFileName: string;
}): ValidatedClaimAttachment {
  const bytes = Buffer.from(input.bytes);

  if (bytes.length === 0) {
    throw new ClaimAttachmentSecurityError("Claim attachment is empty.");
  }
  if (bytes.length > CLAIM_ATTACHMENT_MAX_BYTES) {
    throw new ClaimAttachmentSecurityError(
      "Claim attachment must be 10MB or smaller.",
    );
  }

  const detected = detectClaimAttachmentType(bytes);
  if (!detected) {
    throw new ClaimAttachmentSecurityError(
      "Claim attachment must be a valid JPG, PNG, WebP, or PDF file.",
    );
  }
  if (input.claimedMimeType !== detected.mimeType) {
    throw new ClaimAttachmentSecurityError(
      "Claim attachment content does not match its declared file type.",
    );
  }

  return {
    bytes,
    byteLength: bytes.length,
    checksumSha256: createHash("sha256").update(bytes).digest("hex"),
    detectedMimeType: detected.mimeType,
    extension: detected.extension,
    sanitizedFileName: sanitizeClaimAttachmentFileName(
      input.originalFileName,
      detected.extension,
    ),
    malwareStatus: "NOT_SCANNED",
    privacyMetadataStatus: containsPotentialPrivacyMetadata(
      bytes,
      detected.mimeType,
    )
      ? "DETECTED"
      : "NOT_CHECKED",
    disposition: "QUARANTINED",
  };
}

export function assertClaimAttachmentCanBeReleased(input: {
  malwareStatus: ClaimAttachmentMalwareStatus;
  privacyMetadataStatus: ClaimAttachmentPrivacyMetadataStatus;
}) {
  if (input.malwareStatus !== "CLEAN") {
    throw new ClaimAttachmentSecurityError(
      "Claim attachment cannot be released before a clean malware scan.",
    );
  }
  if (
    input.privacyMetadataStatus !== "SAFE" &&
    input.privacyMetadataStatus !== "SANITIZED"
  ) {
    throw new ClaimAttachmentSecurityError(
      "Claim attachment cannot be released before privacy metadata review.",
    );
  }
}

export function sanitizeClaimAttachmentFileName(
  originalFileName: string,
  extension: ValidatedClaimAttachment["extension"],
) {
  const baseName = path
    .basename(originalFileName || "receipt")
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\.[^.]*$/, "")
    .replace(/[^\p{L}\p{N}._ -]+/gu, "-")
    .replace(/\s+/g, " ")
    .replace(/^[. _-]+|[. _-]+$/g, "")
    .slice(0, 100);

  return `${baseName || "receipt"}.${extension}`;
}

function detectClaimAttachmentType(bytes: Buffer):
  | {
      mimeType: ClaimAttachmentMimeType;
      extension: ValidatedClaimAttachment["extension"];
    }
  | null {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) {
    return { mimeType: "image/jpeg", extension: "jpg" };
  }
  if (
    startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  ) {
    return { mimeType: "image/png", extension: "png" };
  }
  if (
    startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    matchesAt(bytes, 8, [0x57, 0x45, 0x42, 0x50])
  ) {
    return { mimeType: "image/webp", extension: "webp" };
  }
  if (
    startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d]) &&
    bytes.subarray(Math.max(0, bytes.length - 1024)).includes("%%EOF")
  ) {
    return { mimeType: "application/pdf", extension: "pdf" };
  }
  return null;
}

function containsPotentialPrivacyMetadata(
  bytes: Buffer,
  mimeType: ClaimAttachmentMimeType,
) {
  if (mimeType === "image/jpeg") {
    return bytes.includes(Buffer.from("Exif\0\0", "binary"));
  }
  if (mimeType === "image/png") {
    return ["eXIf", "tEXt", "iTXt", "zTXt"].some((chunk) =>
      bytes.includes(Buffer.from(chunk, "ascii")),
    );
  }
  if (mimeType === "image/webp") {
    return ["EXIF", "XMP "].some((chunk) =>
      bytes.includes(Buffer.from(chunk, "ascii")),
    );
  }
  return ["/Author", "/Creator", "/Producer", "<x:xmpmeta"].some(
    (marker) => bytes.includes(Buffer.from(marker, "utf8")),
  );
}

function startsWith(bytes: Uint8Array, signature: number[]) {
  return matchesAt(bytes, 0, signature);
}

function matchesAt(bytes: Uint8Array, offset: number, signature: number[]) {
  return signature.every((byte, index) => bytes[offset + index] === byte);
}
