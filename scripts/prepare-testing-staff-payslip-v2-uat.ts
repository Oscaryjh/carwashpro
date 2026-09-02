import { createHash } from "node:crypto";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const PHONE = "+601112212259";
const BUSINESS_NAME = "Royal Salon";
const BRANCH_NAME = "salon online";
const TESTING_DATABASE_HOST = "postgres-zvge.railway.internal";

function assertTestingBoundary() {
  if (process.env.RAILWAY_ENVIRONMENT_NAME !== "testing") {
    throw new Error("TESTING_ENVIRONMENT_REQUIRED");
  }
  if (process.env.RAILWAY_SERVICE_NAME !== "tetamu-staff-app") {
    throw new Error("TESTING_STAFF_SERVICE_REQUIRED");
  }
  if (process.env.APP_ENVIRONMENT?.toLowerCase() !== "testing") {
    throw new Error("TESTING_APP_ENVIRONMENT_REQUIRED");
  }
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL_REQUIRED");
  if (new URL(databaseUrl).hostname.toLowerCase() !== TESTING_DATABASE_HOST) {
    throw new Error("APPROVED_TESTING_DATABASE_REQUIRED");
  }
}

function money(value: { toString(): string } | number) {
  return Number(value).toFixed(2);
}

async function loadState() {
  const account = await prisma.employeeAccount.findUnique({
    where: { phoneNormalized: PHONE },
    select: {
      id: true,
      name: true,
      status: true,
      memberships: {
        where: { business: { name: BUSINESS_NAME } },
        select: {
          id: true,
          businessId: true,
          employeeCode: true,
          fullName: true,
          status: true,
          attendanceEnabled: true,
          joinedAt: true,
          terminatedAt: true,
          payBasis: true,
          business: { select: { name: true, status: true } },
          branchAssignments: {
            select: {
              branchId: true,
              status: true,
              isPrimary: true,
              effectiveFrom: true,
              effectiveUntil: true,
              branch: { select: { name: true, status: true } },
            },
          },
          compensationVersions: {
            orderBy: [{ effectiveFromMonth: "desc" }, { createdAt: "desc" }],
            select: {
              id: true,
              status: true,
              effectiveFromMonth: true,
              payBasis: true,
              baseRate: true,
              source: true,
              reasonNote: true,
            },
          },
        },
      },
    },
  });
  if (!account || account.memberships.length !== 1) {
    throw new Error("TARGET_ROYAL_SALON_MEMBERSHIP_NOT_UNIQUE");
  }
  const membership = account.memberships[0]!;
  const runs = await prisma.payrollRun.findMany({
    where: {
      businessId: membership.businessId,
      entries: { some: { membershipId: membership.id } },
    },
    orderBy: { periodStart: "asc" },
    select: {
      id: true,
      periodStart: true,
      periodEnd: true,
      status: true,
      attendanceSource: true,
      attendanceTimesheetRevisionId: true,
      submittedAt: true,
      finalizedAt: true,
      entries: {
        where: { membershipId: membership.id },
        select: {
          id: true,
          employeeCodeSnapshot: true,
          fullNameSnapshot: true,
          basicPay: true,
          grossPay: true,
          otherDeductions: true,
          epfEmployee: true,
          socsoEmployee: true,
          eisEmployee: true,
          lindung24Employee: true,
          pcb: true,
          cp38: true,
          employerEpf: true,
          employerSocso: true,
          employerEis: true,
          netPay: true,
          notes: true,
          components: {
            orderBy: [{ sortOrder: "asc" }, { lineKey: "asc" }],
            select: { name: true, type: true, amount: true, sourceType: true },
          },
          claimReimbursementSnapshots: {
            orderBy: { createdAt: "asc" },
            select: { claimNumberSnapshot: true, amount: true, status: true },
          },
          payslipPublication: {
            select: {
              id: true,
              publishedAt: true,
              documentSha256: true,
              documentBytes: true,
            },
          },
        },
      },
    },
  });
  const septemberRun = await prisma.payrollRun.findUnique({
    where: {
      businessId_periodStart_periodEnd: {
        businessId: membership.businessId,
        periodStart: new Date("2026-09-01T00:00:00.000Z"),
        periodEnd: new Date("2026-10-01T00:00:00.000Z"),
      },
    },
    select: {
      id: true,
      status: true,
      createdAt: true,
      entries: { select: { id: true, membershipId: true, notes: true } },
      payslipPublications: { select: { id: true, membershipId: true } },
    },
  });
  const septemberStart = new Date("2026-09-01T00:00:00.000Z");
  const octoberStart = new Date("2026-10-01T00:00:00.000Z");
  const septemberTimesheet = await prisma.attendanceMonthlyTimesheet.findUnique({
    where: {
      businessId_periodStart: {
        businessId: membership.businessId,
        periodStart: septemberStart,
      },
    },
    select: {
      id: true,
      status: true,
      currentRevisionId: true,
      currentRevision: {
        select: {
          id: true,
          revision: true,
          lockedAt: true,
          sourceDigest: true,
          _count: { select: { entries: true, p2DaySnapshots: true } },
        },
      },
    },
  });
  const septemberEligibleMemberships = await prisma.employeeBusinessMembership.findMany({
    where: {
      businessId: membership.businessId,
      joinedAt: { lt: octoberStart },
      OR: [{ terminatedAt: null }, { terminatedAt: { gte: septemberStart } }],
    },
    orderBy: [{ fullName: "asc" }, { employeeCode: "asc" }],
    select: {
      id: true,
      employeeCode: true,
      fullName: true,
      status: true,
      joinedAt: true,
      terminatedAt: true,
    },
  });
  const reimbursementCandidates = await prisma.payrollClaimReimbursementSnapshot.findMany({
    where: {
      businessId: membership.businessId,
      membershipId: membership.id,
      status: { in: ["READY", "SETTLED"] },
    },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      payrollEntryId: true,
      claimNumberSnapshot: true,
      amount: true,
      status: true,
    },
  });
  return {
    account,
    membership,
    runs,
    septemberRun,
    septemberTimesheet,
    septemberEligibleMemberships,
    reimbursementCandidates,
  };
}

