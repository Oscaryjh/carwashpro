export const STAFF_AVATAR_ACCEPT = "image/jpeg,image/png,image/webp,image/avif,image/heif";
export const HEIC_UNSUPPORTED_MESSAGE = "HEIC is not supported yet. Please use JPEG, PNG, WebP or AVIF.";

const supportedMimeTypes = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/avif",
  "image/heif",
]);

export function staffAvatarFormatError(mimeType: string, filename = ""): string | null {
  const normalized = mimeType.toLowerCase();
  if (normalized === "image/heic" || normalized === "image/heic-sequence" || /\.heic$/i.test(filename)) {
    return HEIC_UNSUPPORTED_MESSAGE;
  }
  return supportedMimeTypes.has(normalized)
    ? null
    : "Use a JPEG, PNG, WebP or AVIF photo.";
}
