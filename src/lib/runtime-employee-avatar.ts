import { deletePublicImageByUrl, getPublicImageDirectory, readPublicImage, writePublicImage } from "./runtime-public-images";

export function getEmployeeAvatarUploadDirectory(uploadRoot?: string) {
  return getPublicImageDirectory("employee-avatars", uploadRoot);
}

export async function writeRuntimeEmployeeAvatar({ membershipId, bytes, uploadRoot }: {
  membershipId: string; bytes: Buffer; uploadRoot?: string;
}) {
  const saved = await writePublicImage({ namespace: "employee-avatars", ownerId: membershipId, bytes, extension: "webp", uploadRoot });
  return { filename: saved.filename, avatarUrl: saved.url };
}

export async function readRuntimeEmployeeAvatar(filename: string, uploadRoot?: string, allowLegacy = true) {
  return (await readPublicImage("employee-avatars", filename, uploadRoot, allowLegacy))?.bytes ?? null;
}

export async function deleteRuntimeEmployeeAvatarByUrl(avatarUrl: string | null, uploadRoot?: string) {
  return deletePublicImageByUrl("employee-avatars", avatarUrl, uploadRoot);
}
