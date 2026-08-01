import { getAuditRequestContext, writeAuditLog } from "@/lib/audit";
import { requireWholeBusinessPayroll } from "@/lib/payroll/access";
import { loadStatutorySubmissionData } from "@/lib/payroll/statutory-data";
import {
  buildOfficialSubmissionFile,
  STATUTORY_EXPORT_VERSION,
  statutorySubmissionContentType,
  statutorySubmissionFileName,
  type StatutorySubmissionProvider,
} from "@/lib/payroll/statutory-submission";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  const context = await requireWholeBusinessPayroll("VIEW_PAYROLL");
  const url = new URL(request.url);
  const month = url.searchParams.get("month") ?? "";
  const provider = parseProvider(url.searchParams.get("provider"));
  if (!provider) return new Response("Select a valid statutory provider.", { status: 400 });

  let data;
  try {
    data = await loadStatutorySubmissionData(context.businessId, month);
  } catch {
    return new Response("Select a valid payroll month.", { status: 400 });
  }
  if (!data.profile || !data.run) return new Response("Statutory submission is not ready.", { status: 409 });

  let document: Buffer;
  try {
    document = buildOfficialSubmissionFile(provider, data.profile, data.run);
  } catch (error) {
    return new Response(error instanceof Error ? error.message : "Statutory submission is not ready.", { status: 409 });
  }

  const auditRequest = await getAuditRequestContext();
  await prisma.$transaction(async (transaction) => {
    const current = await transaction.payrollStatutorySubmission.findUnique({
      where: { payrollRunId_provider: { payrollRunId: data.run!.id, provider } },
    });
    const submission = current?.status === "ACCEPTED"
      ? current
      : await transaction.payrollStatutorySubmission.upsert({
          where: { payrollRunId_provider: { payrollRunId: data.run!.id, provider } },
          create: {
            payrollRunId: data.run!.id,
            businessId: context.businessId,
            provider,
            status: "EXPORTED",
            exportVersion: STATUTORY_EXPORT_VERSION[provider],
            exportedById: context.user.userId,
          },
          update: {
            status: "EXPORTED",
            exportVersion: STATUTORY_EXPORT_VERSION[provider],
            exportedAt: new Date(),
            exportedById: context.user.userId,
            submittedAt: null,
            submittedById: null,
            resolvedAt: null,
            resolvedById: null,
            submissionReference: null,
            rejectionReason: null,
          },
        });
    await writeAuditLog({
      businessId: context.businessId,
      actor: context.user,
      request: auditRequest,
      action: "PAYROLL_OFFICIAL_STATUTORY_FILE_EXPORTED",
      entityType: "PayrollStatutorySubmission",
      entityId: submission.id,
      summary: `${provider} official submission file exported.`,
      metadata: { month, provider, version: STATUTORY_EXPORT_VERSION[provider], payrollRunId: data.run!.id },
    }, transaction);
  });

  const fileName = statutorySubmissionFileName(provider, data.profile, data.run);
  return new Response(new Uint8Array(document), {
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Content-Length": String(document.length),
      "Content-Type": statutorySubmissionContentType(provider),
    },
  });
}

function parseProvider(value: string | null): StatutorySubmissionProvider | null {
  return value === "EPF" || value === "PERKESO" || value === "PCB" ? value : null;
}
