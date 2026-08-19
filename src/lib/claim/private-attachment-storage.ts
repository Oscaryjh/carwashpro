import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
  S3Client,
  type GetObjectCommandOutput,
  type HeadObjectCommandOutput,
  type PutObjectCommandOutput,
  type DeleteObjectCommandOutput,
} from "@aws-sdk/client-s3";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, realpath, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  CLAIM_ATTACHMENT_ALLOWED_MIME_TYPES,
  CLAIM_ATTACHMENT_MAX_BYTES,
  type ClaimAttachmentMimeType,
  type ValidatedClaimAttachment,
} from "./attachment-policy";

const CLAIM_OBJECT_KEY_PATTERN =
  /^(claim-receipts|leave-evidence)\/[0-9]{4}\/[0-9]{2}\/[0-9a-f-]{36}\.(jpg|png|webp|pdf)$/;
const CLAIM_S3_PREFIX_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,255}$/;
const CLAIM_S3_REQUEST_TIMEOUT_MS = 15_000;

export type QuarantinedClaimAttachmentMetadata = Readonly<{
  objectKey: string;
  byteLength: number;
  checksumSha256: string;
  mimeType: ClaimAttachmentMimeType;
  disposition: "QUARANTINED";
}>;

export type StoredPrivateClaimAttachment = Readonly<
  QuarantinedClaimAttachmentMetadata & {
    sanitizedFileName: string;
    publicUrl: null;
    signedUrl: null;
  }
>;

export type PrivateAttachmentNamespace =
  | "claim-receipts"
  | "leave-evidence";

export interface ClaimPrivateAttachmentStore {
  putQuarantined(
    attachment: ValidatedClaimAttachment,
    namespace?: PrivateAttachmentNamespace,
  ): Promise<StoredPrivateClaimAttachment>;
  getQuarantinedMetadata(
    objectKey: string,
  ): Promise<QuarantinedClaimAttachmentMetadata>;
  readQuarantined(input: {
    objectKey: string;
    expectedChecksumSha256: string;
  }): Promise<Buffer>;
  deleteQuarantined(objectKey: string): Promise<void>;
}

type ClaimS3Command = PutObjectCommand | HeadObjectCommand | GetObjectCommand | DeleteObjectCommand;
type ClaimS3Response =
  | PutObjectCommandOutput
  | HeadObjectCommandOutput
  | GetObjectCommandOutput
  | DeleteObjectCommandOutput;

export interface ClaimS3CommandClient {
  send(
    command: ClaimS3Command,
    options?: { abortSignal?: AbortSignal },
  ): Promise<ClaimS3Response>;
}

export class ClaimPrivateStorageConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClaimPrivateStorageConfigurationError";
  }
}

export class ClaimPrivateStorageIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClaimPrivateStorageIntegrityError";
  }
}

export class FileSystemClaimPrivateAttachmentStore
  implements ClaimPrivateAttachmentStore
{
  constructor(
    private readonly rootDirectory: string,
    private readonly options: {
      now?: () => Date;
      createId?: () => string;
      applicationRoot?: string;
    } = {},
  ) {}

  async putQuarantined(
    attachment: ValidatedClaimAttachment,
    namespace: PrivateAttachmentNamespace = "claim-receipts",
  ) {
    const root = await this.resolveSafeRoot();
    const objectKey = createPrivateObjectKey(
      attachment.extension,
      this.options.now?.() ?? new Date(),
      this.options.createId?.() ?? randomUUID(),
      namespace,
    );
    const filePath = resolveObjectPath(root, objectKey);

    await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
    await writeFile(filePath, attachment.bytes, { flag: "wx", mode: 0o600 });

    return storedAttachmentResult(attachment, objectKey);
  }

  async getQuarantinedMetadata(objectKey: string) {
    const root = await this.resolveSafeRoot();
    const filePath = resolveObjectPath(root, objectKey);
    const [details, bytes] = await Promise.all([stat(filePath), readFile(filePath)]);
    const checksumSha256 = sha256(bytes);

    return {
      objectKey,
      byteLength: details.size,
      checksumSha256,
      mimeType: mimeTypeFromObjectKey(objectKey),
      disposition: "QUARANTINED" as const,
    };
  }

  async readQuarantined(input: {
    objectKey: string;
    expectedChecksumSha256: string;
  }) {
    const root = await this.resolveSafeRoot();
    const filePath = resolveObjectPath(root, input.objectKey);
    const bytes = await readFile(filePath);
    assertExpectedChecksum(bytes, input.expectedChecksumSha256);
    return bytes;
  }

  async deleteQuarantined(objectKey: string) {
    const root = await this.resolveSafeRoot();
    await unlink(resolveObjectPath(root, objectKey));
  }

  private async resolveSafeRoot() {
    if (!path.isAbsolute(this.rootDirectory)) {
      throw new ClaimPrivateStorageConfigurationError(
        "CLAIM_PRIVATE_STORAGE_ROOT must be an absolute path.",
      );
    }

    await mkdir(this.rootDirectory, { recursive: true, mode: 0o700 });
    const root = await realpath(this.rootDirectory);
    const applicationRoot = path.resolve(
      this.options.applicationRoot ?? process.cwd(),
    );
    const publicRoot = await realpath(path.resolve(applicationRoot, "public"));

    if (isWithin(root, publicRoot)) {
      throw new ClaimPrivateStorageConfigurationError(
        "Claim private storage cannot be located inside the public directory.",
      );
    }
    return root;
  }
}

