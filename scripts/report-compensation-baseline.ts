import { createHash } from "node:crypto";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const activationMonth = new Date("2026-08-01T00:00:00.000Z");

async function main() {
  const [businesses, payrollRuns] = await Promise.all([
    prisma.business.findMany({
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        employeeMemberships: {
          select: {
            baseSalary: true,
            payBasis: true,
            status: true,
            terminatedAt: true,
          },
        },
        compensationVersions: {
          where: {
            effectiveFromMonth: activationMonth,
            source: "LEGACY_BASELINE",
          },
          select: { id: true },
        },
      },
    }),
    prisma.payrollRun.findMany({
      orderBy: [{ periodStart: "asc" }, { id: "asc" }],
      select: {
        id: true,
        periodStart: true,
        status: true,
        entries: {
          orderBy: { id: "asc" },
          select: {
            baseRateSnapshot: true,
            basicPay: true,
            compensationVersionId: true,
            grossPay: true,
            id: true,
            membershipId: true,
            netPay: true,
            payBasisSnapshot: true,
          },
        },
      },
    }),
  ]);

  const summary = businesses.map((business) => ({
    business: business.name,
    baselineCreated: business.compensationVersions.length,
    inactiveMemberships: business.employeeMemberships.filter(
      (membership) => membership.status !== "ACTIVE",
    ).length,
    membershipCount: business.employeeMemberships.length,
    missingBaseRate: business.employeeMemberships.filter(
      (membership) => membership.baseSalary === null,
    ).length,
    missingPayBasis: business.employeeMemberships.filter(
      (membership) => membership.payBasis === null,
    ).length,
    terminatedMemberships: business.employeeMemberships.filter(
      (membership) =>
        membership.status === "TERMINATED" || membership.terminatedAt !== null,
    ).length,
    validPayConfiguration: business.employeeMemberships.filter(
      (membership) =>
        membership.payBasis !== null && membership.baseSalary !== null,
    ).length,
  }));

  const staffWithoutMembership = await prisma.user.count({
    where: {
      employeeBusinessMembershipId: null,
      role: "STAFF",
    },
  });
  const payrollRunDigests = payrollRuns.map((run) => ({
    digest: createHash("sha256")
      .update(
        JSON.stringify(
          run.entries.map((entry) => ({
            baseRateSnapshot: entry.baseRateSnapshot.toString(),
            basicPay: entry.basicPay.toString(),
            grossPay: entry.grossPay.toString(),
            id: entry.id,
            membershipId: entry.membershipId,
            netPay: entry.netPay.toString(),
            payBasisSnapshot: entry.payBasisSnapshot,
          })),
        ),
      )
      .digest("hex"),
    entryCount: run.entries.length,
    legacyEntrySnapshots: run.entries.filter(
      (entry) => entry.compensationVersionId === null,
    ).length,
    period: run.periodStart.toISOString().slice(0, 7),
    runId: run.id,
    status: run.status,
  }));

  console.log(
    JSON.stringify(
      {
        activationMonth: "2026-08",
        businessSummary: summary,
        membershipCount: summary.reduce(
          (total, item) => total + item.membershipCount,
          0,
        ),
        baselineCreated: summary.reduce(
          (total, item) => total + item.baselineCreated,
          0,
        ),
        missingConfiguration: summary.reduce(
          (total, item) =>
            total + item.missingBaseRate + item.missingPayBasis,
          0,
        ),
        payrollRunCount: payrollRuns.length,
        payrollRunDigests,
        staffWithoutEmployeeMembership: staffWithoutMembership,
      },
      null,
      2,
    ),
  );
}

void main().finally(() => prisma.$disconnect());
