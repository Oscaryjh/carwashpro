import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import { sanitizeAuditValue } from "../../src/lib/audit/sanitize";
import {
  decryptBankAccountNumber,
  decryptPaymentArtifact,
  decryptPaymentInstructionAccountSnapshot,
  encryptBankAccountNumber,
  encryptPaymentArtifact,
  encryptPaymentInstructionAccountSnapshot,
  fingerprintBankAccount,
  normalizeBankAccountNumber,
  toSafeEmployeeBankVersion,
} from "../../src/lib/payroll/payment";

const environment = {
  PAYROLL_PAYMENT_ACTIVE_KEY_VERSION: "payment-v1",
  PAYROLL_PAYMENT_ENCRYPTION_KEYS: JSON.stringify({
    "payment-v1": randomBytes(32).toString("base64"),
  }),
  PAYROLL_PAYMENT_FINGERPRINT_KEY: randomBytes(32).toString("hex"),
};

test("Payment keyring encrypts bank data with domain-bound AAD and stable HMAC", () => {
  const identity = {
    bankAccountVersionId: randomUUID(),
    businessId: randomUUID(),
    employeeMembershipId: randomUUID(),
  };
  const encrypted = encryptBankAccountNumber(
    " 1234-5678 9012 ",
    " may-bank ",
    identity,
    environment,
  );

  assert.equal(normalizeBankAccountNumber(" 1234-5678 9012 "), "123456789012");
  assert.equal(encrypted.accountNumberLast4, "9012");
  assert.equal(encrypted.accountNumberIv.length, 12);
  assert.equal(encrypted.accountNumberAuthTag.length, 16);
  assert.notEqual(encrypted.accountNumberCiphertext.toString(), "123456789012");
  assert.equal(
    decryptBankAccountNumber({ ...identity, ...encrypted }, environment),
    "123456789012",
  );
  assert.equal(
    encrypted.accountNumberFingerprintHmac,
    fingerprintBankAccount("MAYBANK", "123456789012", environment),
  );
  assert.throws(
    () =>
      decryptBankAccountNumber(
        { ...identity, ...encrypted, businessId: randomUUID() },
        environment,
      ),
    /authenticate|payment encryption metadata|unsupported state/i,
  );
  assert.throws(
    () => fingerprintBankAccount("MAYBANK", "123456789012", {}),
    /fingerprinting is not configured/i,
  );
  assert.throws(
    () => decryptBankAccountNumber({ ...identity, ...encrypted }, {
      ...environment,
      PAYROLL_PAYMENT_ACTIVE_KEY_VERSION: "unknown",
    }),
    /active payroll payment key version is missing/i,
  );
});
test("Instruction snapshots and exact-byte artifacts reject AAD and ciphertext tampering", () => {
  const instructionIdentity = {
    bankAccountVersionId: randomUUID(),
    businessId: randomUUID(),
    paymentBatchId: randomUUID(),
    paymentInstructionId: randomUUID(),
  };
  const snapshot = encryptPaymentInstructionAccountSnapshot(
    "123456789012",
    instructionIdentity,
    environment,
  );
  assert.equal(
    decryptPaymentInstructionAccountSnapshot(
      { ...instructionIdentity, ...snapshot },
      environment,
    ),
    "123456789012",
  );
  assert.throws(
    () =>
      decryptPaymentInstructionAccountSnapshot(
        {
          ...instructionIdentity,
          ...snapshot,
          paymentInstructionId: randomUUID(),
        },
        environment,
      ),
    /authenticate|unsupported state/i,
  );

  const artifactIdentity = {
    artifactId: randomUUID(),
    businessId: instructionIdentity.businessId,
    formatVersion: "P0-INTERNAL-v1",
    paymentBatchId: instructionIdentity.paymentBatchId,
    providerKey: "INTERNAL_TEST",
    revision: 1,
  };
  const bytes = Buffer.from("fixed internal payment test bytes\r\n", "utf8");
  const artifact = encryptPaymentArtifact(bytes, artifactIdentity, environment);
  assert.deepEqual(
    decryptPaymentArtifact({ ...artifactIdentity, ...artifact }, environment),
    bytes,
  );
  const tampered = Buffer.from(artifact.ciphertext);
  tampered[0] ^= 0xff;
  assert.throws(
    () =>
      decryptPaymentArtifact(
        { ...artifactIdentity, ...artifact, ciphertext: tampered },
        environment,
      ),
    /authenticate|unsupported state/i,
  );
});

test("Safe bank DTO and Audit sanitizer never serialize bank secrets", () => {
  const dto = toSafeEmployeeBankVersion({
    accountHolderName: "Demo Employee",
    accountNumberLast4: "9012",
    bankCode: "MAYBANK",
    bankNameSnapshot: "Maybank",
    effectiveFrom: new Date("2026-08-01T00:00:00.000Z"),
    effectiveUntil: null,
    id: randomUUID(),
    revision: 1,
    status: "ACTIVE",
    verificationStatus: "UNVERIFIED",
  });
  const serializedDto = JSON.stringify(dto);
  assert.equal(dto.last4, "9012");
  assert.doesNotMatch(serializedDto, /cipher|authTag|fingerprint|123456789012/i);

  const sanitized = sanitizeAuditValue({
    accountFingerprint: "secret-fingerprint",
    accountNumber: "123456789012",
    authTag: "secret-tag",
    bankFile: "raw-file",
    encryptedAccountSnapshot: "ciphertext",
    instructionPayload: { beneficiary: "Demo", iban: "MY123" },
    iv: "secret-iv",
    last4: "9012",
  });
  const serializedAudit = JSON.stringify(sanitized);
  assert.match(serializedAudit, /9012/);
  assert.doesNotMatch(
    serializedAudit,
    /123456789012|secret-fingerprint|secret-tag|secret-iv|raw-file|ciphertext|MY123/,
  );
});