export class S3ClaimPrivateAttachmentStore
  implements ClaimPrivateAttachmentStore
{
  private readonly client: ClaimS3CommandClient;

  constructor(
    private readonly config: {
      endpoint: string;
      region: string;
      bucket: string;
      accessKeyId: string;
      secretAccessKey: string;
      objectPrefix: string;
      forcePathStyle?: boolean;
    },
    private readonly options: {
      now?: () => Date;
      createId?: () => string;
      client?: ClaimS3CommandClient;
    } = {},
  ) {
    validateS3Configuration(config);
    this.client =
      options.client ??
      (new S3Client({
        endpoint: config.endpoint,
        region: config.region,
        forcePathStyle: config.forcePathStyle ?? false,
        credentials: {
          accessKeyId: config.accessKeyId,
          secretAccessKey: config.secretAccessKey,
        },
        maxAttempts: 3,
      }) as unknown as ClaimS3CommandClient);
  }

  async putQuarantined(
    attachment: ValidatedClaimAttachment,
    namespace: PrivateAttachmentNamespace = "claim-receipts",
  ) {
    const objectKey = createPrivateObjectKey(
      attachment.extension,
      this.options.now?.() ?? new Date(),
      this.options.createId?.() ?? randomUUID(),
      namespace,
    );
    const storageKey = this.storageKey(objectKey);

    await this.send(
      new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: storageKey,
        Body: attachment.bytes,
        ContentLength: attachment.byteLength,
        ContentType: attachment.detectedMimeType,
        CacheControl: "private, no-store",
        IfNoneMatch: "*",
        Metadata: {
          checksumsha256: attachment.checksumSha256,
          disposition: "quarantined",
          detectedmimetype: attachment.detectedMimeType,
          bytelength: String(attachment.byteLength),
        },
      }),
    );

    const stored = await this.getQuarantinedMetadata(objectKey);
    if (
      stored.checksumSha256 !== attachment.checksumSha256 ||
      stored.byteLength !== attachment.byteLength ||
      stored.mimeType !== attachment.detectedMimeType
    ) {
      throw new ClaimPrivateStorageIntegrityError(
        "Private claim attachment metadata verification failed after upload.",
      );
    }

    return storedAttachmentResult(attachment, objectKey);
  }

  async getQuarantinedMetadata(objectKey: string) {
    const output = (await this.send(
      new HeadObjectCommand({
        Bucket: this.config.bucket,
        Key: this.storageKey(objectKey),
      }),
    )) as HeadObjectCommandOutput;

    const metadata = normalizeS3Metadata(output.Metadata);
    const byteLength = parseStoredByteLength(metadata.bytelength);
    const checksumSha256 = metadata.checksumsha256;
    const mimeType = metadata.detectedmimetype;

    if (
      metadata.disposition !== "quarantined" ||
      !checksumSha256 ||
      !/^[0-9a-f]{64}$/.test(checksumSha256) ||
      !isClaimAttachmentMimeType(mimeType) ||
      output.ContentLength !== byteLength ||
      output.ContentType !== mimeType ||
      byteLength <= 0 ||
      byteLength > CLAIM_ATTACHMENT_MAX_BYTES
    ) {
      throw new ClaimPrivateStorageIntegrityError(
        "Private claim attachment object metadata is invalid.",
      );
    }

    return {
      objectKey,
      byteLength,
      checksumSha256,
      mimeType,
      disposition: "QUARANTINED" as const,
    };
  }

  async readQuarantined(input: {
    objectKey: string;
    expectedChecksumSha256: string;
  }) {
    const metadata = await this.getQuarantinedMetadata(input.objectKey);
    if (metadata.checksumSha256 !== input.expectedChecksumSha256) {
      throw new ClaimPrivateStorageIntegrityError(
        "Private claim attachment checksum metadata does not match the expected value.",
      );
    }

    const output = (await this.send(
      new GetObjectCommand({
        Bucket: this.config.bucket,
        Key: this.storageKey(input.objectKey),
      }),
    )) as GetObjectCommandOutput;
    if (!output.Body || typeof output.Body.transformToByteArray !== "function") {
      throw new ClaimPrivateStorageIntegrityError(
        "Private claim attachment response body is unavailable.",
      );
    }

    const bytes = Buffer.from(await output.Body.transformToByteArray());
    if (bytes.length !== metadata.byteLength) {
      throw new ClaimPrivateStorageIntegrityError(
        "Private claim attachment byte length verification failed.",
      );
    }
    assertExpectedChecksum(bytes, input.expectedChecksumSha256);
    return bytes;
  }

  async deleteQuarantined(objectKey: string) {
    await this.send(new DeleteObjectCommand({
      Bucket: this.config.bucket,
      Key: this.storageKey(objectKey),
    }));
  }

  private storageKey(objectKey: string) {
    assertValidObjectKey(objectKey);
    return `${this.config.objectPrefix}/${objectKey}`;
  }

  private async send(command: ClaimS3Command) {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      CLAIM_S3_REQUEST_TIMEOUT_MS,
    );
    timeout.unref?.();
    try {
      return await this.client.send(command, {
        abortSignal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function getClaimPrivateAttachmentStore(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): ClaimPrivateAttachmentStore {
  const provider = environment.CLAIM_PRIVATE_STORAGE_PROVIDER?.trim();

  if (provider === "filesystem") {
    const root = environment.CLAIM_PRIVATE_STORAGE_ROOT?.trim();
    if (!root) {
      throw new ClaimPrivateStorageConfigurationError(
        "CLAIM_PRIVATE_STORAGE_ROOT is required for private claim attachments.",
      );
    }
    return new FileSystemClaimPrivateAttachmentStore(root);
  }

  if (provider === "s3") {
    return new S3ClaimPrivateAttachmentStore({
      endpoint: requiredEnvironmentValue(
        environment,
        "CLAIM_PRIVATE_STORAGE_S3_ENDPOINT",
      ),
      region:
        environment.CLAIM_PRIVATE_STORAGE_S3_REGION?.trim() || "auto",
      bucket: requiredEnvironmentValue(
        environment,
        "CLAIM_PRIVATE_STORAGE_S3_BUCKET",
      ),
      accessKeyId: requiredEnvironmentValue(
        environment,
        "CLAIM_PRIVATE_STORAGE_S3_ACCESS_KEY_ID",
      ),
      secretAccessKey: requiredEnvironmentValue(
        environment,
        "CLAIM_PRIVATE_STORAGE_S3_SECRET_ACCESS_KEY",
      ),
      objectPrefix: requiredEnvironmentValue(
        environment,
        "CLAIM_PRIVATE_STORAGE_S3_PREFIX",
      ),
      forcePathStyle:
        environment.CLAIM_PRIVATE_STORAGE_S3_FORCE_PATH_STYLE?.trim() ===
        "true",
    });
  }

  if (!provider && (environment.NODE_ENV === "development" || environment.NODE_ENV === "test")) {
    return new FileSystemClaimPrivateAttachmentStore(
      path.resolve(process.cwd(), ".runtime", "claim-private"),
    );
  }

  throw new ClaimPrivateStorageConfigurationError(
    "Claim private storage is not configured. Set an explicit supported provider.",
  );
}

function createPrivateObjectKey(
  extension: ValidatedClaimAttachment["extension"],
  now: Date,
  id: string,
  namespace: PrivateAttachmentNamespace,
) {
  const objectKey = [
    namespace,
    String(now.getUTCFullYear()).padStart(4, "0"),
    String(now.getUTCMonth() + 1).padStart(2, "0"),
    `${id}.${extension}`,
  ].join("/");
  assertValidObjectKey(objectKey);
  return objectKey;
}

function storedAttachmentResult(
  attachment: ValidatedClaimAttachment,
  objectKey: string,
): StoredPrivateClaimAttachment {
  return {
    objectKey,
    byteLength: attachment.byteLength,
    checksumSha256: attachment.checksumSha256,
    mimeType: attachment.detectedMimeType,
    sanitizedFileName: attachment.sanitizedFileName,
    disposition: "QUARANTINED",
    publicUrl: null,
    signedUrl: null,
  };
}

function validateS3Configuration(config: {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  objectPrefix: string;
}) {
  let endpoint: URL;
  try {
    endpoint = new URL(config.endpoint);
  } catch {
    throw new ClaimPrivateStorageConfigurationError(
      "Claim S3 endpoint must be a valid HTTPS URL.",
    );
  }
  if (
    endpoint.protocol !== "https:" ||
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash
  ) {
    throw new ClaimPrivateStorageConfigurationError(
      "Claim S3 endpoint must use HTTPS and must not contain credentials, query, or fragment data.",
    );
  }
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(config.bucket)) {
    throw new ClaimPrivateStorageConfigurationError(
      "Claim S3 bucket name is invalid.",
    );
  }
  if (!config.region || !config.accessKeyId || !config.secretAccessKey) {
    throw new ClaimPrivateStorageConfigurationError(
      "Claim S3 region and credentials are required.",
    );
  }
  if (
    !CLAIM_S3_PREFIX_PATTERN.test(config.objectPrefix) ||
    config.objectPrefix.startsWith("/") ||
    config.objectPrefix.endsWith("/") ||
    config.objectPrefix.split("/").some((segment) => segment === "..")
  ) {
    throw new ClaimPrivateStorageConfigurationError(
      "Claim S3 object prefix is invalid.",
    );
  }
}

function requiredEnvironmentValue(
  environment: Readonly<Record<string, string | undefined>>,
  key: string,
) {
  const value = environment[key]?.trim();
  if (!value) {
    throw new ClaimPrivateStorageConfigurationError(
      `${key} is required for S3-compatible Claim storage.`,
    );
  }
  return value;
}

function resolveObjectPath(root: string, objectKey: string) {
  assertValidObjectKey(objectKey);
  const resolved = path.resolve(root, ...objectKey.split("/"));
  if (!isWithin(resolved, root)) {
    throw new ClaimPrivateStorageIntegrityError(
      "Private claim attachment path escaped its storage root.",
    );
  }
  return resolved;
}

function assertValidObjectKey(objectKey: string) {
  if (!CLAIM_OBJECT_KEY_PATTERN.test(objectKey)) {
    throw new ClaimPrivateStorageIntegrityError(
      "Private claim attachment object key is invalid.",
    );
  }
}

function mimeTypeFromObjectKey(objectKey: string): ClaimAttachmentMimeType {
  assertValidObjectKey(objectKey);
  const extension = path.extname(objectKey).slice(1);
  const mappings: Record<string, ClaimAttachmentMimeType> = {
    jpg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
    pdf: "application/pdf",
  };
  const mimeType = mappings[extension];
  if (!mimeType) {
    throw new ClaimPrivateStorageIntegrityError(
      "Private claim attachment type is invalid.",
    );
  }
  return mimeType;
}

function normalizeS3Metadata(metadata: Record<string, string> | undefined) {
  return Object.fromEntries(
    Object.entries(metadata ?? {}).map(([key, value]) => [
      key.toLowerCase(),
      value,
    ]),
  );
}

function parseStoredByteLength(value: string | undefined) {
  if (!value || !/^[0-9]+$/.test(value)) {
    return Number.NaN;
  }
  return Number(value);
}

function isClaimAttachmentMimeType(
  value: string | undefined,
): value is ClaimAttachmentMimeType {
  return CLAIM_ATTACHMENT_ALLOWED_MIME_TYPES.some((item) => item === value);
}

function assertExpectedChecksum(bytes: Uint8Array, expected: string) {
  if (!/^[0-9a-f]{64}$/.test(expected) || sha256(bytes) !== expected) {
    throw new ClaimPrivateStorageIntegrityError(
      "Private claim attachment checksum verification failed.",
    );
  }
}

function sha256(value: Uint8Array) {
  return createHash("sha256").update(value).digest("hex");
}

function isWithin(candidate: string, parent: string) {
  const relative = path.relative(parent, candidate);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  );
}
