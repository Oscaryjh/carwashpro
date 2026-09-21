import sharp from "sharp";

export const EMPLOYEE_AVATAR_CONTENT_TYPES = [
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/avif",
  "image/heic",
  "image/heif",
] as const;

export const MANAGED_EMPLOYEE_AVATAR_CONTENT_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

type AvatarImageValidationCode =
  | "UNSUPPORTED_TYPE"
  | "TOO_LARGE"
  | "PROCESSING_FAILED";

const CONTENT_TYPE_FORMATS: Readonly<Record<string, readonly string[]>> = {
  "image/jpeg": ["jpeg"],
  "image/jpg": ["jpeg"],
  "image/png": ["png"],
  "image/webp": ["webp"],
  "image/avif": ["heif", "avif"],
  "image/heic": ["heif"],
  "image/heif": ["heif"],
};

export class AvatarImageValidationError extends Error {
  constructor(readonly code: AvatarImageValidationCode) {
    super(code);
    this.name = "AvatarImageValidationError";
  }
}

export async function processEmployeeAvatarImage({
  input,
  contentType,
  maxBytes,
  allowedContentTypes = EMPLOYEE_AVATAR_CONTENT_TYPES,
}: {
  input: Buffer;
  contentType: string;
  maxBytes: number;
  allowedContentTypes?: readonly string[];
}) {
  if (!allowedContentTypes.includes(contentType)) {
    throw new AvatarImageValidationError("UNSUPPORTED_TYPE");
  }
  if (input.byteLength > maxBytes) {
    throw new AvatarImageValidationError("TOO_LARGE");
  }

  try {
    const options = {
      failOn: "warning" as const,
      limitInputPixels: 40_000_000,
    };
    const metadata = await sharp(input, options).metadata();
    if (!metadata.format || !CONTENT_TYPE_FORMATS[contentType]?.includes(metadata.format)) {
      throw new AvatarImageValidationError("PROCESSING_FAILED");
    }

    return await sharp(input, options)
      .rotate()
      .resize(512, 512, { fit: "cover", position: "attention" })
      .webp({ quality: 84 })
      .toBuffer();
  } catch (error) {
    if (error instanceof AvatarImageValidationError) throw error;
    throw new AvatarImageValidationError("PROCESSING_FAILED");
  }
}
