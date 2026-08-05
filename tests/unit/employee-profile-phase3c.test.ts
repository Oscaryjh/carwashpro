import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";
import type { ResolvedBusinessAccess } from "../../src/lib/business-groups/business-access";
import { loadEmployeePayrollNavigationSection } from "../../src/lib/team/employee-profile-payroll-navigation-read";

const businessId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const membershipId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

test("Phase 3C exposes canonical Payroll Runs link without loading payroll entries", async () => {
  let payrollEntryQueries = 0;
  const database = {
    branch: { count: () => Promise.resolve(1) },
    payrollEntry: {
      findFirst: () => {
        payrollEntryQueries += 1;
        return Promise.resolve(null);
      },
    },
  } as unknown as PrismaClient;

  const result = await loadEmployeePayrollNavigationSection(
    profileInput(["VIEW_PAYROLL_RUN", "ALL_BRANCHES"]),
    database,
  );

  assert.deepEqual(result.payrollRuns, {
    status: "AVAILABLE",
    href: "/team/payroll/runs",
  });
  assert.deepEqual(result.payslip, { status: "HIDDEN" });
  assert.equal(payrollEntryQueries, 0);
});

test("Phase 3C loads only the latest finalized payslip link metadata", async () => {
  const calls: unknown[] = [];
  const database = {
    branch: { count: () => Promise.resolve(1) },
    payrollEntry: {
      findFirst(query: unknown) {
        calls.push(query);
        return Promise.resolve({
          id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          payrollRun: { periodStart: new Date("2026-07-01T00:00:00.000Z") },
        });
      },
    },
  } as unknown as PrismaClient;

  const result = await loadEmployeePayrollNavigationSection(
    profileInput(["VIEW_PAYSLIP", "ALL_BRANCHES"]),
    database,
  );

  assert.deepEqual(result.payslip, {
    status: "AVAILABLE",
    href: "/team/payroll/payslips/cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    periodStart: "2026-07-01T00:00:00.000Z",
  });
  assert.equal(calls.length, 1);
  const query = JSON.stringify(calls[0]);
  assert.match(query, /FINALIZED/);
  assert.match(query, new RegExp(businessId));
  assert.match(query, new RegExp(membershipId));
  assert.match(query, /periodStart/);
  assert.doesNotMatch(
    query,
    /baseRate|basicPay|grossPay|netPay|allowances|deduction|epfEmployee|socsoEmployee|eisEmployee|pcb|notes|fullNameSnapshot/i,
  );
});

test("Phase 3C does not query a payslip outside whole-business scope", async () => {
  let payrollEntryQueries = 0;
  const database = {
    branch: { count: () => Promise.resolve(2) },
    payrollEntry: {
      findFirst: () => {
        payrollEntryQueries += 1;
        return Promise.resolve(null);
      },
    },
  } as unknown as PrismaClient;

  const result = await loadEmployeePayrollNavigationSection(
    profileInput(["VIEW_PAYSLIP"]),
    database,
  );

  assert.deepEqual(result.payslip, {
    status: "ACCESS_DENIED",
    reason: "WHOLE_BUSINESS_SCOPE",
  });
  assert.equal(payrollEntryQueries, 0);
});

test("Phase 3C truthfully keeps Payment unavailable without querying the domain", async () => {
  const database = {
    branch: { count: () => Promise.resolve(1) },
    payrollEntry: {
      findFirst: () => {
        throw new Error("Payslip query must not run");
      },
    },
  } as unknown as PrismaClient;

  const result = await loadEmployeePayrollNavigationSection(
    profileInput(["VIEW_PAYMENT_BATCH", "ALL_BRANCHES"]),
    database,
  );

  assert.deepEqual(result.payment, { status: "NOT_AVAILABLE" });
  assert.deepEqual(result.payrollRuns, { status: "HIDDEN" });
  assert.deepEqual(result.payslip, { status: "HIDDEN" });
});

test("Phase 3C performs no navigation query without a matching capability", async () => {
  let queryCount = 0;
  const database = {
    branch: {
      count: () => {
        queryCount += 1;
        return Promise.resolve(1);
      },
    },
    payrollEntry: {
      findFirst: () => {
        queryCount += 1;
        return Promise.resolve(null);
      },
    },
  } as unknown as PrismaClient;

  const result = await loadEmployeePayrollNavigationSection(
    profileInput(["VIEW_COMPENSATION", "ALL_BRANCHES"]),
    database,
  );

  assert.equal(queryCount, 0);
  assert.deepEqual(
    Object.values(result).map((state) => state.status),
    ["HIDDEN", "HIDDEN", "HIDDEN"],
  );
});

test("Phase 3C navigation remains truthful after the scoped Phase 4A editing surface", async () => {
  const root = process.cwd();
  const [route, loader, component, styles] = await Promise.all([
    readFile(path.join(root, "src/app/(business)/team/people/[personId]/page.tsx"), "utf8"),
    readFile(path.join(root, "src/lib/team/employee-profile-payroll-navigation-read.ts"), "utf8"),
    readFile(path.join(root, "src/components/employee-profile-payroll.tsx"), "utf8"),
    readFile(path.join(root, "src/components/employee-profile-shell.module.css"), "utf8"),
  ]);

  assert.match(route, /loadEmployeePayrollNavigationSection/);
  assert.match(loader, /VIEW_PAYROLL_RUN/);
  assert.match(loader, /VIEW_PAYSLIP/);
  assert.match(loader, /VIEW_PAYMENT_BATCH/);
  assert.match(component, /View Payroll Runs/);
  assert.match(component, /Download PDF/);
  assert.match(component, /Available for download/);
  assert.match(component, /Payment tracking is not available/);
  assert.match(component, /Finalized means calculations are locked/);
  assert.match(styles, /@media \(max-width: 760px\)/);
  assert.match(styles, /\.payrollActionGrid/);
  assert.doesNotMatch(component, /Publish payslip|Process payment/);
  assert.doesNotMatch(component, /Published|Delivered|Viewed|Sent/);
  assert.doesNotMatch(loader, /bankAccount|paymentBatch|grossPay|netPay|basicPay/);
});

function profileInput(permissions: string[]) {
  return {
    access: buildAccess(permissions),
    allowedBranchIds: ["branch-1"],
    businessId,
    membershipId,
  };
}

function buildAccess(permissions: string[]): ResolvedBusinessAccess {
  return {
    granted: true,
    userId: "user-1",
    homeBusinessId: businessId,
    businessId,
    branchId: "branch-1",
    identityRole: "STAFF",
    actorRole: "STAFF",
    effectiveBusinessRole: "STAFF",
    permissions,
    industryType: "SALON_BEAUTY",
    source: "DIRECT_BUSINESS",
    groupId: null,
    groupUserId: null,
    capability: null,
  };
}
