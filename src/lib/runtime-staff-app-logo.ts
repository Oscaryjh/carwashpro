import { randomUUID } from "crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "fs/promises";
import path from "path";

export type StaffAppLogoExtension = "jpg" | "png" | "webp";

const STAFF_APP_LOGO_FILE_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|png|webp)$/i;

const CONTENT_TYPES: Record<StaffAppLogoExtension, string> = {
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

export type RuntimeStaffAppLogo = {
  bytes: Buffer;
  contentType: string;
};

export function getStaffAppLogoUploadDirectory(uploadRoot = getRuntimeUploadRoot()) {
  return path.join(uploadRoot, "staff-app-logos");
}

export async function writeRuntimeStaffAppLogo({
  businessId,
  bytes,
  extension,
  uploadRoot,
}: {
  businessId: string;
  bytes: Buffer;
  extension: StaffAppLogoExtension;
  uploadRoot?: string;
}) {
  const directory = getStaffAppLogoUploadDirectory(uploadRoot);
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
    logoUrl: `/uploads/staff-app-logos/${filename}`,
  };
}

export async function readRuntimeStaffAppLogo(
  filename: string,
  uploadRoot?: string,
): Promise<RuntimeStaffAppLogo | null> {
  const match = STAFF_APP_LOGO_FILE_PATTERN.exec(filename);
  if (!match) return null;

  const extension = match[1].toLowerCase() as StaffAppLogoExtension;
  const filePath = path.join(getStaffAppLogoUploadDirectory(uploadRoot), filename);

  try {
    return {
      bytes: await readFile(filePath),
      contentType: CONTENT_TYPES[extension],
    };
  } catch (error) {
    if (isMissingFileError(error)) return null;
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

