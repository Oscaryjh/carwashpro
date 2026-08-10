import { getEmployeeSelfServiceAuthContext } from "@/lib/attendance/employee-auth";
import { resolveAttendanceScope } from "@/lib/attendance/scope";
import { requireBusinessUser } from "@/lib/auth/business-user";
import { getAuthorizedClaimAttachment } from "@/lib/claim/service";
import { requireEmployeeBusinessModule } from "@/lib/modules/employee-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ attachmentId: string }> }) {
  try {
    const { attachmentId } = await context.params;
    const employee = await getEmployeeSelfServiceAuthContext(request);
    const attachment = employee
      ? await (async () => {
          await requireEmployeeBusinessModule(employee, "CLAIMS");
          return getAuthorizedClaimAttachment({
            attachmentId,
            businessId: employee.businessId,
            membershipId: employee.membershipId,
          });
        })()
      : await (async () => {
          const { access, businessId } = await requireBusinessUser("VIEW_CLAIM");
          const scope = await resolveAttendanceScope(access);
          return getAuthorizedClaimAttachment({
            attachmentId,
            businessId,
            allowedBranchIds: [...scope.allowedBranchIds],
          });
        })();
    const body = attachment.bytes.buffer.slice(
      attachment.bytes.byteOffset,
      attachment.bytes.byteOffset + attachment.bytes.byteLength,
    ) as ArrayBuffer;
    return new Response(body, {
      headers: {
        "content-type": attachment.mimeType,
        "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(attachment.fileName)}`,
        "cache-control": "private, no-store, max-age=0",
        pragma: "no-cache",
        "x-content-type-options": "nosniff",
        "content-security-policy": "default-src 'none'; sandbox",
      },
    });
  } catch {
    return Response.json({ ok: false, error: { code: "CLAIM_ATTACHMENT_NOT_AVAILABLE", message: "Receipt is not available in the authorized scope." } }, { status: 404 });
  }
}
