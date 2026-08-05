import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";
import type { ResolvedBusinessAccess } from "../../src/lib/business-groups/business-access";
import { loadEmployeeBankSection } from "../../src/lib/team/employee-profile-bank-read";

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

test("Payment P1 returns only the safe current bank DTO", async () => {
  const bankQueries: unknown[] = [];
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
          accountNumberLast4: "1234",
          bankCode: "MAYBANK",
          bankNameSnapshot: "Maybank",
          effectiveFrom: new Date("2026-08-01T00:00:00.000Z"),
          effectiveUntil: null,
          id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
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
  );

  assert.equal(result.status, "READY");
  if (result.status !== "READY") return;
  assert.deepEqual(result.data.bank, {
    accountHolderName: "Demo Employee",
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
  assert.doesNotMatch(
    query,
    /accountNumberCiphertext|accountNumberIv|accountNumberAuthTag|accountNumberFingerprintHmac|encryptionKeyVersion/,
  );
  assert.doesNotMatch(
    JSON.stringify(result),
    /ciphertext|authTag|fingerprint|encryptionKey|accountNumberIv/i,
  );
});

test("Payment P1 routes every mutation through canonical Payment P0 commands", async () => {
  const root = process.cwd();
  const [actions, component, editPage, loader, styles] = await Promise.all([
    readFile(path.join(root, "src/app/(business)/team/people/[personId]/payroll/actions.ts"), "utf8"),
    readFile(path.join(root, "src/components/employee-profile-payroll.tsx"), "utf8"),
    readFile(path.join(root, "src/app/(business)/team/people/[personId]/payroll/bank/edit/page.tsx"), "utf8"),
    readFile(path.join(root, "src/lib/team/employee-profile-bank-read.ts"), "utf8"),
    readFile(path.join(root, "src/components/employee-profile-shell.module.css"), "utf8"),
  ]);

  assert.match(actions, /createEmployeeBankVersion\(/);
  assert.match(actions, /verifyEmployeeBankVersion\(/);
  assert.match(actions, /deactivateEmployeeBankVersion\(/);
  assert.match(actions, /requireWholeBusinessPayroll\("EDIT_BANK_ACCOUNT"\)/);
  assert.match(actions, /requireWholeBusinessPayroll\("VERIFY_BANK_ACCOUNT"\)/);
  assert.doesNotMatch(actions, /prisma\.employeeBankAccountVersion\.(?:create|update|delete|upsert)/);

  assert.match(component, /Bank details/i);
  assert.match(component, /••••/);
  assert.match(component, /Existing payment batches are not updated automatically/);
  assert.match(component, /MANUALLY_VERIFIED|manually verified/i);
  assert.match(component, /Deactivate bank account/);
  assert.doesNotMatch(component, /accountNumberCiphertext|accountNumberIv|accountNumberAuthTag|Fingerprint|Encryption Key/);

  assert.match(editPage, /\/team\/people\/\$\{employee\.id\}\?section=payroll/);
  assert.match(editPage, /name="accountNumber"/);
  assert.match(editPage, /autoComplete="off"/);
  assert.doesNotMatch(editPage, /defaultValue=\{current\?\.accountNumber/);
  assert.match(loader, /VIEW_BANK_ACCOUNT/);
  assert.match(loader, /EDIT_BANK_ACCOUNT/);
  assert.match(loader, /VERIFY_BANK_ACCOUNT/);
  assert.match(styles, /@media \(max-width: 760px\)/);
  assert.match(styles, /@media \(max-width: 360px\)/);
  assert.match(styles, /\.payrollFormGrid\s*\{[\s\S]*grid-template-columns/);
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
