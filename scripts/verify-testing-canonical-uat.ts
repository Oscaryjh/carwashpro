import { PrismaClient } from "@prisma/client";

import { auditCanonicalUat } from "./audit-testing-canonical-uat";
import {
  CANONICAL_FIXTURE_KEYS,
  CANONICAL_UAT_NAMESPACE,
  CANONICAL_UAT_BUSINESS_SLUG,
  CANONICAL_UAT_ISOLATION_BUSINESS_SLUG,
  fixtureMarker,
  safeJson,
  stableFixtureId,
} from "./lib/canonical-testing-guard";

export async function verifyCanonicalUat(prisma: PrismaClient) {
  const audit = await auditCanonicalUat(prisma);
  const business = await prisma.business.findUniqueOrThrow({
    where: { slug: CANONICAL_UAT_BUSINESS_SLUG },
    include: {
      branches: true,
      users: true,
      employeeMemberships: { include: { branchAssignments: true } },
      customers: true,
    },
  });
  const isolationBusiness = await prisma.business.findUniqueOrThrow({
    where: { slug: CANONICAL_UAT_ISOLATION_BUSINESS_SLUG },
    include: { branches: true },
  });
  const manager = business.employeeMemberships.find(
    (membership) => membership.id === stableFixtureId("membership.manager"),
  );
  const staff = business.employeeMemberships.find(
    (membership) => membership.id === stableFixtureId("membership.staff"),
  );
  const managerUser = business.users.find(
    (user) => user.id === stableFixtureId("user.manager"),
  );
  const staffUser = business.users.find((user) => user.id === stableFixtureId("user.staff"));
  const mainBranchId = stableFixtureId("branch.main");
  const secondBranchId = stableFixtureId("branch.second");

  const [multiSession, pendingAttendance, pendingLeave, pendingClaim, managerOwnLeave, managerOwnClaim] =
    await Promise.all([
      staff
        ? prisma.employeeAttendance.groupBy({
            by: ["workDate"],
            where: { businessId: business.id, membershipId: staff.id },
            _count: { id: true },
            having: { id: { _count: { gte: 2 } } },
          })
        : Promise.resolve([]),
      prisma.attendanceException.count({
        where: {
          id: stableFixtureId("attendance.exception.pending"),
          businessId: business.id,
          branchId: mainBranchId,
          status: "PENDING",
        },
      }),
      prisma.leaveRequest.count({
        where: {
          id: stableFixtureId("leave-request.pending"),
          businessId: business.id,
          membershipId: staff?.id,
          status: "PENDING",
        },
      }),
      prisma.employeeClaim.count({
        where: {
          id: stableFixtureId("claim.pending"),
          businessId: business.id,
          membershipId: staff?.id,
          status: "SUBMITTED",
        },
      }),
      prisma.leaveRequest.count({
        where: {
          id: stableFixtureId("leave-request.manager-self"),
          businessId: business.id,
          membershipId: manager?.id,
          status: "PENDING",
        },
      }),
      prisma.employeeClaim.count({
        where: {
          id: stableFixtureId("claim.manager-self"),
          businessId: business.id,
          membershipId: manager?.id,
          status: "SUBMITTED",
        },
      }),
    ]);

  const staffPayslip = await prisma.payrollPayslipPublication.findUnique({
    where: { id: stableFixtureId("payslip.staff") },
    include: { payrollEntry: true },
  });
  const expectedPayslipHash = staffPayslip
    ? (await import("node:crypto"))
        .createHash("sha256")
        .update(Buffer.from(staffPayslip.documentBytes))
        .digest("hex")
    : null;
  const overtimeFinalResults = await prisma.attendanceP2FinalResult.findMany({
    where: {
      id: {
        in: [
          stableFixtureId("attendance.final-result.ot.staff"),
          stableFixtureId("attendance.final-result.ot.manager-self"),
        ],
      },
      businessId: business.id,
      branchId: mainBranchId,
    },
    select: {
      id: true,
      membershipId: true,
      expectedEndAt: true,
      actualClockOutAt: true,
    },
  });
  const staffOtResult = overtimeFinalResults.find(
    (row) => row.id === stableFixtureId("attendance.final-result.ot.staff"),
  );
  const managerSelfOtResult = overtimeFinalResults.find(
    (row) => row.id === stableFixtureId("attendance.final-result.ot.manager-self"),
  );

  const markerNeedle = CANONICAL_UAT_NAMESPACE;
  const markerPopulation = Object.fromEntries(
    await Promise.all([
      ["business", prisma.business.count({ where: { address: { contains: markerNeedle } } }), 2],
      ["branch", prisma.branch.count({ where: { address: { contains: markerNeedle } } }), 3],
      [
        "moduleEntitlement",
        prisma.businessModuleEntitlement.count({
          where: { planCode: { contains: markerNeedle } },
        }),
        9,
      ],
      ["customer", prisma.customer.count({ where: { notes: { contains: markerNeedle } } }), 2],
      ["vehicle", prisma.vehicle.count({ where: { notes: { contains: markerNeedle } } }), 1],
      ["service", prisma.service.count({ where: { description: { contains: markerNeedle } } }), 1],
      ["product", prisma.product.count({ where: { description: { contains: markerNeedle } } }), 1],
      ["supplier", prisma.supplier.count({ where: { notes: { contains: markerNeedle } } }), 1],
      [
        "purchaseOrder",
        prisma.purchaseOrder.count({ where: { notes: { contains: markerNeedle } } }),
        1,
      ],
      [
        "purchaseOrderLine",
        prisma.purchaseOrderLine.count({ where: { notes: { contains: markerNeedle } } }),
        1,
      ],
      [
        "supplierBill",
        prisma.supplierBill.count({ where: { notes: { contains: markerNeedle } } }),
        1,
      ],
      ["appointment", prisma.appointment.count({ where: { notes: { contains: markerNeedle } } }), 2],
      ["workOrder", prisma.workOrder.count({ where: { notes: { contains: markerNeedle } } }), 1],
      ["payment", prisma.payment.count({ where: { reference: { contains: markerNeedle } } }), 1],
      ["paymentRefund", prisma.paymentRefund.count({ where: { reason: { contains: markerNeedle } } }), 1],
      [
        "expenseCategory",
        prisma.expenseCategory.count({ where: { description: { contains: markerNeedle } } }),
        1,
      ],
      [
        "businessExpense",
        prisma.businessExpense.count({ where: { description: { contains: markerNeedle } } }),
        1,
      ],
      [
        "rosterAssignment",
        prisma.rosterAssignment.count({ where: { note: { contains: markerNeedle } } }),
        1,
      ],
      [
        "rosterPublication",
        prisma.rosterPublication.count({ where: { operationKey: { contains: markerNeedle } } }),
        1,
      ],
      [
        "publishedRosterAssignment",
        prisma.rosterPublishedAssignment.count({
          where: { evidenceReference: { contains: markerNeedle } },
        }),
        1,
      ],
      [
        "attendancePunch",
        prisma.attendancePunch.count({ where: { deviceId: { contains: markerNeedle } } }),
        7,
      ],
      [
        "attendanceException",
        prisma.attendanceException.count({ where: { reason: { contains: markerNeedle } } }),
        1,
      ],
      [
        "attendanceExpectedDay",
        prisma.attendanceExpectedDay.count({
          where: { evidenceReference: { contains: markerNeedle } },
        }),
        2,
      ],
      [
        "leavePolicyVersion",
        prisma.leavePolicyVersion.count({ where: { reason: { contains: markerNeedle } } }),
        1,
      ],
      [
        "leaveBalance",
        prisma.employeeLeaveBalance.count({ where: { note: { contains: markerNeedle } } }),
        1,
      ],
      ["leaveRequest", prisma.leaveRequest.count({ where: { reason: { contains: markerNeedle } } }), 3],
      [
        "claimCategory",
        prisma.claimCategory.count({ where: { description: { contains: markerNeedle } } }),
        1,
      ],
      ["claimPolicy", prisma.claimPolicyRevision.count({ where: { reason: { contains: markerNeedle } } }), 1],
      ["claim", prisma.employeeClaim.count({ where: { purpose: { contains: markerNeedle } } }), 3],
      ["claimLine", prisma.claimLine.count({ where: { description: { contains: markerNeedle } } }), 3],
      [
        "commissionPeriod",
        prisma.commissionPeriod.count({ where: { approvalReason: { contains: markerNeedle } } }),
        1,
      ],
      ["payrollEntry", prisma.payrollEntry.count({ where: { notes: { contains: markerNeedle } } }), 1],
    ].map(async ([name, countPromise, expected]) => [
      name,
      { actual: await countPromise, expected },
    ])),
  ) as Record<string, { actual: number; expected: number }>;
  const markerPopulationExact = Object.values(markerPopulation).every(
    ({ actual, expected }) => actual === expected,
  );
  const stableFixtureIdsUnique =
    new Set(CANONICAL_FIXTURE_KEYS.map(stableFixtureId)).size === CANONICAL_FIXTURE_KEYS.length;

  const checks = {
    auditReady: audit.ready,
    canonicalBusinessIdentity:
      business.id === stableFixtureId("business.primary") &&
      business.address === fixtureMarker("business.primary"),
    isolationBusinessIdentity:
      isolationBusiness.id === stableFixtureId("business.isolation") &&
      isolationBusiness.address === fixtureMarker("business.isolation"),
    branchRelationships:
      business.branches.some((branch) => branch.id === mainBranchId) &&
      business.branches.some((branch) => branch.id === secondBranchId) &&
      isolationBusiness.branches.some(
        (branch) => branch.id === stableFixtureId("branch.isolation"),
      ),
    managerMainBranchOnly:
      Boolean(manager) &&
      manager?.branchAssignments.some((assignment) => assignment.branchId === mainBranchId) &&
      !manager?.branchAssignments.some((assignment) => assignment.branchId === secondBranchId),
    staffHasBothBranches:
      Boolean(staff) &&
      staff?.branchAssignments.some((assignment) => assignment.branchId === mainBranchId) &&
      staff?.branchAssignments.some((assignment) => assignment.branchId === secondBranchId),
    managerApprovalCapabilities:
      Boolean(managerUser) &&
      ["APPROVE_LEAVE", "REVIEW_CLAIM", "ATTENDANCE_EMPLOYEE_MANAGE"].every(
        (permission) => managerUser?.permissions.includes(permission),
      ),
    normalStaffPermissions: staffUser?.permissions.length === 0,
    multiSessionAttendance: multiSession.length > 0,
    attendanceApprovalFixture: pendingAttendance === 1,
    subordinateOtApprovalFixture: Boolean(
      staffOtResult &&
        staffOtResult.membershipId === staff?.id &&
        staffOtResult.expectedEndAt &&
          staffOtResult.actualClockOutAt &&
        staffOtResult.actualClockOutAt > staffOtResult.expectedEndAt,
    ),
    managerSelfOtNegativeFixture:
      managerSelfOtResult?.membershipId === manager?.id && manager?.id !== staff?.id,
    subordinateLeaveFixture: pendingLeave === 1,
    subordinateClaimFixture: pendingClaim === 1,
    selfApprovalNegativeFixtures: managerOwnLeave === 1 && managerOwnClaim === 1,
    payrollPayslipRelationship:
      Boolean(staffPayslip && staff) &&
      staffPayslip?.membershipId === staff?.id &&
      staffPayslip?.payrollEntry.membershipId === staff?.id,
    payslipIntegrity:
      Boolean(staffPayslip) &&
      Buffer.from(staffPayslip?.documentBytes ?? []).subarray(0, 4).toString("ascii") === "%PDF" &&
      staffPayslip?.documentSha256 === expectedPayslipHash,
    noRealCustomerContactData: business.customers.every(
      (customer) =>
        customer.phone.startsWith("+6011000000") &&
        (!customer.email || customer.email.endsWith("@invalid.test")),
    ),
    noProductionReference: !JSON.stringify({
      business: { name: business.name, slug: business.slug, address: business.address },
      isolationBusiness: {
        name: isolationBusiness.name,
        slug: isolationBusiness.slug,
        address: isolationBusiness.address,
      },
    }).match(/production|\bprod\b/i),
    markerPopulationExact,
    stableFixtureIdsUnique,
  };

  const failures = Object.entries(checks)
    .filter(([, value]) => value !== true && value !== false)
    .map(([key]) => `${key}:invalid`);
  for (const [key, value] of Object.entries(checks)) {
    if (value !== true) {
      failures.push(key);
    }
  }

  return {
    mode: "READ_ONLY" as const,
    ready: failures.length === 0,
    checks,
    markerPopulation,
    failures: [...new Set(failures)],
    audit,
  };
}

async function main() {
  const prisma = new PrismaClient();
  try {
    const report = await verifyCanonicalUat(prisma);
    console.log(safeJson(report));
    if (!report.ready) process.exitCode = 2;
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1]?.endsWith("verify-testing-canonical-uat.ts")) {
  void main();
}
