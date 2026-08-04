import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
} from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const TAG_BYTES = 16;

export type PaymentCryptoEnvironment = Record<string, string | undefined> & {
  PAYROLL_PAYMENT_ACTIVE_KEY_VERSION?: string;
  PAYROLL_PAYMENT_ENCRYPTION_KEYS?: string;
  PAYROLL_PAYMENT_FINGERPRINT_KEY?: string;
};

export type BankAccountIdentity = {
  businessId: string;
  employeeMembershipId: string;
  bankAccountVersionId: string;
};

export type PaymentInstructionIdentity = {
  bankAccountVersionId: string;
  businessId: string;
  paymentBatchId: string;
  paymentInstructionId: string;
};

export type EncryptedBankAccountNumber = {
  accountNumberAuthTag: Buffer;
  accountNumberCiphertext: Buffer;
  accountNumberFingerprintHmac: string;
  accountNumberIv: Buffer;
  accountNumberLast4: string;
  encryptionKeyVersion: string;
};

export function normalizeBankCode(value: string) {
  const normalized = value.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!normalized || normalized.length > 32) {
    throw new Error("Enter a valid bank code.");
  }
  return normalized;
}

export function normalizeBankAccountNumber(value: string) {
  const normalized = value.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (normalized.length < 5 || normalized.length > 40) {
    throw new Error("Enter a valid bank account number.");
  }
  return normalized;
}

export function encryptBankAccountNumber(
  accountNumber: string,
  bankCode: string,
  identity: BankAccountIdentity,
  environment: PaymentCryptoEnvironment = process.env,
): EncryptedBankAccountNumber {
  const normalizedAccount = normalizeBankAccountNumber(accountNumber);
  const normalizedBank = normalizeBankCode(bankCode);
  const keyring = loadPaymentKeyring(environment);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, keyring.activeKey, iv, {
    authTagLength: TAG_BYTES,
  });
  cipher.setAAD(bankAccountAad(identity));
  const ciphertext = Buffer.concat([
    cipher.update(normalizedAccount, "utf8"),
    cipher.final(),
  ]);

  return {
    accountNumberAuthTag: cipher.getAuthTag(),
    accountNumberCiphertext: ciphertext,
    accountNumberFingerprintHmac: fingerprintBankAccount(
      normalizedBank,
      normalizedAccount,
      environment,
    ),
    accountNumberIv: iv,
    accountNumberLast4: normalizedAccount.slice(-4),
    encryptionKeyVersion: keyring.activeVersion,
  };
}

export function decryptBankAccountNumber(
  encrypted: BankAccountIdentity & {
    accountNumberAuthTag: Uint8Array;
    accountNumberCiphertext: Uint8Array;
    accountNumberIv: Uint8Array;
    encryptionKeyVersion: string;
  },
  environment: PaymentCryptoEnvironment = process.env,
) {
  const key = loadPaymentKeyring(environment).keys.get(
    encrypted.encryptionKeyVersion,
  );
  if (!key) throw new Error("The payroll payment encryption key is unavailable.");
  const iv = Buffer.from(encrypted.accountNumberIv);
  const tag = Buffer.from(encrypted.accountNumberAuthTag);
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
    throw new Error("Payroll payment encryption metadata is invalid.");
  }
  const decipher = createDecipheriv(ALGORITHM, key, iv, {
    authTagLength: TAG_BYTES,
  });
  decipher.setAAD(bankAccountAad(encrypted));
  decipher.setAuthTag(tag);
  return Buffer.concat([
    decipher.update(Buffer.from(encrypted.accountNumberCiphertext)),
    decipher.final(),
  ]).toString("utf8");
}

export function encryptPaymentInstructionAccountSnapshot(
  accountNumber: string,
  identity: PaymentInstructionIdentity,
  environment: PaymentCryptoEnvironment = process.env,
) {
  const keyring = loadPaymentKeyring(environment);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, keyring.activeKey, iv, {
    authTagLength: TAG_BYTES,
  });
  cipher.setAAD(paymentInstructionAad(identity));
  const ciphertext = Buffer.concat([
    cipher.update(normalizeBankAccountNumber(accountNumber), "utf8"),
    cipher.final(),
  ]);
  return {
    authTag: cipher.getAuthTag(),
    ciphertext,
    encryptionKeyVersion: keyring.activeVersion,
    iv,
  };
}

