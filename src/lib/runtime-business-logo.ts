import { getPublicImageDirectory, readPublicImage, writePublicImage, type PublicImage, type PublicImageExtension } from "./runtime-public-images";

export type BusinessLogoExtension = PublicImageExtension;
export type RuntimeBusinessLogo = PublicImage;

export function getBusinessLogoUploadDirectory(uploadRoot?: string) {
  return getPublicImageDirectory("business-logos", uploadRoot);
}

export async function writeRuntimeBusinessLogo({ businessId, bytes, extension, uploadRoot }: {
  businessId: string; bytes: Buffer; extension: BusinessLogoExtension; uploadRoot?: string;
}) {
  const saved = await writePublicImage({ namespace: "business-logos", ownerId: businessId, bytes, extension, uploadRoot });
  return { filename: saved.filename, logoUrl: saved.url };
}

export async function readRuntimeBusinessLogo(filename: string, uploadRoot?: string, allowLegacy = true) {
  return readPublicImage("business-logos", filename, uploadRoot, allowLegacy);
}
