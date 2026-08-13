import { cookies } from "next/headers";
import { getAuditRequestContext } from "@/lib/audit";
import {
  SensitiveActionError,
  SENSITIVE_ACTION_COOKIE,
} from "@/lib/auth/sensitive-action-service";
import { hasBusinessCapability } from "@/lib/business-groups/business-access";
import { requireWholeBusinessPayroll } from "@/lib/payroll/access";
import {
  downloadOrCreateStatutoryArtifact,
  StatutoryArtifactError,
} from "@/lib/payroll/statutory-artifact";
import {
  type StatutorySubmissionProvider,
} from "@/lib/payroll/statutory-submission";
import { statutoryExportStepUpResourceId } from "@/lib/payroll/high-risk-mfa";

export async function GET(request: Request) {
  const context = await requireWholeBusinessPayroll("EXPORT_STATUTORY");
  const url = new URL(request.url);
  const month = url.searchParams.get("month") ?? "";
  const provider = parseProvider(url.searchParams.get("provider"));
  const revision = parseRevision(url.searchParams.get("revision"));
  if (!provider) return new Response("Select a valid statutory provider.", { status: 400 });
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    return new Response("Select a valid payroll month.", { status: 400 });
  }
  if (url.searchParams.has("revision") && revision === null) {
    return new Response("Select a valid artifact revision.", { status: 400 });
  }

  const cookieStore = await cookies();
  const rawToken = cookieStore.get(SENSITIVE_ACTION_COOKIE)?.value;
  if (!rawToken || !context.user.sessionId) {
    return new Response("MFA verification is required for this statutory export.", { status: 403 });
  }
  let artifact;
  try {
    artifact = await downloadOrCreateStatutoryArtifact({
      actor: context.user,
      businessId: context.businessId,
      month,
      provider,
      request: await getAuditRequestContext(),
      revision: revision ?? undefined,
      allowCreate: hasBusinessCapability(context.access, "EXPORT_STATUTORY"),
      stepUp: { rawToken, sessionId: context.user.sessionId },
      stepUpResourceId: statutoryExportStepUpResourceId(month, provider, revision),
    });
  } catch (error) {
    if (error instanceof StatutoryArtifactError) {
      return new Response(error.message, { status: error.httpStatus });
    }
    if (error instanceof SensitiveActionError) {
      return new Response("MFA verification is required for this statutory export.", { status: 403 });
    }
    return new Response("Unable to prepare the statutory artifact.", { status: 500 });
  } finally {
    cookieStore.delete(SENSITIVE_ACTION_COOKIE);
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

function parseRevision(value: string | null) {
  if (value === null) return null;
  const revision = Number(value);
  return Number.isSafeInteger(revision) && revision > 0 ? revision : null;
}

function parseProvider(value: string | null): StatutorySubmissionProvider | null {
  return value === "EPF" || value === "PERKESO" || value === "PCB" ? value : null;
}
