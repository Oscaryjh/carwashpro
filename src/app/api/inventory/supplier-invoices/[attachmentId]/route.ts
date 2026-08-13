import { requireBusinessUserForModule } from "@/lib/auth/business-user";
import { getOperationalBranches } from "@/lib/branches";
import { assertClaimAttachmentCanBeReleased } from "@/lib/claim/attachment-policy";
import { getClaimPrivateAttachmentStore } from "@/lib/claim/private-attachment-storage";
import { getAuthorizedSupplierInvoiceAttachment } from "@/lib/inventory/supplier-ap-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ attachmentId: string }> }) {
  try {
    const auth = await requireBusinessUserForModule("INVENTORY", "VIEW_SUPPLIER_INVOICE_ATTACHMENT");
    const [{ attachmentId }, branches] = await Promise.all([context.params, getOperationalBranches(auth.businessId, auth.user)]);
    const attachment = await getAuthorizedSupplierInvoiceAttachment({ attachmentId, businessId: auth.businessId, allowedBranchIds: branches.map((branch) => branch.id) });
    assertClaimAttachmentCanBeReleased({ malwareStatus: attachment.malwareStatus as "NOT_SCANNED" | "PENDING" | "CLEAN" | "INFECTED" | "ERROR", privacyMetadataStatus: attachment.privacyMetadataStatus as "NOT_CHECKED" | "DETECTED" | "SANITIZED" | "SAFE" });
    const store = getClaimPrivateAttachmentStore();
    const metadata = await store.getQuarantinedMetadata(attachment.objectKey);
    if (metadata.byteLength !== attachment.byteLength || metadata.checksumSha256 !== attachment.checksumSha256 || metadata.mimeType !== attachment.mimeType) throw new Error("ATTACHMENT_INTEGRITY_FAILED");
    const bytes = await store.readQuarantined({ objectKey: attachment.objectKey, expectedChecksumSha256: attachment.checksumSha256 });
    const body = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    return new Response(body, { headers: { "cache-control": "private, no-store, max-age=0", "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(attachment.sanitizedFileName)}`, "content-security-policy": "default-src 'none'; sandbox", "content-type": attachment.mimeType, pragma: "no-cache", "x-content-type-options": "nosniff" } });
  } catch {
    return Response.json({ ok: false, error: { code: "SUPPLIER_INVOICE_NOT_AVAILABLE", message: "Supplier invoice attachment is not released in the authorised scope." } }, { status: 404 });
  }
}
