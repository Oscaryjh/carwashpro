import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const ALGORITHM_LABEL = "AES-256-GCM";
const AAD_VERSION = "v1";
const IV_BYTES = 12;
const TAG_BYTES = 16;

export type StatutoryArtifactIdentity = {
  artifactId: string;
  businessId: string;
  payrollRunId: string;
  provider: "EPF" | "PERKESO" | "PCB";
  revision: number;
  exportVersion: string;
};

export type EncryptedStatutoryArtifact = {
  aadVersion: typeof AAD_VERSION;
  authenticationTag: Buffer;
  ciphertext: Buffer;
  encryptionAlgorithm: typeof ALGORITHM_LABEL;
  encryptionKeyVersion: string;
  initializationVector: Buffer;
  plaintextSha256: string;
};

type ArtifactKeyringEnvironment = {
  STATUTORY_ARTIFACT_ACTIVE_KEY_VERSION?: string;
  STATUTORY_ARTIFACT_ENCRYPTION_KEYS?: string;
};

export function encryptStatutoryArtifact(
  plaintext: Buffer,
  identity: StatutoryArtifactIdentity,
  environment: ArtifactKeyringEnvironment = process.env as ArtifactKeyringEnvironment,
): EncryptedStatutoryArtifact {
  const keyring = loadArtifactKeyring(environment);
  const initializationVector = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, keyring.activeKey, initializationVector, {
    authTagLength: TAG_BYTES,
  });
  cipher.setAAD(artifactAdditionalAuthenticatedData(identity));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);

  return {
    aadVersion: AAD_VERSION,
    authenticationTag: cipher.getAuthTag(),
    ciphertext,
    encryptionAlgorithm: ALGORITHM_LABEL,
    encryptionKeyVersion: keyring.activeVersion,
    initializationVector,
    plaintextSha256: sha256(plaintext),
  };
}

export function decryptStatutoryArtifact(
  artifact: StatutoryArtifactIdentity & {
    aadVersion: string;
    authenticationTag: Uint8Array;
    ciphertext: Uint8Array;
    encryptionAlgorithm: string;
    encryptionKeyVersion: string;
    initializationVector: Uint8Array;
    plaintextSha256: string;
  },
  environment: ArtifactKeyringEnvironment = process.env as ArtifactKeyringEnvironment,
) {
  if (artifact.encryptionAlgorithm !== ALGORITHM_LABEL || artifact.aadVersion !== AAD_VERSION) {
    throw new Error("This statutory artifact encryption format is not supported.");
  }
  const key = loadArtifactKeyring(environment).keys.get(artifact.encryptionKeyVersion);
  if (!key) {
    throw new Error(`Statutory artifact key version ${artifact.encryptionKeyVersion} is unavailable.`);
  }
  const initializationVector = Buffer.from(artifact.initializationVector);
  const authenticationTag = Buffer.from(artifact.authenticationTag);
  if (initializationVector.length !== IV_BYTES || authenticationTag.length !== TAG_BYTES) {
    throw new Error("Statutory artifact encryption metadata is invalid.");
  }

  const decipher = createDecipheriv(ALGORITHM, key, initializationVector, {
    authTagLength: TAG_BYTES,
  });
  decipher.setAAD(artifactAdditionalAuthenticatedData(artifact));
  decipher.setAuthTag(authenticationTag);
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(artifact.ciphertext)),
    decipher.final(),
  ]);
  const expected = Buffer.from(artifact.plaintextSha256, "hex");
  const actual = Buffer.from(sha256(plaintext), "hex");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    throw new Error("Statutory artifact checksum verification failed.");
  }
  return plaintext;
}

export function artifactAdditionalAuthenticatedData(identity: StatutoryArtifactIdentity) {
  return Buffer.from(
    JSON.stringify({
      artifactId: identity.artifactId,
      businessId: identity.businessId,
      exportVersion: identity.exportVersion,
      payrollRunId: identity.payrollRunId,
      provider: identity.provider,
      revision: identity.revision,
      version: AAD_VERSION,
    }),
    "utf8",
  );
}

function loadArtifactKeyring(environment: ArtifactKeyringEnvironment) {
  const activeVersion = environment.STATUTORY_ARTIFACT_ACTIVE_KEY_VERSION?.trim();
  const serialized = environment.STATUTORY_ARTIFACT_ENCRYPTION_KEYS?.trim();
  if (!activeVersion || !serialized) {
    throw new Error("Statutory artifact encryption is not configured.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    throw new Error("STATUTORY_ARTIFACT_ENCRYPTION_KEYS must be valid JSON.");
  }
  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
    throw new Error("STATUTORY_ARTIFACT_ENCRYPTION_KEYS must be a version-to-key object.");
  }

  const keys = new Map<string, Buffer>();
  for (const [version, encoded] of Object.entries(parsed)) {
    if (!/^[A-Za-z0-9._-]{1,40}$/.test(version) || typeof encoded !== "string") {
      throw new Error("Statutory artifact keyring contains an invalid entry.");
    }
    const key = decodeKey(encoded);
    if (key.length !== 32) {
      throw new Error(`Statutory artifact key ${version} must decode to exactly 32 bytes.`);
    }
    keys.set(version, key);
  }
  const activeKey = keys.get(activeVersion);
  if (!activeKey) {
    throw new Error("The active statutory artifact key version is missing from the keyring.");
  }
  return { activeKey, activeVersion, keys };
}

function decodeKey(encoded: string) {
  const normalized = encoded.trim();
  if (/^[0-9a-f]{64}$/i.test(normalized)) return Buffer.from(normalized, "hex");
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(normalized)) {
    throw new Error("Statutory artifact keys must use base64 or 64-character hex encoding.");
  }
  return Buffer.from(normalized, "base64");
}

function sha256(value: Uint8Array) {
  return createHash("sha256").update(value).digest("hex");
}
