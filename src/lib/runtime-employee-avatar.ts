import { createHash, randomUUID } from "crypto";
import { readFile } from "fs/promises";
import path from "path";
import { getEmployeeAvatarObjectStore } from "./employee-avatar-s3";

const EMPLOYEE_AVATAR_FILE_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.webp$/i;
const NEW_EMPLOYEE_AVATAR_FILE_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.webp$/i;

export interface EmployeeAvatarObjectStore {
  put(filename: string, bytes: Buffer): Promise<void>;
  read(filename: string): Promise<Buffer | null>;
  delete(filename: string): Promise<void>;
}

export function isLegacyEmployeeAvatarFilename(filename: string): boolean {
  return EMPLOYEE_AVATAR_FILE_PATTERN.test(filename);
}

export function isEmployeeAvatarFilename(filename: string): boolean {
  return isLegacyEmployeeAvatarFilename(filename) || NEW_EMPLOYEE_AVATAR_FILE_PATTERN.test(filename);
}

export function getEmployeeAvatarUploadDirectory(
  uploadRoot = getRuntimeUploadRoot(),
) {
  return path.join(uploadRoot, "employee-avatars");
}

export async function writeRuntimeEmployeeAvatar({
  membershipId,
  bytes,
  uploadRoot,
  objectStore,
}: {
  membershipId: string;
  bytes: Buffer;
  uploadRoot?: string;
  objectStore?: EmployeeAvatarObjectStore;
}) {
  void membershipId;
  void uploadRoot;
  const filename = `${randomUUID()}.webp`;
  const store = objectStore ?? getEmployeeAvatarObjectStore();
  await store.put(filename, bytes);
  try {
    const persisted = await store.read(filename);
    if (!persisted || createHash("sha256").update(persisted).digest("hex") !==
        createHash("sha256").update(bytes).digest("hex")) {
      throw new Error("Avatar storage integrity verification failed");
    }
  } catch (error) {
    await store.delete(filename).catch(() => undefined);
    throw error;
  }
  return { avatarUrl: `/uploads/employee-avatars/${filename}`, filename };
}

export async function readRuntimeEmployeeAvatar(
  filename: string,
  uploadRoot?: string,
  objectStore?: EmployeeAvatarObjectStore,
) {
  if (!isEmployeeAvatarFilename(filename)) {
    return null;
  }

  const sharedStore = objectStore ?? (uploadRoot ? null : getEmployeeAvatarObjectStore());
  if (sharedStore) {
    const bytes = await sharedStore.read(filename);
    if (bytes || !isLegacyEmployeeAvatarFilename(filename)) return bytes;
  }

  if (!isLegacyEmployeeAvatarFilename(filename)) return null;

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
  _uploadRoot?: string,
  objectStore?: EmployeeAvatarObjectStore,
) {
  if (!avatarUrl) return;

  const prefix = "/uploads/employee-avatars/";
  if (!avatarUrl.startsWith(prefix)) return;

  const filename = avatarUrl.slice(prefix.length);
  if (!NEW_EMPLOYEE_AVATAR_FILE_PATTERN.test(filename)) return;
  await (objectStore ?? getEmployeeAvatarObjectStore()).delete(filename);
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
