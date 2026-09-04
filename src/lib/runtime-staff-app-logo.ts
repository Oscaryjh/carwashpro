import { getPublicImageDirectory, readPublicImage, writePublicImage, type PublicImage, type PublicImageExtension } from "./runtime-public-images";

export type StaffAppLogoExtension = PublicImageExtension;
export type RuntimeStaffAppLogo = PublicImage;

export function getStaffAppLogoUploadDirectory(uploadRoot?: string) {
  return getPublicImageDirectory("staff-app-logos", uploadRoot);
}

export async function writeRuntimeStaffAppLogo({ businessId, bytes, extension, uploadRoot }: {
  businessId: string; bytes: Buffer; extension: StaffAppLogoExtension; uploadRoot?: string;
}) {
  const saved = await writePublicImage({ namespace: "staff-app-logos", ownerId: businessId, bytes, extension, uploadRoot });
  return { filename: saved.filename, logoUrl: saved.url };
}

export async function readRuntimeStaffAppLogo(filename: string, uploadRoot?: string, allowLegacy = true) {
  return readPublicImage("staff-app-logos", filename, uploadRoot, allowLegacy);
}
