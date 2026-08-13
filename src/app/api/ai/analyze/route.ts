import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import { requireBusinessContext } from "@/lib/tenant";
import { askTetamuAi, AiServiceError } from "@/lib/ai/service";

const requestSchema = z.object({
  scopeType: z.enum(["BUSINESS", "GROUP"]),
  groupId: z.string().uuid().optional(),
  conversationId: z.string().uuid().nullable().optional(),
  question: z.string().trim().min(1).max(2000),
  clientRequestId: z.string().uuid(),
  branchId: z.string().uuid().nullable().optional(),
  range: z.string().max(30).optional(),
  from: z.string().max(10).optional(),
  to: z.string().max(10).optional(),
});

export async function POST(request: Request) {
  try {
    const body = requestSchema.parse(await request.json());
    const user = await requireUser();
    if (body.scopeType === "BUSINESS") {
      const context = await requireBusinessContext({ capability: "USE_AI_ANALYSIS" });
      const result = await askTetamuAi({
        user: context.user,
        scope: { type: "BUSINESS", businessId: context.businessId, access: context.access, user: context.user, selectedBranchId: body.branchId },
        conversationId: body.conversationId,
        question: body.question,
        clientRequestId: body.clientRequestId,
        range: body.range, from: body.from, to: body.to,
      });
      return NextResponse.json(result);
    }
    if (!body.groupId) return NextResponse.json({ error: "AI_GROUP_REQUIRED" }, { status: 400 });
    const result = await askTetamuAi({
      user,
      scope: { type: "GROUP", groupId: body.groupId, currentBusinessId: user.activeBusinessId },
      conversationId: body.conversationId,
      question: body.question,
      clientRequestId: body.clientRequestId,
      range: body.range, from: body.from, to: body.to,
    });
    return NextResponse.json(result);
  } catch (error) {
    const code = error instanceof AiServiceError ? error.code : error instanceof z.ZodError ? "AI_REQUEST_INVALID" : "AI_ANALYSIS_UNAVAILABLE";
    const status = code === "AI_RATE_LIMITED" || code === "AI_QUOTA_EXCEEDED" ? 429
      : code.includes("DENIED") || code === "AI_MODULE_DISABLED" ? 403
        : code === "AI_REQUEST_INVALID" ? 400 : 503;
    return NextResponse.json({ error: code, message: friendly(code) }, { status });
  }
}

function friendly(code: string) {
  if (code === "AI_RATE_LIMITED") return "Too many AI requests. Please wait a moment and try again.";
  if (code === "AI_QUOTA_EXCEEDED") return "This AI allowance has been used for the current period. Existing conversations remain available.";
  if (code === "AI_QUOTA_NOT_CONFIGURED") return "AI allowance is not configured for this scope. Contact Tetamu support.";
  if (code === "AI_QUOTA_SUSPENDED") return "AI access is temporarily suspended for this scope.";
  if (code === "AI_GLOBALLY_DISABLED") return "AI analysis is temporarily disabled.";
  if (code === "AI_MODULE_DISABLED") return "AI Business Analysis is not enabled for this business.";
  if (code.includes("DENIED")) return "You do not have access to this AI analysis scope.";
  if (code === "AI_PROVIDER_UNAVAILABLE") return "AI analysis is not configured for this environment.";
  return "Analysis is temporarily unavailable. No business data was changed.";
}
