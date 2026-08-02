import { getAuditRequestContext } from "@/lib/audit";
import { requireWholeBusinessPayroll } from "@/lib/payroll/access";
import {
  downloadOrCreateStatutoryArtifact,
  StatutoryArtifactError,
} from "@/lib/payroll/statutory-artifact";
import {
  type StatutorySubmissionProvider,
} from "@/lib/payroll/statutory-submission";

export async function GET(request: Request) {
  const context = await requireWholeBusinessPayroll("EXPORT_STATUTORY");
  const url = new URL(request.url);
  const month = url.searchParams.get("month") ?? "";
  const provider = parseProvider(url.searchParams.get("provider"));
  if (!provider) return new Response("Select a valid statutory provider.", { status: 400 });
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    return new Response("Select a valid payroll month.", { status: 400 });
  }

  let artifact;
  try {
    artifact = await downloadOrCreateStatutoryArtifact({
      actor: context.user,
      businessId: context.businessId,
      month,
      provider,
      request: await getAuditRequestContext(),
    });
  } catch (error) {
    if (error instanceof StatutoryArtifactError) {
      return new Response(error.message, { status: error.httpStatus });
    }
    return new Response("Unable to prepare the statutory artifact.", { status: 500 });
  }

  return new Response(new Uint8Array(artifact.body), {
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Disposition": `attachment; filename="${artifact.fileName}"`,
      "Content-Length": String(artifact.byteLength),
      "Content-Type": artifact.contentType,
      "X-Statutory-Artifact-Revision": String(artifact.revision),
    },
  });
}

function parseProvider(value: string | null): StatutorySubmissionProvider | null {
  return value === "EPF" || value === "PERKESO" || value === "PCB" ? value : null;
}
