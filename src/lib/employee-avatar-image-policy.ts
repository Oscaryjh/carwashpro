import sharp, { type Metadata } from "sharp";
import { HEIC_UNSUPPORTED_MESSAGE, staffAvatarFormatError } from "./staff-avatar-format";

const MAX_INPUT_PIXELS = 40_000_000;
const mimeToFormat: Record<string, string> = {
  "image/jpeg": "jpeg",
  "image/jpg": "jpeg",
  "image/png": "png",
  "image/webp": "webp",
  "image/avif": "heif",
  "image/heif": "heif",
};
const extensionToFormat: Record<string, string> = {
  jpg: "jpeg", jpeg: "jpeg", png: "png", webp: "webp", avif: "heif", heif: "heif",
};

export async function normalizeEmployeeAvatarImage(input: Buffer, mimeType: string, filename = ""): Promise<Buffer> {
  const formatError = staffAvatarFormatError(mimeType, filename);
  if (formatError) throw new Error(formatError);
  const expected = mimeToFormat[mimeType.toLowerCase()];
  if (!expected) throw new Error("Unsupported avatar format");
  const extension = /\.([a-z0-9]+)$/i.exec(filename)?.[1]?.toLowerCase();
  if (extension && extensionToFormat[extension] !== expected) throw new Error("Avatar file type does not match its contents");

  let metadata: Metadata;
  try {
    metadata = await sharp(input, { failOn: "warning", limitInputPixels: MAX_INPUT_PIXELS }).metadata();
  } catch {
    throw new Error("This photo could not be processed. Choose another photo.");
  }
  if (metadata.format === "heif" && metadata.compression === "hevc") throw new Error(HEIC_UNSUPPORTED_MESSAGE);
  if (metadata.format !== expected || (metadata.format === "heif" && metadata.compression !== "av1")) {
    throw new Error("Avatar file type does not match its contents");
  }
  try {
    return await sharp(input, { failOn: "warning", limitInputPixels: MAX_INPUT_PIXELS })
      .rotate()
      .resize(512, 512, { fit: "cover", position: "attention" })
      .webp({ quality: 84 })
      .toBuffer();
  } catch {
    throw new Error("This photo could not be processed. Choose another photo.");
  }
}
