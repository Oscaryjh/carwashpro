import { createHash } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import type { AppSession } from "@/lib/auth/session";
import { writeAuditLog, type AuditRequestContext } from "@/lib/audit";
import { payrollDocumentEntry } from "@/lib/payroll/documents";
import { buildPayslipPdf } from "@/lib/payroll/export";
import { prisma } from "@/lib/prisma";

const businessDocumentSelect = {
  name: true,
  companyNo: true,
  address: true,
  phone: true,
  email: true,
} as const;

export async function publishPayrollPayslips(
  input: {
    businessId: string;
    runId: string;
    actor: Pick<AppSession, "userId" | "name" | "email">;
    request?: AuditRequestContext;
  },
  database: PrismaClient = prisma,
) {
  return database.$transaction(async (transaction) => {
    const run = await transaction.payrollRun.findFirst({
      where: { id: input.runId, businessId: input.businessId },
      include: {
        business: { select: businessDocumentSelect },
        entries: {
          orderBy: [{ fullNameSnapshot: "asc" }, { id: "asc" }],
          include: {
            components: { orderBy: [{ sortOrder: "asc" }, { lineKey: "asc" }] },
            claimReimbursementSnapshots: {
              where: { status: { in: ["READY", "SETTLED"] } },
              orderBy: { createdAt: "asc" },
            },
            payslipPublication: { select: { id: true } },
          },
        },
      },
    });
    if (!run || run.status !== "FINALIZED") {
      throw new Error("Payslips can only be published from a finalized payroll run.");
    }
    const unpublished = run.entries.filter((entry) => !entry.payslipPublication);
    if (unpublished.length) {
      await transaction.payrollPayslipPublication.createMany({
        data: unpublished.map((entry) => {
          const documentEntry = payrollDocumentEntry(entry);
          const bytes = buildPayslipPdf(
            {
              id: run.id,
              business: run.business,
              periodStart: run.periodStart,
              periodEnd: run.periodEnd,
              status: run.status,
              submittedAt: run.submittedAt,
              finalizedAt: run.finalizedAt,
            },
            documentEntry,
          );
          return {
            businessId: input.businessId,
            payrollRunId: run.id,
            payrollEntryId: entry.id,
            membershipId: entry.membershipId,
            documentBytes: bytes,
            documentSha256: createHash("sha256").update(bytes).digest("hex"),
            publishedById: input.actor.userId,
          };
        }),
      });
    }
    await writeAuditLog(
      {
        businessId: input.businessId,
        actor: input.actor,
        request: input.request,
        action: "PAYSLIPS_PUBLISHED",
        entityType: "PayrollRun",
        entityId: run.id,
        summary: `${unpublished.length} payslip(s) published from finalized payroll.`,
        metadata: {
          alreadyPublishedCount: run.entries.length - unpublished.length,
          publishedCount: unpublished.length,
          snapshotOnly: true,
        },
      },
      transaction,
    );
    return {
      employeeCount: run.entries.length,
      publishedCount: unpublished.length,
      alreadyPublishedCount: run.entries.length - unpublished.length,
    };
  }, { isolationLevel: "Serializable" });
}

export async function loadPublishedPayslipsForEmployee(
  input: { businessId: string; membershipId: string },
  database: PrismaClient = prisma,
) {
  return database.payrollPayslipPublication.findMany({
    where: { businessId: input.businessId, membershipId: input.membershipId },
    orderBy: [{ payrollRun: { periodStart: "desc" } }, { publishedAt: "desc" }],
    select: {
      id: true,
      publishedAt: true,
      payrollRun: { select: { periodStart: true } },
      payrollEntry: { select: { grossPay: true, netPay: true } },
    },
  });
}

export async function loadOwnPublishedPayslip(
  input: { businessId: string; membershipId: string; publicationId: string },
  database: PrismaClient = prisma,
) {
  return database.payrollPayslipPublication.findFirst({
    where: {
      id: input.publicationId,
      businessId: input.businessId,
      membershipId: input.membershipId,
    },
    select: {
      documentBytes: true,
      payrollEntry: { select: { employeeCodeSnapshot: true } },
      payrollRun: { select: { periodStart: true } },
    },
  });
}
