import { PrismaClient } from "@prisma/client";

import {
  assertCanonicalTestingContext,
  assertCanonicalTestingDatabase,
  CANONICAL_UAT_BUSINESS_SLUG,
  CANONICAL_UAT_ISOLATION_BUSINESS_SLUG,
  safeJson,
  stableFixtureId,
} from "./lib/canonical-testing-guard";

export type CanonicalUatAudit = Awaited<ReturnType<typeof auditCanonicalUat>>;

export async function auditCanonicalUat(prisma: PrismaClient) {
  const environment = assertCanonicalTestingContext(process.env);
  const database = await assertCanonicalTestingDatabase(prisma);

  const [business, isolationBusiness] = await Promise.all([
    prisma.business.findUnique({
      where: { slug: CANONICAL_UAT_BUSINESS_SLUG },
      include: {
        branches: { orderBy: { name: "asc" } },
        moduleEntitlements: { orderBy: { moduleKey: "asc" } },
        users: { orderBy: { name: "asc" } },
        employeeMemberships: {
          orderBy: { employeeCode: "asc" },
          include: { branchAssignments: true },
        },
      },
    }),
    prisma.business.findUnique({
      where: { slug: CANONICAL_UAT_ISOLATION_BUSINESS_SLUG },
      include: { branches: true, employeeMemberships: true },
    }),
  ]);

  const businessId = business?.id;
  const counts = businessId
    ? {
        customers: await prisma.customer.count({ where: { businessId } }),
        vehicles: await prisma.vehicle.count({ where: { businessId } }),
        services: await prisma.service.count({ where: { businessId } }),
        products: await prisma.product.count({ where: { businessId } }),
        stockRecords: await prisma.productStock.count({ where: { businessId } }),
        suppliers: await prisma.supplier.count({ where: { businessId } }),
        supplierBills: await prisma.supplierBill.count({ where: { businessId } }),
        appointments: await prisma.appointment.count({ where: { businessId } }),
        workOrders: await prisma.workOrder.count({ where: { businessId } }),
        invoices: await prisma.invoice.count({ where: { businessId } }),
        payments: await prisma.payment.count({ where: { businessId } }),
        refunds: await prisma.paymentRefund.count({ where: { businessId } }),
        expenses: await prisma.businessExpense.count({ where: { businessId } }),
        rosterAssignments: await prisma.rosterAssignment.count({ where: { businessId } }),
        publishedRosterAssignments: await prisma.rosterPublishedAssignment.count({
          where: { businessId },
        }),
        attendanceSessions: await prisma.employeeAttendance.count({ where: { businessId } }),
        attendanceExceptions: await prisma.attendanceException.count({ where: { businessId } }),
        attendanceOtFinalResults: await prisma.attendanceP2FinalResult.count({
          where: {
            businessId,
            id: {
              in: [
                stableFixtureId("attendance.final-result.ot.staff"),
                stableFixtureId("attendance.final-result.ot.manager-self"),
              ],
            },
          },
        }),
        leaveRequests: await prisma.leaveRequest.count({ where: { businessId } }),
        claims: await prisma.employeeClaim.count({ where: { businessId } }),
        commissionStatements: await prisma.commissionStatement.count({ where: { businessId } }),
        payrollRuns: await prisma.payrollRun.count({ where: { businessId } }),
        payrollEntries: await prisma.payrollEntry.count({ where: { businessId } }),
        payslips: await prisma.payrollPayslipPublication.count({ where: { businessId } }),
      }
    : null;

  const mainBranch = business?.branches.find((branch) => branch.name === "UAT MAIN BRANCH");
  const secondBranch = business?.branches.find(
    (branch) => branch.name === "UAT SECOND BRANCH",
  );
  const manager = business?.employeeMemberships.find(
    (membership) => membership.employeeCode === "UAT-MANAGER",
  );
  const staff = business?.employeeMemberships.find(
    (membership) => membership.employeeCode === "UAT-STAFF",
  );
  const managerUser = business?.users.find((user) => user.name === "Canonical UAT Manager");
  const enabledModules = business
    ? [
        "CORE" as const,
        ...business.moduleEntitlements
          .filter((entitlement) => entitlement.status === "ENABLED")
          .map((entitlement) => entitlement.moduleKey),
      ]
    : [];

  const sameDateMultiSession =
    businessId && staff
      ? await prisma.employeeAttendance.groupBy({
          by: ["workDate"],
          where: { businessId, membershipId: staff.id },
          _count: { id: true },
          having: { id: { _count: { gte: 2 } } },
        })
      : [];
  const ownPending =
    businessId && manager
      ? {
          leave: await prisma.leaveRequest.count({
            where: { businessId, membershipId: manager.id, status: "PENDING" },
          }),
          claims: await prisma.employeeClaim.count({
            where: { businessId, membershipId: manager.id, status: "SUBMITTED" },
          }),
        }
      : { leave: 0, claims: 0 };

  const minimumCounts = {
    customers: 1,
    vehicles: 1,
    services: 1,
    products: 1,
    stockRecords: 1,
    suppliers: 1,
    supplierBills: 1,
    appointments: 2,
    workOrders: 1,
    invoices: 1,
    payments: 1,
    refunds: 1,
    expenses: 1,
    rosterAssignments: 1,
    publishedRosterAssignments: 1,
    attendanceSessions: 4,
    attendanceExceptions: 1,
    attendanceOtFinalResults: 2,
    leaveRequests: 3,
    claims: 3,
    commissionStatements: 1,
    payrollRuns: 1,
    payrollEntries: 1,
    payslips: 1,
  } as const;
  const missingFixtures = counts
    ? Object.entries(minimumCounts)
        .filter(([key, minimum]) => counts[key as keyof typeof counts] < minimum)
        .map(([key, minimum]) => `${key}<${minimum}`)
    : ["canonical business"];

  const requiredModules = [
    "CORE",
    "POS",
    "SALON",
    "INVENTORY",
    "HR",
    "PAYROLL",
    "CLAIMS",
    "COMMISSION",
    "EXPENSE",
  ];
  for (const moduleKey of requiredModules) {
    if (!enabledModules.includes(moduleKey as (typeof enabledModules)[number])) {
      missingFixtures.push(`module:${moduleKey}`);
    }
  }
  if (!mainBranch) missingFixtures.push("branch:UAT MAIN BRANCH");
  if (!secondBranch) missingFixtures.push("branch:UAT SECOND BRANCH");
  if (!manager) missingFixtures.push("membership:UAT-MANAGER");
  if (!staff) missingFixtures.push("membership:UAT-STAFF");
  if (sameDateMultiSession.length === 0) missingFixtures.push("attendance:same-date-multi-session");

  const managerPermissions = managerUser?.permissions ?? [];
  const security = {
    tenantIsolationReady: Boolean(isolationBusiness?.branches.length),
    branchIsolationReady: Boolean(
      mainBranch &&
        secondBranch &&
        manager?.branchAssignments.some((assignment) => assignment.branchId === mainBranch.id) &&
        !manager?.branchAssignments.some((assignment) => assignment.branchId === secondBranch.id),
    ),
    selfApprovalNegativeReady: ownPending.leave > 0 && ownPending.claims > 0,
    normalStaffHasNoManagerPermissions: Boolean(
      business?.users
        .find((user) => user.name === "Canonical UAT Staff")
        ?.permissions.every(
          (permission) =>
            !["APPROVE_LEAVE", "REVIEW_CLAIM", "ATTENDANCE_EMPLOYEE_MANAGE"].includes(
              permission,
            ),
        ),
    ),
    managerApprovalCapabilitiesReady: [
      "APPROVE_LEAVE",
      "REVIEW_CLAIM",
      "ATTENDANCE_EMPLOYEE_MANAGE",
    ].every((permission) => managerPermissions.includes(permission)),
    payrollIsolationReady: !managerPermissions.some((permission) =>
      permission.includes("PAYROLL"),
    ),
    payslipOwnOnlyFixtureReady: Boolean(staff && counts?.payslips),
  };

  const ready =
    missingFixtures.length === 0 && Object.values(security).every(Boolean);

  return {
    mode: "READ_ONLY" as const,
    ready,
    environment,
    database,
    canonicalBusiness: business
      ? { id: business.id, name: business.name, slug: business.slug, status: business.status }
      : null,
    isolationBusiness: isolationBusiness
      ? {
          id: isolationBusiness.id,
          name: isolationBusiness.name,
          slug: isolationBusiness.slug,
          status: isolationBusiness.status,
        }
      : null,
    branches: business?.branches.map(({ id, name, status }) => ({ id, name, status })) ?? [],
    identities:
      business?.users.map(({ id, name, role, permissions, status }) => ({
        id,
        name,
        role,
        permissions,
        status,
      })) ?? [],
    memberships:
      business?.employeeMemberships.map((membership) => ({
        id: membership.id,
        employeeCode: membership.employeeCode,
        fullName: membership.fullName,
        status: membership.status,
        branchIds: membership.branchAssignments.map((assignment) => assignment.branchId),
      })) ?? [],
    enabledModules,
    counts,
    security,
    sameDateMultiSessionDays: sameDateMultiSession.length,
    missingFixtures,
    externalSideEffectSafety: "NO_EXTERNAL_PROVIDER_IMPORTS_OR_CALLS",
  };
}

async function main() {
  const prisma = new PrismaClient();
  try {
    const report = await auditCanonicalUat(prisma);
    console.log(safeJson(report));
    if (!report.ready) process.exitCode = 2;
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1]?.endsWith("audit-testing-canonical-uat.ts")) {
  void main();
}
