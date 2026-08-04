import { randomUUID } from "crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "fs/promises";
import path from "path";

export type BusinessLogoExtension = "jpg" | "png" | "webp";

const BUSINESS_LOGO_FILE_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|png|webp)$/i;

const CONTENT_TYPES: Record<BusinessLogoExtension, string> = {
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

export type RuntimeBusinessLogo = {
  bytes: Buffer;
  contentType: string;
};

export function getBusinessLogoUploadDirectory(uploadRoot = getRuntimeUploadRoot()) {
  return path.join(uploadRoot, "business-logos");
}

export async function writeRuntimeBusinessLogo({
  businessId,
  bytes,
  extension,
  uploadRoot,
}: {
  businessId: string;
  bytes: Buffer;
  extension: BusinessLogoExtension;
  uploadRoot?: string;
}) {
  const directory = getBusinessLogoUploadDirectory(uploadRoot);
  await mkdir(directory, { recursive: true });

  const filename = `${businessId}-${randomUUID()}.${extension}`;
  const filePath = path.join(directory, filename);
  const temporaryPath = `${filePath}.${randomUUID()}.uploading`;

  try {
    await writeFile(temporaryPath, bytes, { flag: "wx" });
    await rename(temporaryPath, filePath);
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }

  return {
    filename,
    logoUrl: `/uploads/business-logos/${filename}`,
  };
}

export async function readRuntimeBusinessLogo(
  filename: string,
  uploadRoot?: string,
): Promise<RuntimeBusinessLogo | null> {
  const match = BUSINESS_LOGO_FILE_PATTERN.exec(filename);

  if (!match) {
    return null;
  }

  const extension = match[1].toLowerCase() as BusinessLogoExtension;
  const filePath = path.join(getBusinessLogoUploadDirectory(uploadRoot), filename);

  try {
    return {
      bytes: await readFile(filePath),
      contentType: CONTENT_TYPES[extension],
    };
  } catch (error) {
    if (isMissingFileError(error)) {
      return null;
    }

    throw error;
  }
}

function getRuntimeUploadRoot() {
  return path.join(process.cwd(), "public", "uploads");
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}
