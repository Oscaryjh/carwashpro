import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import { requireBusinessContext } from "@/lib/tenant";
import { askTetamuAi, AiServiceError } from "@/lib/ai/service";
import { PILOT_GROUP_NOTICE, PILOT_OWNER_NOTICE } from "@/lib/ai/pilot-access";

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
        scope: { type: "BUSINESS", businessId: context.businessId, access: context.access, user: context.user, ...(Object.hasOwn(body, "branchId") ? { selectedBranchId: body.branchId } : {}) },
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
      : code === "AI_REQUEST_CONFLICT" || code === "AI_REQUEST_PENDING" || code === "AI_REQUEST_DUPLICATE" ? 409
      : code === "AI_REQUEST_FAILED" ? 422
      : code.includes("DENIED") || code === "AI_MODULE_DISABLED" || code === "AI_QUOTA_NOT_CONFIGURED" ? 403
        : code === "AI_REQUEST_INVALID" || code.startsWith("AI_DATE_RANGE_") ? 400 : 503;
    return NextResponse.json({ error: code, message: friendly(code) }, { status });
  }
}

function friendly(code: string) {
  if (code === "AI_REQUEST_CONFLICT") return "This request key belongs to a different request. Edit your question to start a new request.";
  if (code === "AI_REQUEST_PENDING") return "This question is still processing. Retry the same request to check its result.";
  if (code === "AI_REQUEST_FAILED") return "This request failed and was not charged. Edit your question to start a new request.";
  if (code === "AI_REQUEST_DUPLICATE") return "This older request cannot be safely replayed. Edit your question to start a new request.";
  if (code === "AI_PILOT_OWNER_ONLY_DENIED") return PILOT_OWNER_NOTICE;
  if (code === "AI_PILOT_GROUP_DENIED") return PILOT_GROUP_NOTICE;
  if (code === "AI_DATE_RANGE_TOO_LARGE") return "Please choose a date range of 90 days or less.";
  if (code === "AI_DATE_RANGE_INVALID") return "Please choose a valid date range.";
  if (code === "AI_RATE_LIMITED") return "Please wait a moment before asking another question.";
  if (code === "AI_QUOTA_EXCEEDED") return "You've reached this month's Ask Tetamu limit.";
  if (code === "AI_QUOTA_NOT_CONFIGURED") return "AI usage has not been configured for this business.";
  if (code === "AI_MODULE_DISABLED") return "Ask Tetamu is not enabled for this business.";
  if (code === "AI_QUOTA_SUSPENDED" || code === "AI_GLOBALLY_DISABLED") return "Ask Tetamu is temporarily unavailable. Please try again later.";
  if (code.includes("DENIED")) return "You don't have access to the requested business or branch.";
  if (code === "AI_PROVIDER_UNAVAILABLE" || code === "AI_PROVIDER_TEMPORARILY_UNAVAILABLE") return "The AI provider is temporarily unavailable. This request was not charged.";
  return "Ask Tetamu is temporarily unavailable. Please try again.";
}
