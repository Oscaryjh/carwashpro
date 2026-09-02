import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const CORE_ARTIFACT = join(process.cwd(), ".tmp", "hr-payroll-core-acceptance.json");
const OUTPUT_PATH = join(process.cwd(), ".tmp", "staff-3000-approval-uat.json");

type CoreArtifact = {
  environment: string;
  productionAccessed: boolean;
  businessId: string;
  branchId: string;
  managerEmail: string;
  employeeMemberships: Record<string, { membershipId: string }>;
};

function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function assertLocalOnly() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("STAFF_3000_APPROVAL_UAT_FORBIDDEN_IN_PRODUCTION");
  }
  const value = process.env.DATABASE_URL;
  if (!value) throw new Error("DATABASE_URL is required.");
  const hostname = new URL(value).hostname.toLowerCase();
  if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(hostname)) {
    throw new Error("STAFF_3000_APPROVAL_UAT_REQUIRES_A_LOCAL_DATABASE");
  }
}

async function main() {
  assertLocalOnly();
  const artifact = JSON.parse(await readFile(CORE_ARTIFACT, "utf8")) as CoreArtifact;
  if (artifact.environment !== "LOCAL / TESTING ONLY" || artifact.productionAccessed !== false) {
    throw new Error("STAFF_3000_APPROVAL_UAT_REQUIRES_LOCAL_CORE_ARTIFACT");
  }

  const targetMembershipId = artifact.employeeMemberships["CORE-B"]?.membershipId;
  if (!targetMembershipId) throw new Error("CORE_B_MEMBERSHIP_IS_MISSING");

  const prepared = await prisma.$transaction(async (tx) => {
    const [manager, membership, policy, category] = await Promise.all([
      tx.user.findFirstOrThrow({
        where: { businessId: artifact.businessId, email: artifact.managerEmail },
        select: { id: true, employeeBusinessMembershipId: true },
      }),
      tx.employeeBusinessMembership.findFirstOrThrow({
        where: { id: targetMembershipId, businessId: artifact.businessId },
        select: { id: true, fullName: true },
      }),
      tx.leavePolicy.findFirstOrThrow({
        where: { businessId: artifact.businessId, active: true },
        orderBy: { createdAt: "asc" },
        include: { versions: { where: { status: "ACTIVE" }, orderBy: { revision: "desc" }, take: 1 } },
      }),
      tx.claimCategory.findFirstOrThrow({
        where: { businessId: artifact.businessId, active: true },
        orderBy: { createdAt: "asc" },
        include: { policyRevisions: { where: { status: "ACTIVE" }, orderBy: { revision: "desc" }, take: 1 } },
      }),
    ]);
    if (!manager.employeeBusinessMembershipId) throw new Error("MANAGER_STAFF_LINK_IS_MISSING");
    const policyVersion = policy.versions[0];
    const claimPolicyRevision = category.policyRevisions[0];
    if (!policyVersion || !claimPolicyRevision) throw new Error("APPROVAL_POLICY_VERSION_IS_MISSING");

    const leaveDate = new Date("2026-09-15T00:00:00.000Z");
    const leave = await tx.leaveRequest.create({
      data: {
        businessId: artifact.businessId,
        membershipId: membership.id,
        branchId: artifact.branchId,
        policyId: policy.id,
        policyVersionId: policyVersion.id,
        policyNameSnapshot: policy.name,
        payTreatmentSnapshot: policy.payTreatment,
        balanceTrackedSnapshot: policy.balanceTracked,
        legalStatusSnapshot: policy.legalStatus,
        complianceStatusSnapshot: "NOT_APPLICABLE",
        leaveUnit: "FULL_DAY",
        startsOn: leaveDate,
        endsOn: leaveDate,
        requestedDays: 1,
        reason: "Staff 3000 manager approval UAT leave request.",
        status: "PENDING",
        revision: 0,
        clientRequestId: randomUUID(),
        days: {
          create: {
            businessId: artifact.businessId,
            membershipId: membership.id,
            leaveDate,
            dayFraction: 1,
            leaveUnit: "FULL_DAY",
            expectedDayKindSnapshot: "WORKDAY",
            policyVersionId: policyVersion.id,
            payTreatmentSnapshot: policy.payTreatment,
            balanceConsumptionUnits: 1,
          },
        },
      },
    });

    const claim = await tx.employeeClaim.create({
      data: {
        businessId: artifact.businessId,
        membershipId: membership.id,
        branchId: artifact.branchId,
        claimNumber: `UAT-${Date.now().toString(36).toUpperCase()}`,
        clientRequestId: randomUUID(),
        purpose: "Staff 3000 manager approval UAT claim.",
        status: "SUBMITTED",
        submittedTotal: 42.5,
        revision: 1,
        submittedAt: new Date(),
        lines: {
          create: {
            lineNumber: 1,
            categoryId: category.id,
            policyRevisionId: claimPolicyRevision.id,
            categoryCodeSnapshot: category.code,
            categoryNameSnapshot: category.name,
            expenseNatureSnapshot: category.nature,
            expenseDate: new Date("2026-08-28T00:00:00.000Z"),
            description: "Local testing transport receipt.",
            submittedAmount: 42.5,
            receiptRequiredSnapshot: false,
            statutoryTreatmentStatus: "VERIFIED_NON_WAGE",
            reviewStatus: "PENDING",
          },
        },
      },
    });

    const attendanceException = await tx.attendanceP2Exception.upsert({
      where: { stableKey: `staff3000:approval-uat:${artifact.businessId}:missing-clock-out` },
      update: {
        status: "OPEN",
        revision: { increment: 1 },
        resolvedAt: null,
      },
      create: {
        businessId: artifact.businessId,
        branchId: artifact.branchId,
        membershipId: membership.id,
        workDate: new Date("2026-08-28T00:00:00.000Z"),
        type: "MISSING_CLOCK_OUT",
        stableKey: `staff3000:approval-uat:${artifact.businessId}:missing-clock-out`,
        actualClockInAt: new Date("2026-08-28T01:00:00.000Z"),
        reasonCode: "MISSING_CLOCK_OUT",
        sourceDigest: digest("staff-3000-approval-uat-attendance"),
      },
    });

    const overtime = [];
    for (const [index, day] of [3, 4, 5].entries()) {
      const workDate = new Date(`2026-09-${String(day).padStart(2, "0")}T00:00:00.000Z`);
      const expectedStartAt = new Date(`2026-09-${String(day).padStart(2, "0")}T01:00:00.000Z`);
      const expectedEndAt = new Date(`2026-09-${String(day).padStart(2, "0")}T09:00:00.000Z`);
      const expected = await tx.attendanceExpectedDay.create({
        data: {
          businessId: artifact.businessId,
          branchId: artifact.branchId,
          membershipId: membership.id,
          workDate,
          kind: "WORKDAY",
          source: "MANUAL_EVIDENCE",
          expectedStartAt,
          expectedEndAt,
          timezoneSnapshot: "Asia/Kuala_Lumpur",
          evidenceReference: "STAFF_3000_APPROVAL_UAT",
          createdById: manager.id,
        },
      });
      const result = await tx.attendanceP2FinalResult.create({
        data: {
          businessId: artifact.businessId,
          branchId: artifact.branchId,
          membershipId: membership.id,
          workDate,
          version: 1,
          outcome: "PRESENT",
          expectedDayKindSnapshot: "WORKDAY",
          expectedDayId: expected.id,
          expectedStartAt,
          expectedEndAt,
          actualClockInAt: expectedStartAt,
          actualClockOutAt: new Date(expectedEndAt.getTime() + (60 + index * 30) * 60_000),
          totalBreakMinutes: 0,
          totalWorkedMinutes: 540 + index * 30,
          sourceDigest: digest(`staff-3000-approval-uat-ot-source-${day}`),
          resolutionDigest: digest(`staff-3000-approval-uat-ot-resolution-${day}`),
          createdById: manager.id,
        },
      });
      const review = await tx.attendanceOvertimeReview.create({
        data: {
          businessId: artifact.businessId,
          branchId: artifact.branchId,
          membershipId: membership.id,
          workDate,
          finalResultId: result.id,
          finalResultVersion: result.version,
          expectedDayId: expected.id,
          status: "PENDING_REVIEW",
          context: "NORMAL",
          potentialOtMinutes: 60 + index * 30,
          approvedOtMinutes: 0,
          sourceDigest: digest(`staff-3000-approval-uat-ot-review-${day}`),
          revision: 0,
        },
      });
      overtime.push({ finalResultId: result.id, reviewId: review.id, workDate: workDate.toISOString().slice(0, 10) });
    }

    return {
      managerMembershipId: manager.employeeBusinessMembershipId,
      targetMembershipId: membership.id,
      targetEmployeeName: membership.fullName,
      leaveId: leave.id,
      claimId: claim.id,
      attendanceExceptionId: attendanceException.id,
      overtime,
    };
  }, { timeout: 30_000 });

  const output = {
    environment: "LOCAL / TESTING ONLY",
    productionAccessed: false,
    businessId: artifact.businessId,
    branchId: artifact.branchId,
    ...prepared,
  };
  await mkdir(join(process.cwd(), ".tmp"), { recursive: true });
  await writeFile(OUTPUT_PATH, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({
    environment: output.environment,
    businessId: output.businessId,
    pending: { leave: 1, claims: 1, attendance: 1, overtime: output.overtime.length },
    outputPath: OUTPUT_PATH,
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : "UNKNOWN_APPROVAL_UAT_FIXTURE_ERROR");
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
