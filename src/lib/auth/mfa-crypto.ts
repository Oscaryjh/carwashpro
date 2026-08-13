import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { MfaError } from "./mfa-errors";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const TAG_BYTES = 16;

export type MfaCryptoEnvironment = Record<string, string | undefined> & {
  MFA_ACTIVE_KEY_VERSION?: string;
  MFA_ENCRYPTION_KEYS?: string;
};

export type MfaSecretIdentity = Readonly<{
  credentialId: string;
  userId: string;
  type: "TOTP";
}>;

export function encryptMfaSecret(
  secret: string,
  identity: MfaSecretIdentity,
  environment: MfaCryptoEnvironment = process.env,
) {
  const keyring = loadMfaKeyring(environment);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, keyring.activeKey, iv, {
    authTagLength: TAG_BYTES,
  });
  cipher.setAAD(mfaSecretAad(identity));
  const ciphertext = Buffer.concat([
    cipher.update(secret, "utf8"),
    cipher.final(),
  ]);
  return {
    encryptedSecret: ciphertext,
    secretIv: iv,
    secretAuthTag: cipher.getAuthTag(),
    encryptionKeyVersion: keyring.activeVersion,
  };
}

export function decryptMfaSecret(
  encrypted: MfaSecretIdentity & {
    encryptedSecret: Uint8Array;
    secretIv: Uint8Array;
    secretAuthTag: Uint8Array;
    encryptionKeyVersion: string;
  },
  environment: MfaCryptoEnvironment = process.env,
) {
  const key = loadMfaKeyring(environment).keys.get(
    encrypted.encryptionKeyVersion,
  );
  if (!key) throw new MfaError("MFA_ENCRYPTION_NOT_CONFIGURED");
  const iv = Buffer.from(encrypted.secretIv);
  const tag = Buffer.from(encrypted.secretAuthTag);
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
    throw new MfaError("MFA_VERIFICATION_FAILED");
  }
  try {
    const decipher = createDecipheriv(ALGORITHM, key, iv, {
      authTagLength: TAG_BYTES,
    });
    decipher.setAAD(mfaSecretAad(encrypted));
    decipher.setAuthTag(tag);
    return Buffer.concat([
      decipher.update(Buffer.from(encrypted.encryptedSecret)),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new MfaError("MFA_VERIFICATION_FAILED");
  }
}

export function loadMfaKeyring(
  environment: MfaCryptoEnvironment = process.env,
) {
  const activeVersion = environment.MFA_ACTIVE_KEY_VERSION?.trim();
  const serialized = environment.MFA_ENCRYPTION_KEYS?.trim();
  if (!activeVersion || !serialized) {
    throw new MfaError("MFA_ENCRYPTION_NOT_CONFIGURED");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    throw new MfaError("MFA_ENCRYPTION_NOT_CONFIGURED");
  }
  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
    throw new MfaError("MFA_ENCRYPTION_NOT_CONFIGURED");
  }
  const keys = new Map<string, Buffer>();
  for (const [version, encoded] of Object.entries(parsed)) {
    if (
      !/^[A-Za-z0-9._-]{1,40}$/.test(version) ||
      typeof encoded !== "string"
    ) {
      throw new MfaError("MFA_ENCRYPTION_NOT_CONFIGURED");
    }
    const key = decodeKey(encoded);
    if (key.length !== 32) {
      throw new MfaError("MFA_ENCRYPTION_NOT_CONFIGURED");
    }
    keys.set(version, key);
  }
  const activeKey = keys.get(activeVersion);
  if (!activeKey) throw new MfaError("MFA_ENCRYPTION_NOT_CONFIGURED");
  return { activeKey, activeVersion, keys };
}

function mfaSecretAad(identity: MfaSecretIdentity) {
  return Buffer.from(
    JSON.stringify({
      credentialId: identity.credentialId,
      domain: "USER_MFA_CREDENTIAL",
      type: identity.type,
      userId: identity.userId,
    }),
    "utf8",
  );
}

function decodeKey(encoded: string) {
  const normalized = encoded.trim();
  if (/^[0-9a-f]{64}$/i.test(normalized)) return Buffer.from(normalized, "hex");
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(normalized)) {
    throw new MfaError("MFA_ENCRYPTION_NOT_CONFIGURED");
  }
  return Buffer.from(normalized, "base64");
}
