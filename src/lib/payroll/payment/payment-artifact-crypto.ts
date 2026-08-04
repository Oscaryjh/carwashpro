import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import {
  loadPaymentKeyring,
  type PaymentCryptoEnvironment,
} from "./bank-account-crypto";

const ALGORITHM = "aes-256-gcm";

export type PaymentArtifactIdentity = {
  artifactId: string;
  businessId: string;
  paymentBatchId: string;
  providerKey: string;
  formatVersion: string;
  revision: number;
};

export function encryptPaymentArtifact(
  plaintext: Buffer,
  identity: PaymentArtifactIdentity,
  environment: PaymentCryptoEnvironment = process.env,
) {
  const keyring = loadPaymentKeyring(environment);
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, keyring.activeKey, iv, {
    authTagLength: 16,
  });
  cipher.setAAD(paymentArtifactAad(identity));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return {
    authTag: cipher.getAuthTag(),
    byteLength: plaintext.length,
    ciphertext,
    encryptionKeyVersion: keyring.activeVersion,
    iv,
    sha256: sha256(plaintext),
  };
}

export function decryptPaymentArtifact(
  artifact: PaymentArtifactIdentity & {
    authTag: Uint8Array;
    ciphertext: Uint8Array;
    encryptionKeyVersion: string;
    iv: Uint8Array;
    sha256: string;
  },
  environment: PaymentCryptoEnvironment = process.env,
) {
  const key = loadPaymentKeyring(environment).keys.get(
    artifact.encryptionKeyVersion,
  );
  if (!key) throw new Error("The payroll payment artifact key is unavailable.");
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(artifact.iv), {
    authTagLength: 16,
  });
  decipher.setAAD(paymentArtifactAad(artifact));
  decipher.setAuthTag(Buffer.from(artifact.authTag));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(artifact.ciphertext)),
    decipher.final(),
  ]);
  const expected = Buffer.from(artifact.sha256, "hex");
  const actual = Buffer.from(sha256(plaintext), "hex");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    throw new Error("Payroll payment artifact checksum verification failed.");
  }
  return plaintext;
}

export function paymentArtifactAad(identity: PaymentArtifactIdentity) {
  return Buffer.from(
    JSON.stringify({
      artifactId: identity.artifactId,
      businessId: identity.businessId,
      domain: "PAYROLL_PAYMENT_ARTIFACT",
      formatVersion: identity.formatVersion,
      paymentBatchId: identity.paymentBatchId,
      providerKey: identity.providerKey,
      revision: identity.revision,
    }),
    "utf8",
  );
}

function sha256(value: Uint8Array) {
  return createHash("sha256").update(value).digest("hex");
}
