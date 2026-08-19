import { getAuditRequestContext } from "@/lib/audit";
import { resolveAttendanceScope } from "@/lib/attendance/scope";
import { requireBusinessUser } from "@/lib/auth/business-user";
import { getAuthorizedLeaveDocument } from "@/lib/leave/document-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ documentId: string }> }) {
  try {
    const { access, businessId, user } = await requireBusinessUser("VIEW_LEAVE");
    const scope = await resolveAttendanceScope(access);
    const { documentId } = await context.params;
    const document = await getAuthorizedLeaveDocument({
      documentId,
      businessId,
      allowedBranchIds: scope.allowedBranchIds,
      actor: user,
      request: await getAuditRequestContext(),
    });
    const body = document.bytes.buffer.slice(
      document.bytes.byteOffset,
      document.bytes.byteOffset + document.bytes.byteLength,
    ) as ArrayBuffer;
    return new Response(body, {
      headers: {
        "content-type": document.mimeType,
        "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(document.fileName)}`,
        "cache-control": "private, no-store, max-age=0",
        pragma: "no-cache",
        "x-content-type-options": "nosniff",
        "content-security-policy": "default-src 'none'; sandbox",
      },
    });
  } catch {
    return Response.json(
      { ok: false, error: { code: "LEAVE_DOCUMENT_NOT_AVAILABLE", message: "Supporting document is not available in the authorized scope." } },
      { status: 404 },
    );
  }
}
