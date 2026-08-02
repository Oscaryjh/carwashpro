import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";
import {
  getEmployeeProfileEmployment,
  getEmployeeProfileOverview,
} from "../../src/lib/team/employee-profile-read";

const input = {
  allowedBranchIds: [
    "11111111-1111-4111-8111-111111111111",
    "22222222-2222-4222-8222-222222222222",
  ],
  businessId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  membershipId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  now: new Date("2026-08-02T02:00:00.000Z"),
  wholeBusinessScope: false,
};

test("Phase 2A read models retain business and current authorized branch scope", async () => {
  const queries: unknown[] = [];
  const database = {
    employeeBusinessMembership: {
      findFirst(query: unknown) {
        queries.push(query);
        return Promise.resolve(null);
      },
    },
  } as unknown as PrismaClient;

  await getEmployeeProfileOverview(input, database);
  await getEmployeeProfileEmployment(input, database);

  assert.equal(queries.length, 2);
  for (const query of queries) {
    const serialized = JSON.stringify(query);
    assert.match(serialized, /aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/);
    assert.match(serialized, /bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/);
    assert.match(serialized, /11111111-1111-4111-8111-111111111111/);
    assert.match(serialized, /22222222-2222-4222-8222-222222222222/);
    assert.match(serialized, /effectiveFrom/);
    assert.match(serialized, /effectiveUntil/);
  }
});
test("Phase 2A query allowlists exclude payroll and sensitive profile fields", async () => {
  const root = process.cwd();
  const sources = await Promise.all(
    [
      "src/lib/team/employee-profile-read.ts",
      "src/components/employee-profile-phase2a.tsx",
      "src/app/(business)/team/people/[personId]/page.tsx",
    ].map((file) => readFile(path.join(root, file), "utf8")),
  );
  const source = sources.join("\n");

  for (const forbiddenField of [
    "baseSalary",
    "payBasis",
    "bankAccount",
    "bankName",
    "epfEnabled",
    "epfMemberNumber",
    "socsoEnabled",
    "socsoMemberNumber",
    "eisEnabled",
    "taxIdentificationNumber",
    "statutoryNationality",
    "statutoryIdentityType",
    "statutoryIdentityNumber",
    "payrollEntries",
    "staffLevel",
  ]) {
    assert.equal(
      source.includes(forbiddenField),
      false,
      `${forbiddenField} must not be loaded by Phase 2A`,
    );
  }
});

test("Phase 2D adds Leave after the earlier section loaders", async () => {
  const root = process.cwd();
  const route = await readFile(
    path.join(root, "src/app/(business)/team/people/[personId]/page.tsx"),
    "utf8",
  );
  const shell = await readFile(
    path.join(root, "src/components/employee-profile-shell.tsx"),
    "utf8",
  );

  assert.match(route, /activeSection === "overview"/);
  assert.match(route, /activeSection === "employment"/);
  assert.match(route, /activeSection === "personal"/);
  assert.match(route, /activeSection === "attendance"/);
  assert.match(route, /activeSection === "leave"/);
  assert.match(route, /activeSection === "payroll"/);
  assert.doesNotMatch(shell, /Salary, bank and statutory information will appear here/);
});

test("Phase 2A performs capability checks before section queries", async () => {
  const route = await readFile(
    path.join(
      process.cwd(),
      "src/app/(business)/team/people/[personId]/page.tsx",
    ),
    "utf8",
  );

  assert.match(
    route,
    /membership && sectionAuthorized && activeSection === "overview"/,
  );
  assert.match(
    route,
    /membership && sectionAuthorized && activeSection === "employment"/,
  );
});
