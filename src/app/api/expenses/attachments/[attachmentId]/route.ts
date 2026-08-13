import { requireBusinessUserForModule } from "@/lib/auth/business-user";
import { resolveExpenseReadScope } from "@/lib/expense/access";
import { getAuthorizedExpenseAttachment } from "@/lib/expense/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ attachmentId: string }> }) {
  try {
    const auth = await requireBusinessUserForModule("EXPENSE", "VIEW_EXPENSE_RECEIPT");
    const [{ attachmentId }, scope] = await Promise.all([context.params, resolveExpenseReadScope(auth)]);
    const attachment = await getAuthorizedExpenseAttachment({ attachmentId, businessId: auth.businessId, ...scope });
    const body = attachment.bytes.buffer.slice(attachment.bytes.byteOffset, attachment.bytes.byteOffset + attachment.bytes.byteLength) as ArrayBuffer;
    return new Response(body, { headers: { "cache-control": "private, no-store, max-age=0", "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(attachment.fileName)}`, "content-security-policy": "default-src 'none'; sandbox", "content-type": attachment.mimeType, pragma: "no-cache", "x-content-type-options": "nosniff" } });
  } catch {
    return Response.json({ ok: false, error: { code: "EXPENSE_RECEIPT_NOT_AVAILABLE", message: "Receipt is not available in the authorised scope." } }, { status: 404 });
  }
}
