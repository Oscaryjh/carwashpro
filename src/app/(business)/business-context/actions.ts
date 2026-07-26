"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import {
  type BusinessContextActionState,
  businessContextErrorMessage,
  commitBusinessContextSwitch,
} from "@/lib/business-groups/business-context";
import { verifyBusinessContextToken } from "@/lib/auth/business-context-token";
import { requireUser } from "@/lib/auth/session";

const switchBusinessContextSchema = z.object({
  targetBusinessId: z.string().uuid(),
  contextToken: z.string().min(1),
  returnTo: z.string().optional(),
});

export async function switchBusinessContextAction(
  _previousState: BusinessContextActionState,
  formData: FormData,
): Promise<BusinessContextActionState> {
  const parsed = switchBusinessContextSchema.safeParse({
    targetBusinessId: formData.get("targetBusinessId"),
    contextToken: formData.get("contextToken"),
    returnTo: formData.get("returnTo")?.toString(),
  });
  if (!parsed.success) {
    return actionError("BUSINESS_ACCESS_DENIED");
  }

  const user = await requireUser();
  if (!user.activeBusinessId) {
    return actionError("NO_AVAILABLE_BUSINESS");
  }

  const tokenResult = await verifyBusinessContextToken(
    parsed.data.contextToken,
    {
      userId: user.userId,
      businessId: user.activeBusinessId,
      contextVersion: user.contextVersion,
    },
  );
  if (!tokenResult.valid) {
    return {
      status: "error",
      code: tokenResult.code,
      message: tokenResult.message,
    };
  }

  const result = await commitBusinessContextSwitch({
    session: user,
    targetBusinessId: parsed.data.targetBusinessId,
    returnTo: parsed.data.returnTo,
    source: "STORE_SWITCHER",
  });
  if (!result.ok) {
    console.warn("[business-context] switch denied", {
      userId: user.userId,
      code: result.code,
    });
    return {
      status: "error",
      code: result.code,
      message: result.message,
    };
  }

  redirect(result.destination);
}

function actionError(
  code: Exclude<
    NonNullable<BusinessContextActionState["code"]>,
    "INVALID_CONTEXT_TOKEN" | "BUSINESS_CONTEXT_CHANGED"
  >,
): BusinessContextActionState {
  return {
    status: "error",
    code,
    message: businessContextErrorMessage(code),
  };
}
