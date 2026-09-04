import { GetObjectCommand, PutObjectCommand, DeleteObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

export type PublicImageNamespace = "employee-avatars" | "business-logos" | "staff-app-logos";
export type PublicImageExtension = "jpg" | "png" | "webp";
export type PublicImage = { bytes: Buffer; contentType: string };
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const ID_PATTERN = new RegExp(`^${UUID}$`, "i");
const FILE_PATTERN = new RegExp(`^${UUID}-${UUID}\\.(jpg|png|webp)$`, "i");
const NAMESPACES = new Set(["employee-avatars", "business-logos", "staff-app-logos"]);
const TYPES = { jpg: "image/jpeg", png: "image/png", webp: "image/webp" } as const;
const MAX_BYTES = 5 * 1024 * 1024;
type Environment = Record<string, string | undefined>;

export function publicImageContentType(namespace: PublicImageNamespace, filename: string) {
  if (!NAMESPACES.has(namespace)) return null;
  const match = FILE_PATTERN.exec(filename);
  if (!match) return null;
  const extension = match[1].toLowerCase() as PublicImageExtension;
  if (namespace === "employee-avatars" && extension !== "webp") return null;
  return TYPES[extension];
}

function configuredOrigin(value: string | undefined) {
  if (!value) return null;
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new Error("Public image origins must be HTTPS origins without credentials or paths.");
  }
  return url.origin;
}

export function getPublicImageStorageConfig(env: Environment = process.env) {
  const provider = env.PUBLIC_IMAGE_STORAGE_PROVIDER;
  if (!provider || provider === "local") return null;
  if (provider !== "s3") throw new Error("Unsupported public image storage provider.");
  const required = (name: string) => {
    const value = env[name]?.trim();
    if (!value) throw new Error(`Missing public image configuration: ${name}`);
    return value;
  };
  const endpoint = configuredOrigin(required("PUBLIC_IMAGE_S3_ENDPOINT"))!;
  const prefix = required("PUBLIC_IMAGE_S3_PREFIX").replace(/\/$/, "");
  // Never expose arbitrary objects or share the private receipt/evidence namespace.
  if (!/^public-images\/(local|testing|production)\/v[1-9][0-9]*$/.test(prefix)) {
    throw new Error("Public image storage requires its isolated public-images environment prefix.");
  }
  const environment = env.APP_ENVIRONMENT || env.RAILWAY_ENVIRONMENT_NAME;
  if (environment && !prefix.startsWith(`public-images/${environment}/`)) {
    throw new Error("Public image storage environment mismatch.");
  }
  const baseUrl = configuredOrigin(required("PUBLIC_IMAGE_BASE_URL"))!;
  return {
    endpoint, prefix, baseUrl,
    region: env.PUBLIC_IMAGE_S3_REGION || "auto",
    bucket: required("PUBLIC_IMAGE_S3_BUCKET"),
    accessKeyId: required("PUBLIC_IMAGE_S3_ACCESS_KEY_ID"),
    secretAccessKey: required("PUBLIC_IMAGE_S3_SECRET_ACCESS_KEY"),
    forcePathStyle: env.PUBLIC_IMAGE_S3_FORCE_PATH_STYLE === "true",
  };
}

function storage() {
  const config = getPublicImageStorageConfig();
  if (!config) return null;
  const client = new S3Client({
    endpoint: config.endpoint, region: config.region, forcePathStyle: config.forcePathStyle,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    maxAttempts: 2,
  });
  return { config, client };
}

export function getPublicImageDirectory(namespace: PublicImageNamespace, uploadRoot?: string) {
  if (!NAMESPACES.has(namespace)) throw new Error("Invalid public image namespace.");
  return path.join(uploadRoot ?? path.join(process.cwd(), "public", "uploads"), namespace);
}

