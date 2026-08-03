import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ValidatedClaimAttachment } from "./attachment-policy";

const CLAIM_OBJECT_KEY_PATTERN =
  /^claim-receipts\/[0-9]{4}\/[0-9]{2}\/[0-9a-f-]{36}\.(jpg|png|webp|pdf)$/;

export type StoredPrivateClaimAttachment = Readonly<{
  objectKey: string;
  byteLength: number;
  checksumSha256: string;
  mimeType: ValidatedClaimAttachment["detectedMimeType"];
  sanitizedFileName: string;
  disposition: "QUARANTINED";
  publicUrl: null;
  signedUrl: null;
}>;

export interface ClaimPrivateAttachmentStore {
  putQuarantined(
    attachment: ValidatedClaimAttachment,
  ): Promise<StoredPrivateClaimAttachment>;
  readQuarantined(input: {
    objectKey: string;
    expectedChecksumSha256: string;
  }): Promise<Buffer>;
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

  async putQuarantined(attachment: ValidatedClaimAttachment) {
    const root = await this.resolveSafeRoot();
    const now = this.options.now?.() ?? new Date();
    const id = this.options.createId?.() ?? randomUUID();
    const objectKey = [
      "claim-receipts",
      String(now.getUTCFullYear()).padStart(4, "0"),
      String(now.getUTCMonth() + 1).padStart(2, "0"),
      `${id}.${attachment.extension}`,
    ].join("/");
    const filePath = resolveObjectPath(root, objectKey);

    await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
    await writeFile(filePath, attachment.bytes, { flag: "wx", mode: 0o600 });

    return {
      objectKey,
      byteLength: attachment.byteLength,
      checksumSha256: attachment.checksumSha256,
      mimeType: attachment.detectedMimeType,
      sanitizedFileName: attachment.sanitizedFileName,
      disposition: "QUARANTINED" as const,
      publicUrl: null,
      signedUrl: null,
    };
  }

  async readQuarantined(input: {
    objectKey: string;
    expectedChecksumSha256: string;
  }) {
    const root = await this.resolveSafeRoot();
    const filePath = resolveObjectPath(root, input.objectKey);
    const bytes = await readFile(filePath);
    const checksum = createHash("sha256").update(bytes).digest("hex");

    if (checksum !== input.expectedChecksumSha256) {
      throw new ClaimPrivateStorageIntegrityError(
        "Private claim attachment checksum verification failed.",
      );
    }
    return bytes;
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

export function getClaimPrivateAttachmentStore(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): ClaimPrivateAttachmentStore {
  const provider = environment.CLAIM_PRIVATE_STORAGE_PROVIDER?.trim();
  const root = environment.CLAIM_PRIVATE_STORAGE_ROOT?.trim();

  if (provider !== "filesystem") {
    throw new ClaimPrivateStorageConfigurationError(
      "Claim private storage is not configured. Only the explicit filesystem provider is available in C0.",
    );
  }
  if (!root) {
    throw new ClaimPrivateStorageConfigurationError(
      "CLAIM_PRIVATE_STORAGE_ROOT is required for private claim attachments.",
    );
  }
  return new FileSystemClaimPrivateAttachmentStore(root);
}

function resolveObjectPath(root: string, objectKey: string) {
  if (!CLAIM_OBJECT_KEY_PATTERN.test(objectKey)) {
    throw new ClaimPrivateStorageIntegrityError(
      "Private claim attachment object key is invalid.",
    );
  }
  const resolved = path.resolve(root, ...objectKey.split("/"));
  if (!isWithin(resolved, root)) {
    throw new ClaimPrivateStorageIntegrityError(
      "Private claim attachment path escaped its storage root.",
    );
  }
  return resolved;
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