async function main() {
  assertTestingBoundary();
  const state = await loadState();
  console.log(JSON.stringify({
    mode: "READ_ONLY_AUDIT",
    environment: process.env.RAILWAY_ENVIRONMENT_NAME,
    service: process.env.RAILWAY_SERVICE_NAME,
    databaseHost: new URL(process.env.DATABASE_URL!).hostname,
    account: {
      id: state.account.id,
      name: state.account.name,
      status: state.account.status,
    },
    membership: {
      id: state.membership.id,
      businessId: state.membership.businessId,
      business: state.membership.business.name,
      businessStatus: state.membership.business.status,
      employeeCode: state.membership.employeeCode,
      fullName: state.membership.fullName,
      status: state.membership.status,
      attendanceEnabled: state.membership.attendanceEnabled,
      joinedAt: state.membership.joinedAt,
      terminatedAt: state.membership.terminatedAt,
      payBasis: state.membership.payBasis,
      targetBranchAssignments: state.membership.branchAssignments.filter(
        (assignment) => assignment.branch.name === BRANCH_NAME,
      ),
      compensationVersions: state.membership.compensationVersions.map((version) => ({
        ...version,
        baseRate: money(version.baseRate),
      })),
    },
    periods: state.runs.map((run) => ({
      id: run.id,
      periodStart: run.periodStart,
      periodEnd: run.periodEnd,
      status: run.status,
      attendanceSource: run.attendanceSource,
      attendanceTimesheetRevisionId: run.attendanceTimesheetRevisionId,
      submittedAt: run.submittedAt,
      finalizedAt: run.finalizedAt,
      entries: run.entries.map((entry) => ({
        id: entry.id,
        employeeCode: entry.employeeCodeSnapshot,
        fullName: entry.fullNameSnapshot,
        basicPay: money(entry.basicPay),
        grossPay: money(entry.grossPay),
        employeeDeductions: money(
          Number(entry.otherDeductions) + Number(entry.epfEmployee) +
          Number(entry.socsoEmployee) + Number(entry.eisEmployee) +
          Number(entry.lindung24Employee) + Number(entry.pcb) + Number(entry.cp38),
        ),
        employerContributions: money(
          Number(entry.employerEpf) + Number(entry.employerSocso) + Number(entry.employerEis),
        ),
        netPay: money(entry.netPay),
        notes: entry.notes,
        components: entry.components.map((component) => ({
          ...component,
          amount: money(component.amount),
        })),
        reimbursements: entry.claimReimbursementSnapshots.map((snapshot) => ({
          ...snapshot,
          amount: money(snapshot.amount),
        })),
        publication: entry.payslipPublication ? {
          id: entry.payslipPublication.id,
          publishedAt: entry.payslipPublication.publishedAt,
          sha256: entry.payslipPublication.documentSha256,
          checksumMatches: createHash("sha256")
            .update(Buffer.from(entry.payslipPublication.documentBytes))
            .digest("hex") === entry.payslipPublication.documentSha256,
          bytes: entry.payslipPublication.documentBytes.length,
          templateV2: Buffer.from(entry.payslipPublication.documentBytes)
            .toString("latin1")
            .includes("MY-PAYSLIP-V2"),
        } : null,
      })),
    })),
    septemberConflict: state.septemberRun,
    septemberTimesheet: state.septemberTimesheet,
    septemberEligibleMemberships: state.septemberEligibleMemberships,
    reimbursementCandidates: state.reimbursementCandidates.map((snapshot) => ({
      ...snapshot,
      amount: money(snapshot.amount),
    })),
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
