import { createHash } from "node:crypto";
import { getAuditRequestContext, tryWriteAuditLog } from "@/lib/audit";
import { requireWholeBusinessPayroll } from "@/lib/payroll/access";
import { loadStatutorySubmissionData } from "@/lib/payroll/statutory-data";
import {
  buildOfficialSubmissionFile,
  STATUTORY_EXPORT_VERSION,
  statutorySubmissionContentType,
  statutorySubmissionFileName,
  type StatutorySubmissionProvider,
} from "@/lib/payroll/statutory-submission";

export async function GET(request: Request) {
  const context = await requireWholeBusinessPayroll("EXPORT_STATUTORY");
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

  await tryWriteAuditLog({
    businessId: context.businessId,
    actor: context.user,
    request: await getAuditRequestContext(),
    action: "PAYROLL_OFFICIAL_STATUTORY_FILE_DOWNLOADED",
    entityType: "PayrollRun",
    entityId: data.run.id,
    summary: `${provider} official submission file downloaded.`,
    metadata: {
      month, provider, version: STATUTORY_EXPORT_VERSION[provider],
      recordCount: data.run.entries.length,
      payrollRunId: data.run.id, byteLength: document.length,
      checksumSha256: createHash("sha256").update(document).digest("hex"),
    },
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
