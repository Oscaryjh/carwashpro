import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";
import { getEmployeeProfilePersonal } from "../../src/lib/team/employee-profile-read";

const input = {
  allowedBranchIds: ["11111111-1111-4111-8111-111111111111"],
  businessId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  membershipId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  now: new Date("2026-08-02T02:00:00.000Z"),
  wholeBusinessScope: false,
};

test("Personal uses the existing People tenant and branch scope", async () => {
  let capturedQuery: Record<string, unknown> | null = null;
  const database = {
    employeeBusinessMembership: {
      findFirst(query: Record<string, unknown>) {
        capturedQuery = query;
        return Promise.resolve(null);
      },
    },
  } as unknown as PrismaClient;

  await getEmployeeProfilePersonal(input, database);

  assert.ok(capturedQuery);
  const serialized = JSON.stringify(capturedQuery);
  assert.match(serialized, /aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/);
  assert.match(serialized, /bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/);
  assert.match(serialized, /11111111-1111-4111-8111-111111111111/);
  assert.match(serialized, /effectiveFrom/);
  assert.match(serialized, /effectiveUntil/);
});

test("Personal query selects only the People Core contact data sources", async () => {
  let select: unknown = null;
  const database = {
    employeeBusinessMembership: {
      findFirst(query: { select: unknown }) {
        select = query.select;
        return Promise.resolve(null);
      },
    },
  } as unknown as PrismaClient;

  await getEmployeeProfilePersonal(input, database);

  assert.deepEqual(select, {
    id: true,
    fullName: true,
    phoneNumber: true,
    staffUser: {
      select: {
        id: true,
        email: true,
      },
    },
  });
});

test("Personal implementation contains no prohibited sensitive field", async () => {
  const root = process.cwd();
  const sources = await Promise.all(
    [
      "src/lib/team/employee-profile-read.ts",
      "src/components/employee-profile-personal.tsx",
      "src/app/(business)/team/people/[personId]/page.tsx",
    ].map((file) => readFile(path.join(root, file), "utf8")),
  );
  const source = sources.join("\n");

  for (const forbidden of [
    "statutoryNationality",
    "statutoryIdentityType",
    "statutoryIdentityNumber",
    "taxIdentificationNumber",
    "epfMemberNumber",
    "socsoMemberNumber",
    "eisEnabled",
    "bankAccount",
    "bankName",
    "baseSalary",
    "payBasis",
    "payrollEntries",
    "address",
    "emergencyContact",
    "profilePhoto",
    "passportNumber",
    "workPermit",
  ]) {
    assert.equal(
      source.includes(forbidden),
      false,
      `${forbidden} must not be queried or rendered by Personal`,
    );
  }
});

test("Personal remains read-only as later read-only sections are added", async () => {
  const root = process.cwd();
  const route = await readFile(
    path.join(root, "src/app/(business)/team/people/[personId]/page.tsx"),
    "utf8",
  );
  const component = await readFile(
    path.join(root, "src/components/employee-profile-personal.tsx"),
    "utf8",
  );

  assert.match(
    route,
    /membership && sectionAuthorized && activeSection === "personal"/,
  );
  assert.match(route, /activeSection === "attendance"/);
  assert.match(route, /activeSection === "leave"/);
  assert.doesNotMatch(component, /<form|<input|<button|action=/);
  assert.match(component, /Full name/);
  assert.match(component, /Phone number/);
  assert.match(component, /Linked POS email/);
  assert.doesNotMatch(component, /dateOfBirth|Date of birth/);
});
