import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";
import { loadEmployeeLeaveSection } from "../../src/lib/team/employee-profile-leave-read";

const input = {
  allowedBranchIds: ["11111111-1111-4111-8111-111111111111"],
  businessId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  membershipId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  now: new Date("2026-08-02T04:00:00.000Z"),
  wholeBusinessScope: false,
};

test("Leave loader keeps People and branch tenant scope with safe selects", async () => {
  const captured: Array<{ kind: string; query: Record<string, unknown> }> = [];

  await loadEmployeeLeaveSection(input, createDatabase(captured));

  assert.equal(captured.length, 7);
  const serialized = JSON.stringify(captured);
  assert.match(serialized, /aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/);
  assert.match(serialized, /bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/);
  assert.match(serialized, /11111111-1111-4111-8111-111111111111/);
  assert.match(serialized, /effectiveFrom/);
  assert.match(serialized, /effectiveUntil/);
  assert.match(serialized, /"take":5/);
  assert.match(serialized, /"take":20/);

  for (const forbidden of [
    "reason",
    "reviewNote",
    "documentReference",
    "note",
    "supportingDocument",
    "medicalCertificate",
    "baseSalary",
    "payBasis",
    "payrollEntries",
    "bankAccount",
    "statutoryIdentityNumber",
    "taxNumber",
  ]) {
    assert.equal(
      serialized.includes(forbidden),
      false,
      `${forbidden} must not be selected by Leave Profile`,
    );
  }
});

test("Leave loader returns separate balance components and safe summaries", async () => {
  const data = await loadEmployeeLeaveSection(input, createDatabase([]));

  assert.ok(data);
  assert.equal(data.year, 2026);
  assert.equal(data.applicablePolicyCount, 2);
  assert.equal(data.pendingRequestCount, 2);
  assert.equal(data.approvedLeaveDays, 2.5);
  assert.equal(data.policies[0]?.entitlementDays, 10);
  assert.equal(data.policies[0]?.carriedForwardDays, 2);
  assert.equal(data.policies[0]?.adjustmentDays, -1);
  assert.equal(data.policies[0]?.usedDays, 2.5);
  assert.equal(data.policies[0]?.remainingDays, 8.5);
  assert.equal(data.policies[0]?.payTreatment, "PAID");
  assert.equal(data.policies[1]?.remainingDays, null);
  assert.equal(data.upcomingApprovedLeave.length, 1);
  assert.equal(data.recentLeaveHistory.length, 2);
  assert.deepEqual(Object.keys(data.recentLeaveHistory[0] ?? {}).sort(), [
    "endsOn",
    "id",
    "payTreatment",
    "policyName",
    "requestedDays",
    "startsOn",
    "status",
  ]);
});

test("Leave UI is read-only, bounded, and links to Leave Management", async () => {
  const root = process.cwd();
  const route = await readFile(
    path.join(root, "src/app/(business)/team/people/[personId]/page.tsx"),
    "utf8",
  );
  const component = await readFile(
    path.join(root, "src/components/employee-profile-leave.tsx"),
    "utf8",
  );
  assert.match(route, /activeSection === "leave"/);
  assert.match(component, /Open Leave Management/);
  assert.match(component, /Up to 20 requests/);
  assert.match(component, /Entitlement/);
  assert.match(component, /Carry forward/);
  assert.match(component, /Adjustment/);
  assert.doesNotMatch(component, /<form|<input|<button|action=/);

  for (const forbiddenLabel of [
    "Leave reason",
    "Review note",
    "Supporting document",
    "Medical certificate",
    "Balance note",
    "Internal HR comments",
    "Salary",
    "Payroll Entry",
    "Bank Account",
    "Statutory",
    "Tax",
    "Medical details",
    "Private attachments",
  ]) {
    assert.equal(
      component.includes(forbiddenLabel),
      false,
      `${forbiddenLabel} must not be rendered by Leave Profile`,
    );
  }
});

function createDatabase(
  captured: Array<{ kind: string; query: Record<string, unknown> }>,
) {
  const safeRequest = {
    id: "44444444-4444-4444-8444-444444444444",
    policyNameSnapshot: "Annual leave",
    payTreatmentSnapshot: "PAID",
    startsOn: new Date("2026-08-10T00:00:00.000Z"),
    endsOn: new Date("2026-08-11T00:00:00.000Z"),
    requestedDays: 2,
    status: "APPROVED",
  };
  let requestCall = 0;
  const database = {
    employeeBusinessMembership: {
      findFirst(query: Record<string, unknown>) {
        captured.push({ kind: "membership", query });
        return Promise.resolve({
          id: input.membershipId,
          joinedAt: new Date("2024-01-01T00:00:00.000Z"),
          business: { timezone: "Asia/Kuala_Lumpur" },
        });
      },
    },
    leavePolicy: {
      findMany(query: Record<string, unknown>) {
        captured.push({ kind: "policies", query });
        return Promise.resolve([
          {
            id: "55555555-5555-4555-8555-555555555555",
            code: "ANNUAL",
            name: "Annual leave",
            payTreatment: "PAID",
            countMode: "WEEKDAYS",
            balanceTracked: true,
            defaultEntitlementDays: 8,
            underTwoYearsDays: 8,
            twoToFiveYearsDays: 12,
            fiveYearsPlusDays: 16,
          },
          {
            id: "66666666-6666-4666-8666-666666666666",
            code: "UNPAID",
            name: "Unpaid leave",
            payTreatment: "UNPAID",
            countMode: "WEEKDAYS",
            balanceTracked: false,
            defaultEntitlementDays: null,
            underTwoYearsDays: null,
            twoToFiveYearsDays: null,
            fiveYearsPlusDays: null,
          },
        ]);
      },
    },
    employeeLeaveBalance: {
      findMany(query: Record<string, unknown>) {
        captured.push({ kind: "balances", query });
        return Promise.resolve([
          {
            policyId: "55555555-5555-4555-8555-555555555555",
            entitlementOverrideDays: 10,
            carriedForwardDays: 2,
            adjustmentDays: -1,
          },
        ]);
      },
    },
    leaveRequest: {
      findMany(query: Record<string, unknown>) {
        requestCall += 1;
        captured.push({ kind: `requests-${requestCall}`, query });
        if (requestCall === 1) {
          return Promise.resolve([
            {
              policyId: "55555555-5555-4555-8555-555555555555",
              days: [{ dayFraction: 1 }, { dayFraction: 1.5 }],
            },
          ]);
        }
        if (query.take === 5) {
          return Promise.resolve([safeRequest]);
        }
        return Promise.resolve([
          safeRequest,
          {
            ...safeRequest,
            id: "77777777-7777-4777-8777-777777777777",
            policyNameSnapshot: "Unpaid leave",
            payTreatmentSnapshot: "UNPAID",
            status: "REJECTED",
          },
        ]);
      },
      count(query: Record<string, unknown>) {
        captured.push({ kind: "pending-count", query });
        return Promise.resolve(2);
      },
    },
  };
  return database as unknown as PrismaClient;
}
