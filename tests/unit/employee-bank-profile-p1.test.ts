import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";
import type { ResolvedBusinessAccess } from "../../src/lib/business-groups/business-access";
import { loadEmployeeBankSection } from "../../src/lib/team/employee-profile-bank-read";
import { encryptBankAccountNumber } from "../../src/lib/payroll/payment/bank-account-crypto";

const businessId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const membershipId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

test("Payment P1 does not query bank data without VIEW_BANK_ACCOUNT", async () => {
  let queries = 0;
  const database = {
    branch: { findMany: () => { queries += 1; return Promise.resolve([]); } },
    employeeBankAccountVersion: { findFirst: () => { queries += 1; return Promise.resolve(null); } },
    employeeBusinessMembership: { findFirst: () => { queries += 1; return Promise.resolve(null); } },
  } as unknown as PrismaClient;

  const result = await loadEmployeeBankSection(
    input(["ALL_BRANCHES"]),
    database,
  );

  assert.deepEqual(result, { status: "ACCESS_DENIED", reason: "CAPABILITY" });
  assert.equal(queries, 0);
});

test("Payment P1 rejects branch-only bank reads before membership or bank query", async () => {
  let protectedQueries = 0;
  const database = {
    branch: {
      findMany: () => Promise.resolve([{ id: "branch-1" }, { id: "branch-2" }]),
    },
    employeeBankAccountVersion: {
      findFirst: () => { protectedQueries += 1; return Promise.resolve(null); },
    },
    employeeBusinessMembership: {
      findFirst: () => { protectedQueries += 1; return Promise.resolve(null); },
    },
  } as unknown as PrismaClient;

  const result = await loadEmployeeBankSection(
    input(["VIEW_BANK_ACCOUNT"], ["branch-1"]),
    database,
  );

  assert.deepEqual(result, {
    status: "ACCESS_DENIED",
    reason: "WHOLE_BUSINESS_SCOPE",
  });
  assert.equal(protectedQueries, 0);
});

test("Payment P1 returns the decrypted account only to an authorised whole-business view", async () => {
  const bankQueries: unknown[] = [];
  const bankAccountVersionId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const environment = {
    PAYROLL_PAYMENT_ACTIVE_KEY_VERSION: "payment-v1",
    PAYROLL_PAYMENT_ENCRYPTION_KEYS: JSON.stringify({
      "payment-v1": randomBytes(32).toString("base64"),
    }),
    PAYROLL_PAYMENT_FINGERPRINT_KEY: randomBytes(32).toString("hex"),
  };
  const encrypted = encryptBankAccountNumber(
    "12345678901234",
    "MAYBANK",
    {
      bankAccountVersionId,
      businessId,
      employeeMembershipId: membershipId,
    },
    environment,
  );
  const database = {
    branch: { findMany: () => Promise.resolve([{ id: "branch-1" }]) },
    employeeBusinessMembership: {
      findFirst: () => Promise.resolve({ id: membershipId }),
    },
    employeeBankAccountVersion: {
      findFirst(query: unknown) {
        bankQueries.push(query);
        return Promise.resolve({
          accountHolderName: "Demo Employee",
          ...encrypted,
          bankCode: "MAYBANK",
          bankNameSnapshot: "Maybank",
          effectiveFrom: new Date("2026-08-01T00:00:00.000Z"),
          effectiveUntil: null,
          id: bankAccountVersionId,
          revision: 2,
          status: "ACTIVE",
          verificationStatus: "UNVERIFIED",
        });
      },
    },
  } as unknown as PrismaClient;

  const result = await loadEmployeeBankSection(
    input([
      "ALL_BRANCHES",
      "VIEW_BANK_ACCOUNT",
      "EDIT_BANK_ACCOUNT",
      "VERIFY_BANK_ACCOUNT",
    ]),
    database,
    environment,
  );

  assert.equal(result.status, "READY");
  if (result.status !== "READY") return;
  assert.deepEqual(result.data.bank, {
    accountHolderName: "Demo Employee",
    accountNumber: "12345678901234",
    bankCode: "MAYBANK",
    bankName: "Maybank",
    effectiveFrom: "2026-08-01T00:00:00.000Z",
    effectiveUntil: null,
    id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    last4: "1234",
    revision: 2,
    status: "ACTIVE",
    verificationStatus: "UNVERIFIED",
  });
  assert.equal(result.data.canEdit, true);
  assert.equal(result.data.canVerify, true);
  const query = JSON.stringify(bankQueries[0]);
  assert.match(query, /accountNumberLast4/);
  assert.match(query, /accountNumberCiphertext|accountNumberIv|accountNumberAuthTag|encryptionKeyVersion/);
  assert.doesNotMatch(query, /accountNumberFingerprintHmac/);
  assert.doesNotMatch(
    JSON.stringify(result),
    /ciphertext|authTag|fingerprint|encryptionKey|accountNumberIv/i,
  );
});

test("Payment P1 mutations enforce scoped authorization and use canonical Payment P0 commands", async () => {
  const root = process.cwd();
  const actions = await readFile(
    path.join(root, "src/app/(business)/team/people/[personId]/payroll/actions.ts"),
    "utf8",
  );

  assert.match(actions, /createEmployeeBankVersion\(/);
  assert.match(actions, /verifyEmployeeBankVersion\(/);
  assert.match(actions, /deactivateEmployeeBankVersion\(/);
  assert.match(actions, /requireWholeBusinessPayroll\("EDIT_BANK_ACCOUNT"\)/);
  assert.match(actions, /requireWholeBusinessPayroll\("VERIFY_BANK_ACCOUNT"\)/);
  assert.doesNotMatch(actions, /prisma\.employeeBankAccountVersion\.(?:create|update|delete|upsert)/);
});

function input(
  permissions: string[],
  allowedBranchIds: string[] = ["branch-1"],
) {
  return {
    access: access(permissions),
    allowedBranchIds,
    businessId,
    membershipId,
  };
}

function access(permissions: string[]): ResolvedBusinessAccess {
  return {
    actorRole: "STAFF",
    branchId: "branch-1",
    businessId,
    capability: null,
    effectiveBusinessRole: "STAFF",
    granted: true,
    groupId: null,
    groupUserId: null,
    homeBusinessId: businessId,
    identityRole: "STAFF",
    industryType: "SALON_BEAUTY",
    permissions,
    source: "DIRECT_BUSINESS",
    userId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  };
}
