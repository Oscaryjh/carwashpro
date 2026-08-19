import { NextResponse } from "next/server";
import { requireBusinessUserForModule } from "@/lib/auth/business-user";
import { assertSameOrigin } from "@/lib/auth/security";
import { getAuditRequestContext } from "@/lib/audit";
import { resolveExpenseMutationBranch } from "@/lib/expense/access";
import { createExpenseDocumentScan, ExpenseDocumentScanError } from "@/lib/expense/document-ai/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const context = await requireBusinessUserForModule("EXPENSE", "CREATE_EXPENSE");
    const formData = await request.formData();
    const document = formData.get("document");
    if (!(document instanceof File) || document.size === 0) return NextResponse.json({ error: "EXPENSE_DOCUMENT_REQUIRED", message: "Choose a receipt photo or PDF first." }, { status: 400 });
    const requestedBranchId = String(formData.get("branchId") ?? "").trim() || null;
    const branchId = await resolveExpenseMutationBranch({ access: context.access, businessId: context.businessId, requestedBranchId, user: context.user });
    const result = await createExpenseDocumentScan({
      actor: { userId: context.user.userId, name: context.user.name, email: context.user.email },
      businessId: context.businessId,
      branchId,
      file: { bytes: new Uint8Array(await document.arrayBuffer()), claimedMimeType: document.type, originalFileName: document.name },
      request: await getAuditRequestContext(),
    });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof ExpenseDocumentScanError ? error.message : error instanceof Error && error.message === "AUTH_CROSS_SITE_REQUEST" ? "Cross-site receipt upload was blocked." : "The document could not be scanned. Manual expense entry is still available.";
    const status = error instanceof ExpenseDocumentScanError && error.code === "EXPENSE_DOCUMENT_SCAN_RATE_LIMITED" ? 429 : error instanceof ExpenseDocumentScanError && error.code === "EXPENSE_DOCUMENT_AI_DISABLED" ? 403 : 400;
    return NextResponse.json({ error: error instanceof ExpenseDocumentScanError ? error.code : "EXPENSE_DOCUMENT_SCAN_FAILED", message }, { status, headers: { "Cache-Control": "no-store" } });
  }
}
