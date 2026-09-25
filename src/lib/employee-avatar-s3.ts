import { createHash } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { EmployeeAvatarObjectStore } from "./runtime-employee-avatar";

const AVATAR_FILENAME = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.webp$/i;
const LEGACY_AVATAR_FILENAME = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.webp$/i;
const MAX_STORED_AVATAR_BYTES = 4 * 1024 * 1024;
const AVATAR_STORAGE_TIMEOUT_MS = 15_000;

export interface EmployeeAvatarS3Config {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  objectPrefix: string;
  forcePathStyle?: boolean;
}

type AvatarS3Command = PutObjectCommand | GetObjectCommand | DeleteObjectCommand;
type AvatarS3Client = { send(command: AvatarS3Command, options?: { abortSignal?: AbortSignal }): Promise<unknown> };

export class S3EmployeeAvatarObjectStore implements EmployeeAvatarObjectStore {
  private readonly client: AvatarS3Client;
  private readonly bucket: string;
  private readonly prefix: string;

  constructor(config: EmployeeAvatarS3Config, options: { client?: AvatarS3Client } = {}) {
    assertSafeConfig(config);
    this.bucket = config.bucket;
    this.prefix = `${config.objectPrefix}/employee-avatars`;
    this.client = options.client ?? new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
      forcePathStyle: config.forcePathStyle ?? false,
      maxAttempts: 3,
    });
  }

  async put(filename: string, bytes: Buffer): Promise<void> {
    assertFilename(filename, false);
    if (!Buffer.isBuffer(bytes) || bytes.length === 0 || bytes.length > MAX_STORED_AVATAR_BYTES) {
      throw new Error("Invalid normalized avatar size");
    }
    await this.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: this.key(filename),
      Body: bytes,
      ContentType: "image/webp",
      ContentLength: bytes.length,
      IfNoneMatch: "*",
      Metadata: { sha256: sha256(bytes) },
    }));
  }

  async read(filename: string): Promise<Buffer | null> {
    assertFilename(filename, true);
    let response: unknown;
    try {
      response = await this.send(new GetObjectCommand({
        Bucket: this.bucket,
        Key: this.key(filename),
      }));
    } catch (error) {
      if (error instanceof Error && error.name === "NoSuchKey") return null;
      throw error;
    }
    const object = response as {
      ContentLength?: number;
      ContentType?: string;
      Metadata?: Record<string, string>;
      Body?: { transformToByteArray(): Promise<Uint8Array> };
    };
    if (!object.Body || object.ContentType !== "image/webp" ||
        typeof object.ContentLength !== "number" || object.ContentLength < 1 ||
        object.ContentLength > MAX_STORED_AVATAR_BYTES ||
        !/^[0-9a-f]{64}$/i.test(object.Metadata?.sha256 ?? "")) {
      throw new Error("Invalid stored avatar object");
    }
    const bytes = Buffer.from(await object.Body.transformToByteArray());
    if (bytes.length !== object.ContentLength || bytes.length > MAX_STORED_AVATAR_BYTES ||
        sha256(bytes) !== object.Metadata?.sha256?.toLowerCase()) {
      throw new Error("Stored avatar integrity check failed");
    }
    return bytes;
  }

  async delete(filename: string): Promise<void> {
    assertFilename(filename, false);
    await this.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: this.key(filename) }));
  }

  private async send(command: AvatarS3Command): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), AVATAR_STORAGE_TIMEOUT_MS);
    timer.unref?.();
    try {
      return await this.client.send(command, { abortSignal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  private key(filename: string): string {
    return `${this.prefix}/${filename}`;
  }
}

class PrivateFileEmployeeAvatarObjectStore implements EmployeeAvatarObjectStore {
  constructor(private readonly root: string) {
    const publicRoot = path.resolve(process.cwd(), "public");
    const resolved = path.resolve(root);
    if (resolved === publicRoot || resolved.startsWith(`${publicRoot}${path.sep}`)) {
      throw new Error("Avatar private storage cannot be inside public");
    }
  }

  async put(filename: string, bytes: Buffer): Promise<void> {
    assertFilename(filename, false);
    const directory = path.join(this.root, "employee-avatars");
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await writeFile(path.join(directory, filename), bytes, { flag: "wx", mode: 0o600 });
  }

  async read(filename: string): Promise<Buffer | null> {
    assertFilename(filename, true);
    try {
      const bytes = await readFile(path.join(this.root, "employee-avatars", filename));
      if (bytes.length === 0 || bytes.length > MAX_STORED_AVATAR_BYTES) throw new Error("Invalid stored avatar size");
      return bytes;
    } catch (error) {
      if (isNoEntry(error)) return null;
      throw error;
    }
  }

  async delete(filename: string): Promise<void> {
    assertFilename(filename, false);
    await unlink(path.join(this.root, "employee-avatars", filename)).catch((error: unknown) => {
      if (!isNoEntry(error)) throw error;
    });
  }
}

export function getEmployeeAvatarObjectStore(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): EmployeeAvatarObjectStore {
  const provider = environment.EMPLOYEE_AVATAR_STORAGE_PROVIDER?.trim();
  if (provider === "s3") {
    return new S3EmployeeAvatarObjectStore({
      endpoint: required(environment, "EMPLOYEE_AVATAR_STORAGE_S3_ENDPOINT"),
      region: required(environment, "EMPLOYEE_AVATAR_STORAGE_S3_REGION"),
      bucket: required(environment, "EMPLOYEE_AVATAR_STORAGE_S3_BUCKET"),
      accessKeyId: required(environment, "EMPLOYEE_AVATAR_STORAGE_S3_ACCESS_KEY_ID"),
      secretAccessKey: required(environment, "EMPLOYEE_AVATAR_STORAGE_S3_SECRET_ACCESS_KEY"),
      objectPrefix: required(environment, "EMPLOYEE_AVATAR_STORAGE_S3_PREFIX"),
      forcePathStyle: optionalBoolean(environment, "EMPLOYEE_AVATAR_STORAGE_S3_FORCE_PATH_STYLE", false),
    });
  }
  if (!provider && (environment.NODE_ENV === "development" || environment.NODE_ENV === "test") &&
      !environment.RAILWAY_ENVIRONMENT_NAME && !environment.APP_ENVIRONMENT) {
    return new PrivateFileEmployeeAvatarObjectStore(path.resolve(process.cwd(), ".runtime", "employee-avatar-private"));
  }
  throw new Error("Private avatar storage is not configured");
}

function assertFilename(filename: string, allowLegacy: boolean): void {
  if (!AVATAR_FILENAME.test(filename) && !(allowLegacy && LEGACY_AVATAR_FILENAME.test(filename))) {
    throw new Error("Invalid avatar filename");
  }
}

function assertSafeConfig(config: EmployeeAvatarS3Config): void {
  const endpoint = new URL(config.endpoint);
  if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password || endpoint.search || endpoint.hash ||
      endpoint.pathname !== "/" || !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/i.test(config.bucket) ||
      !/^[a-z0-9][a-z0-9-_]*$/i.test(config.region) ||
      !/^[a-z0-9][a-z0-9-]*(?:\/[a-z0-9][a-z0-9-]*)*$/i.test(config.objectPrefix) ||
      !config.accessKeyId.trim() || !config.secretAccessKey.trim()) {
    throw new Error("Invalid avatar storage configuration");
  }
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function required(environment: Readonly<Record<string, string | undefined>>, name: string): string {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function optionalBoolean(environment: Readonly<Record<string, string | undefined>>, name: string, fallback: boolean): boolean {
  const value = environment[name]?.trim();
  if (!value) return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`Invalid ${name}`);
}

function isNoEntry(error: unknown): boolean {
  return error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT";
}
