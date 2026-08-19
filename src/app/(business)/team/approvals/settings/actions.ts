"use server";

import { revalidatePath } from "next/cache";
import { isRedirectError } from "next/dist/client/components/redirect-error";
import { redirect } from "next/navigation";
import { getAuditRequestContext, writeAuditLog } from "@/lib/audit";
import { saveHrApprovalPolicy, type HrApprovalDomainName, type HrApprovalModeName } from "@/lib/approvals/policy-service";
import { requireBusinessUser } from "@/lib/auth/business-user";

const domains: HrApprovalDomainName[] = ["LEAVE", "CLAIMS"];
const modes: HrApprovalModeName[] = ["ONE_LEVEL", "TWO_LEVEL_ALWAYS", "TWO_LEVEL_THRESHOLD"];

export async function saveApprovalPolicyAction(formData: FormData) {
  try {
    const { access, businessId, user } = await requireBusinessUser();
    if (access.effectiveBusinessRole !== "BUSINESS_OWNER") {
      throw new Error("只有 Business Owner 可以修改审批层级。 ");
    }
    const domain = String(formData.get("domain") ?? "") as HrApprovalDomainName;
    const mode = String(formData.get("mode") ?? "") as HrApprovalModeName;
    if (!domains.includes(domain) || !modes.includes(mode)) throw new Error("审批规则无效。 ");
    const thresholdRaw = String(formData.get("thresholdValue") ?? "").trim();
    const thresholdValue = thresholdRaw ? Number(thresholdRaw) : null;
    const policy = await saveHrApprovalPolicy({ businessId, domain, mode, thresholdValue });
    await writeAuditLog({
      businessId,
      actor: user,
      request: await getAuditRequestContext(),
      action: "HR_APPROVAL_POLICY_UPDATED",
      entityType: "HrApprovalPolicy",
      entityId: policy.id,
      summary: `${domain} approval policy updated to ${mode}.`,
      after: { domain, mode, thresholdValue: policy.thresholdValue?.toString() ?? null },
    });
    revalidatePath("/team/approvals");
    revalidatePath("/team/approvals/settings");
    redirect(`/team/approvals/settings?type=success&message=${encodeURIComponent("Approval workflow saved.")}`);
  } catch (error) {
    if (isRedirectError(error)) throw error;
    const message = error instanceof Error ? error.message : "Unable to save approval workflow.";
    redirect(`/team/approvals/settings?type=error&message=${encodeURIComponent(message)}`);
  }
}
