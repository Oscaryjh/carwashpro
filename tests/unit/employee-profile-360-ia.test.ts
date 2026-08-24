import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  employeeProfileTabs,
  resolveEmployeeProfileLocation,
} from "../../src/lib/team/employee-profile-tabs";

test("Employee 360 exposes five purpose-led areas and preserves legacy deep links", () => {
  assert.deepEqual(
    employeeProfileTabs.map((tab) => tab.key),
    ["overview", "work", "time", "compensation", "access"],
  );
  assert.deepEqual(resolveEmployeeProfileLocation("leave", undefined), {
    section: "time",
    view: "leave",
  });
  assert.deepEqual(resolveEmployeeProfileLocation("payroll", undefined), {
    section: "compensation",
    view: "payroll",
  });
});

test("Employee 360 composes canonical readers and only exposes sensitive plaintext to authorized editors", async () => {
  const page = await readFile(
    "src/app/(business)/team/people/[personId]/page.tsx",
    "utf8",
  );
  const bankReader = await readFile(
    "src/lib/team/employee-profile-bank-read.ts",
    "utf8",
  );
  const statutoryReader = await readFile(
    "src/lib/team/employee-profile-statutory-read.ts",
    "utf8",
  );
  const profileReader = await readFile(
    "src/lib/team/employee-profile-read.ts",
    "utf8",
  );
  const employee360 = await readFile(
    "src/components/employee-profile-360.tsx",
    "utf8",
  );

  for (const reader of [
    "loadEmployeeAttendanceSection",
    "loadEmployeeLeaveSection",
    "loadEmployeeClaimsSection",
    "loadEmployeeCommissionSection",
    "loadEmployeeCompensationSection",
    "loadEmployeePayrollSummary",
    "loadEmployeeStatutoryProfileSection",
  ]) {
    assert.match(page, new RegExp(`\\b${reader}\\b`));
  }
  assert.doesNotMatch(bankReader, /decryptEmployeeBankAccountNumber/);
  assert.doesNotMatch(bankReader, /accountNumberCiphertext:\s*true/);
  assert.match(bankReader, /accountNumber: `•••• \$\{bank\.accountNumberLast4\}`/);
  assert.match(statutoryReader, /identityNumber: canEditTax/);
  assert.match(statutoryReader, /tin: canEditTax/);
  assert.match(statutoryReader, /epfMemberNumber: canEditTax/);
  assert.match(statutoryReader, /socsoMemberNumber: canEditTax/);
  assert.match(statutoryReader, /identityNumberMasked: maskIdentifier/);
  assert.match(statutoryReader, /tinMasked: maskIdentifier/);
  assert.match(profileReader, /teamMemberLinkStatus: true/);
  assert.match(profileReader, /devices:\s*\{/);
  assert.match(employee360, /teamMemberLinkStatus === "LINKED"/);
  assert.match(employee360, /label="POS access"/);
  assert.match(employee360, /staff\?\.loginEnabled/);
});