export async function writePublicImage(input: {
  namespace: PublicImageNamespace; ownerId: string; bytes: Buffer;
  extension: PublicImageExtension; uploadRoot?: string;
}) {
  const { namespace, ownerId, bytes, extension, uploadRoot } = input;
  const filename = `${ownerId}-${randomUUID()}.${extension}`;
  const contentType = publicImageContentType(namespace, filename);
  if (!ID_PATTERN.test(ownerId) || !contentType || !bytes.length || bytes.length > MAX_BYTES) {
    throw new Error("Invalid public image upload.");
  }
  const store = uploadRoot === undefined ? storage() : null;
  const relativeUrl = `/uploads/${namespace}/${filename}`;
  if (store) {
    try {
      await store.client.send(new PutObjectCommand({
        Bucket: store.config.bucket, Key: `${store.config.prefix}/${namespace}/${filename}`,
        Body: bytes, ContentType: contentType, CacheControl: "public, max-age=31536000, immutable",
        IfNoneMatch: "*",
      }), { abortSignal: AbortSignal.timeout(15000) });
      // An absolute serving URL also works in older POS deployments sharing the database.
      return { filename, url: `${store.config.baseUrl}${relativeUrl}` };
    } finally { store.client.destroy(); }
  }
  const directory = getPublicImageDirectory(namespace, uploadRoot);
  if (uploadRoot === undefined && process.env.RAILWAY_ENVIRONMENT_ID) {
    const mount = process.env.RAILWAY_VOLUME_MOUNT_PATH;
    const relative = mount && path.isAbsolute(mount) ? path.relative(mount, directory) : null;
    if (relative === null || relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error("Persistent public image storage is required before accepting uploads on Railway.");
    }
  }
  await mkdir(directory, { recursive: true });
  const filePath = path.join(directory, filename);
  const temporaryPath = `${filePath}.${randomUUID()}.uploading`;
  try {
    await writeFile(temporaryPath, bytes, { flag: "wx" });
    await rename(temporaryPath, filePath);
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
  return { filename, url: relativeUrl };
}

export async function readLegacyPublicImage(
  namespace: PublicImageNamespace, filename: string,
  options: { env?: Environment; fetcher?: typeof fetch } = {},
): Promise<PublicImage | null> {
  const contentType = publicImageContentType(namespace, filename);
  if (!contentType) return null;
  const env = options.env ?? process.env;
  const origin = configuredOrigin(env.PUBLIC_IMAGE_LEGACY_ORIGIN);
  if (!origin || origin === configuredOrigin(env.PUBLIC_IMAGE_BASE_URL)) return null;
  const response = await (options.fetcher ?? fetch)(`${origin}/uploads/${namespace}/${filename}`, {
    redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(8000),
    // Routes receiving a fallback request must not forward it to another service.
    headers: { "x-tetamu-image-fallback": "1" },
  });
  if (response.status === 404) return null;
  if (response.status !== 200 || response.headers.get("content-type")?.split(";")[0] !== contentType) {
    throw new Error("Legacy public image source returned an invalid response.");
  }
  const bytes = await readBoundedImage(response.body, Number(response.headers.get("content-length") || 0));
  if (!matchesImageSignature(bytes, contentType)) throw new Error("Invalid legacy public image content.");
  return { bytes, contentType };
}

async function readBoundedImage(stream: ReadableStream<Uint8Array> | null, declaredLength: number) {
  if (!stream) throw new Error("Empty public image response.");
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    if (declaredLength > MAX_BYTES) throw new Error("Public image exceeds size limit.");
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BYTES) throw new Error("Public image exceeds size limit.");
      chunks.push(value);
    }
    if (!total) throw new Error("Empty public image response.");
    return Buffer.concat(chunks);
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally { reader.releaseLock(); }
}

function matchesImageSignature(bytes: Buffer, contentType: string) {
  if (contentType === "image/jpeg") return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (contentType === "image/png") return bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"));
  return bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WEBP";
}

export async function readPublicImage(
  namespace: PublicImageNamespace, filename: string, uploadRoot?: string, allowLegacy = true,
): Promise<PublicImage | null> {
  const contentType = publicImageContentType(namespace, filename);
  if (!contentType) return null;
  const store = uploadRoot === undefined ? storage() : null;
  if (store) {
    try {
      const object = await store.client.send(new GetObjectCommand({
        Bucket: store.config.bucket, Key: `${store.config.prefix}/${namespace}/${filename}`,
      }), { abortSignal: AbortSignal.timeout(15000) });
      if (!object.Body || object.ContentType !== contentType) throw new Error("Invalid stored public image metadata.");
      const bytes = await readBoundedImage(object.Body.transformToWebStream(), object.ContentLength ?? 0);
      if (!matchesImageSignature(bytes, contentType)) throw new Error("Invalid stored public image content.");
      return { bytes, contentType };
    } catch (error) {
      // Only a missing key may fall back. Permission and availability failures must remain visible.
      if (!(error instanceof Error) || error.name !== "NoSuchKey") throw error;
    } finally { store.client.destroy(); }
  }
  try {
    return { bytes: await readFile(path.join(getPublicImageDirectory(namespace, uploadRoot), filename)), contentType };
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
  }
  return uploadRoot === undefined && allowLegacy ? readLegacyPublicImage(namespace, filename) : null;
}

export async function deletePublicImageByUrl(namespace: PublicImageNamespace, url: string | null, uploadRoot?: string) {
  if (!url) return;
  const base = configuredOrigin(process.env.PUBLIC_IMAGE_BASE_URL);
  let relative = url;
  if (url.startsWith("https://")) {
    const parsed = new URL(url);
    if (!base || parsed.origin !== base || parsed.search || parsed.hash) return;
    relative = parsed.pathname;
  }
  const prefix = `/uploads/${namespace}/`;
  if (!relative.startsWith(prefix)) return;
  const filename = relative.slice(prefix.length);
  if (!publicImageContentType(namespace, filename)) return;
  const store = uploadRoot === undefined ? storage() : null;
  if (store) {
    try {
      await store.client.send(new DeleteObjectCommand({ Bucket: store.config.bucket, Key: `${store.config.prefix}/${namespace}/${filename}` }),
        { abortSignal: AbortSignal.timeout(15000) });
    } finally { store.client.destroy(); }
  }
  await unlink(path.join(getPublicImageDirectory(namespace, uploadRoot), filename)).catch((error: unknown) => {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
  });
}
