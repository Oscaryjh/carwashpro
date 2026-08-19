import { randomUUID } from "crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "fs/promises";
import path from "path";

const EMPLOYEE_AVATAR_FILE_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.webp$/i;

export function getEmployeeAvatarUploadDirectory(
  uploadRoot = getRuntimeUploadRoot(),
) {
  return path.join(uploadRoot, "employee-avatars");
}

export async function writeRuntimeEmployeeAvatar({
  membershipId,
  bytes,
  uploadRoot,
}: {
  membershipId: string;
  bytes: Buffer;
  uploadRoot?: string;
}) {
  const directory = getEmployeeAvatarUploadDirectory(uploadRoot);
  await mkdir(directory, { recursive: true });

  const filename = `${membershipId}-${randomUUID()}.webp`;
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
    avatarUrl: `/uploads/employee-avatars/${filename}`,
    filename,
  };
}

export async function readRuntimeEmployeeAvatar(
  filename: string,
  uploadRoot?: string,
) {
  if (!EMPLOYEE_AVATAR_FILE_PATTERN.test(filename)) {
    return null;
  }

  const filePath = path.join(getEmployeeAvatarUploadDirectory(uploadRoot), filename);

  try {
    return await readFile(filePath);
  } catch (error) {
    if (isMissingFileError(error)) {
      return null;
    }

    throw error;
  }
}

export async function deleteRuntimeEmployeeAvatarByUrl(
  avatarUrl: string | null,
  uploadRoot?: string,
) {
  if (!avatarUrl) return;

  const prefix = "/uploads/employee-avatars/";
  if (!avatarUrl.startsWith(prefix)) return;

  const filename = avatarUrl.slice(prefix.length);
  if (!EMPLOYEE_AVATAR_FILE_PATTERN.test(filename)) return;

  await unlink(
    path.join(getEmployeeAvatarUploadDirectory(uploadRoot), filename),
  ).catch((error: unknown) => {
    if (!isMissingFileError(error)) throw error;
  });
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
