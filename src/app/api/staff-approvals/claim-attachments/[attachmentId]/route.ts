import { requireEmployeeSelfServiceAuthContext } from "@/lib/attendance/employee-auth";
import { getAuthorizedClaimAttachment } from "@/lib/claim/service";
import { prisma } from "@/lib/prisma";
import { resolveStaffTeamApprovalAccess } from "@/lib/staff-pwa/team-approvals";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ attachmentId: string }> }) {
  try {
    const auth = await requireEmployeeSelfServiceAuthContext(request);
    const access = await resolveStaffTeamApprovalAccess(auth);
    if (!access?.canReviewClaims) throw new Error("Not authorized.");
    const { attachmentId } = await context.params;
    const visible = await prisma.claimAttachment.findFirst({
      where: {
        id: attachmentId,
        businessId: access.businessId,
        claim: {
          branchId: { in: [...access.allowedBranchIds] },
          membership: { staffUser: { isNot: { id: access.actor.userId } } },
        },
      },
      select: { id: true },
    });
    if (!visible) throw new Error("Not authorized.");
    const attachment = await getAuthorizedClaimAttachment({
      attachmentId,
      businessId: access.businessId,
      allowedBranchIds: [...access.allowedBranchIds],
    });
    const body = attachment.bytes.buffer.slice(attachment.bytes.byteOffset, attachment.bytes.byteOffset + attachment.bytes.byteLength) as ArrayBuffer;
    return new Response(body, { headers: {
      "content-type": attachment.mimeType,
      "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(attachment.fileName)}`,
      "cache-control": "private, no-store, max-age=0",
      pragma: "no-cache",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; sandbox",
    } });
  } catch {
    return Response.json({ ok: false, error: { code: "CLAIM_ATTACHMENT_NOT_AVAILABLE", message: "Receipt is not available in your approval scope." } }, { status: 404 });
  }
}
