export const GROUP_LOGO_MAX_BYTES = 2 * 1024 * 1024;

const GROUP_LOGO_EXTENSIONS = new Map([
  ["image/png", "png"],
  ["image/jpeg", "jpg"],
  ["image/webp", "webp"],
]);

export class GroupLogoValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GroupLogoValidationError";
  }
}

export async function readValidatedGroupLogo(
  fileEntry: FormDataEntryValue | null,
) {
  if (!fileEntry || typeof fileEntry === "string" || fileEntry.size === 0) {
    throw new GroupLogoValidationError("Please choose a logo image.");
  }

  if (fileEntry.size > GROUP_LOGO_MAX_BYTES) {
    throw new GroupLogoValidationError(
      "Logo file must be smaller than 2MB.",
    );
  }

  const buffer = Buffer.from(await fileEntry.arrayBuffer());
  const extension = detectGroupLogoExtension(buffer, fileEntry.type);

  if (!extension) {
    throw new GroupLogoValidationError(
      "Logo must be a valid PNG, JPG, or WebP image.",
    );
  }

  return {
    buffer,
    extension,
    mimeType: fileEntry.type,
    sizeBytes: fileEntry.size,
  };
}

export function detectGroupLogoExtension(
  buffer: Uint8Array,
  mimeType: string,
) {
  const extension = GROUP_LOGO_EXTENSIONS.get(mimeType);

  if (!extension) {
    return null;
  }

  if (
    mimeType === "image/png" &&
    startsWith(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  ) {
    return extension;
  }

  if (
    mimeType === "image/jpeg" &&
    startsWith(buffer, [0xff, 0xd8, 0xff])
  ) {
    return extension;
  }

  if (
    mimeType === "image/webp" &&
    startsWith(buffer, [0x52, 0x49, 0x46, 0x46]) &&
    matchesAt(buffer, 8, [0x57, 0x45, 0x42, 0x50])
  ) {
    return extension;
  }

  return null;
}

function startsWith(buffer: Uint8Array, signature: number[]) {
  return matchesAt(buffer, 0, signature);
}

function matchesAt(
  buffer: Uint8Array,
  offset: number,
  signature: number[],
) {
  return signature.every((byte, index) => buffer[offset + index] === byte);
}