export function decryptPaymentInstructionAccountSnapshot(
  encrypted: PaymentInstructionIdentity & {
    authTag: Uint8Array;
    ciphertext: Uint8Array;
    encryptionKeyVersion: string;
    iv: Uint8Array;
  },
  environment: PaymentCryptoEnvironment = process.env,
) {
  const key = loadPaymentKeyring(environment).keys.get(
    encrypted.encryptionKeyVersion,
  );
  if (!key) throw new Error("The payroll payment encryption key is unavailable.");
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(encrypted.iv), {
    authTagLength: TAG_BYTES,
  });
  decipher.setAAD(paymentInstructionAad(encrypted));
  decipher.setAuthTag(Buffer.from(encrypted.authTag));
  return Buffer.concat([
    decipher.update(Buffer.from(encrypted.ciphertext)),
    decipher.final(),
  ]).toString("utf8");
}

export function fingerprintBankAccount(
  bankCode: string,
  accountNumber: string,
  environment: PaymentCryptoEnvironment = process.env,
) {
  const fingerprintKey = environment.PAYROLL_PAYMENT_FINGERPRINT_KEY?.trim();
  if (!fingerprintKey || fingerprintKey.length < 32) {
    throw new Error("Payroll payment fingerprinting is not configured.");
  }
  return createHmac("sha256", fingerprintKey)
    .update(
      `${normalizeBankCode(bankCode)}:${normalizeBankAccountNumber(accountNumber)}`,
      "utf8",
    )
    .digest("hex");
}

export function bankAccountAad(identity: BankAccountIdentity) {
  return Buffer.from(
    JSON.stringify({
      bankAccountVersionId: identity.bankAccountVersionId,
      businessId: identity.businessId,
      domain: "EMPLOYEE_BANK_ACCOUNT",
      employeeMembershipId: identity.employeeMembershipId,
    }),
    "utf8",
  );
}

export function paymentInstructionAad(identity: PaymentInstructionIdentity) {
  return Buffer.from(
    JSON.stringify({
      bankAccountVersionId: identity.bankAccountVersionId,
      businessId: identity.businessId,
      domain: "PAYROLL_PAYMENT_INSTRUCTION",
      paymentBatchId: identity.paymentBatchId,
      paymentInstructionId: identity.paymentInstructionId,
    }),
    "utf8",
  );
}

export function loadPaymentKeyring(
  environment: PaymentCryptoEnvironment = process.env,
) {
  const activeVersion = environment.PAYROLL_PAYMENT_ACTIVE_KEY_VERSION?.trim();
  const serialized = environment.PAYROLL_PAYMENT_ENCRYPTION_KEYS?.trim();
  if (!activeVersion || !serialized) {
    throw new Error("Payroll payment encryption is not configured.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    throw new Error("PAYROLL_PAYMENT_ENCRYPTION_KEYS must be valid JSON.");
  }
  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
    throw new Error("PAYROLL_PAYMENT_ENCRYPTION_KEYS must be a version-to-key object.");
  }
  const keys = new Map<string, Buffer>();
  for (const [version, encoded] of Object.entries(parsed)) {
    if (!/^[A-Za-z0-9._-]{1,40}$/.test(version) || typeof encoded !== "string") {
      throw new Error("Payroll payment keyring contains an invalid entry.");
    }
    const key = decodeKey(encoded);
    if (key.length !== 32) {
      throw new Error(`Payroll payment key ${version} must decode to exactly 32 bytes.`);
    }
    keys.set(version, key);
  }
  const activeKey = keys.get(activeVersion);
  if (!activeKey) {
    throw new Error("The active payroll payment key version is missing from the keyring.");
  }
  return { activeKey, activeVersion, keys };
}

function decodeKey(encoded: string) {
  const normalized = encoded.trim();
  if (/^[0-9a-f]{64}$/i.test(normalized)) return Buffer.from(normalized, "hex");
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(normalized)) {
    throw new Error("Payroll payment keys must use base64 or 64-character hex encoding.");
  }
  return Buffer.from(normalized, "base64");
}
