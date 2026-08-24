import { getAuditRequestContext } from "@/lib/audit";
import { requireEmployeeSelfServiceAuthContext } from "@/lib/attendance/employee-auth";
import { getAuthorizedLeaveDocument } from "@/lib/leave/document-service";
import { prisma } from "@/lib/prisma";
import { resolveStaffTeamApprovalAccess } from "@/lib/staff-pwa/team-approvals";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ documentId: string }> }) {
  try {
    const auth = await requireEmployeeSelfServiceAuthContext(request);
    const access = await resolveStaffTeamApprovalAccess(auth);
    if (!access?.canReviewLeave) throw new Error("Not authorized.");
    const { documentId } = await context.params;
    const visible = await prisma.leaveSupportingDocument.findFirst({
      where: {
        id: documentId,
        businessId: access.businessId,
        leaveRequest: {
          branchId: { in: [...access.allowedBranchIds] },
          membership: { staffUser: { isNot: { id: access.actor.userId } } },
        },
      },
      select: { id: true },
    });
    if (!visible) throw new Error("Not authorized.");
    const document = await getAuthorizedLeaveDocument({
      documentId,
      businessId: access.businessId,
      allowedBranchIds: access.allowedBranchIds,
      actor: access.actor,
      request: await getAuditRequestContext(),
    });
    return privateResponse(document);
  } catch {
    return Response.json({ ok: false, error: { code: "LEAVE_DOCUMENT_NOT_AVAILABLE", message: "Document is not available in your approval scope." } }, { status: 404 });
  }
}

function privateResponse(document: { bytes: Uint8Array; fileName: string; mimeType: string }) {
  const body = document.bytes.buffer.slice(document.bytes.byteOffset, document.bytes.byteOffset + document.bytes.byteLength) as ArrayBuffer;
  return new Response(body, { headers: {
    "content-type": document.mimeType,
    "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(document.fileName)}`,
    "cache-control": "private, no-store, max-age=0",
    pragma: "no-cache",
    "x-content-type-options": "nosniff",
    "content-security-policy": "default-src 'none'; sandbox",
  } });
}
