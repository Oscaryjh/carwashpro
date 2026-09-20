import { createHash } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import type { AppSession } from "@/lib/auth/session";
import { writeAuditLog, type AuditRequestContext } from "@/lib/audit";
import { controlledPayrollDocumentEntry } from "@/lib/payroll/documents";
import { freezePcbPublication } from "./pcb-published-correction";
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
            statutorySnapshots: {
              select: {
                evidenceNature: true,
                evidenceEnvironment: true,
                fixturePurpose: true,
                officialExportEligible: true,
                scheme: true,
                status: true,
                blockerCode: true,
                employeeContribution: true,
                employerContribution: true,
              },
            },
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
      for (const entry of unpublished) {
          const documentEntry = await controlledPayrollDocumentEntry(transaction, input.businessId, entry);
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
          const publication = await transaction.payrollPayslipPublication.create({ data: {
            businessId: input.businessId,
            payrollRunId: run.id,
            payrollEntryId: entry.id,
            membershipId: entry.membershipId,
            documentBytes: bytes,
            documentSha256: createHash("sha256").update(bytes).digest("hex"),
            publishedById: input.actor.userId,
          } });
          await freezePcbPublication(transaction, { publicationId: publication.id, businessId: input.businessId, entryId: entry.id,
            actorId: input.actor.userId, run: { id: run.id, business: run.business, periodStart: run.periodStart, periodEnd: run.periodEnd,
              status: run.status, submittedAt: run.submittedAt, finalizedAt: run.finalizedAt }, entry: documentEntry, bytes });
      }
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
  const publications = await database.payrollPayslipPublication.findMany({
    where: { businessId: input.businessId, membershipId: input.membershipId },
    orderBy: [{ payrollRun: { periodStart: "desc" } }, { publishedAt: "desc" }],
    select: {
      id: true,
      publishedAt: true,
      payrollRun: { select: { periodStart: true } },
      payrollEntry: { select: { grossPay: true, netPay: true } },
    },
  });
  return Promise.all(publications.map(async (publication) => {
    const latest = await database.payrollPcbPublicationVersion.findFirst({ where: { publicationId: publication.id, businessId: input.businessId, membershipId: input.membershipId }, orderBy: { version: "desc" }, select: { version: true, documentEntry: true, recordedAt: true } });
    if (!latest || latest.version === 1) return publication;
    const entry = latest.documentEntry as { grossPay: number; netPay: number };
    return { ...publication, publishedAt: latest.recordedAt, payrollEntry: { grossPay: entry.grossPay, netPay: entry.netPay } };
  }));
}

export async function loadOwnPublishedPayslip(
  input: { businessId: string; membershipId: string; publicationId: string },
  database: PrismaClient = prisma,
) {
  const publication = await database.payrollPayslipPublication.findFirst({
    where: {
      id: input.publicationId,
      businessId: input.businessId,
      membershipId: input.membershipId,
    },
    select: {
      payrollEntryId: true,
      documentBytes: true,
      payrollEntry: { select: { employeeCodeSnapshot: true } },
      payrollRun: { select: { periodStart: true } },
    },
  });
  if (publication) {
    const latest = await database.payrollPcbPublicationVersion.findFirst({ where: { publicationId: input.publicationId, businessId: input.businessId, membershipId: input.membershipId }, orderBy: { version: "desc" }, select: { documentBytes: true } });
    if (latest) return { ...publication, documentBytes: latest.documentBytes };
  }
  return publication;
}
