"use server";
import { revalidatePath } from "next/cache";
import { requireBusinessUser } from "@/lib/auth/business-user";
import { assertTargetsEnabled, previewTargets, publishTargets } from "@/lib/performance/targets";

export async function previewTargetAction(branchId: string, value: unknown) {
  assertTargetsEnabled();
  const { businessId, user } = await requireBusinessUser("PERFORMANCE_MANAGE_TARGETS");
  try { return { ok: true as const, ...await previewTargets({ businessId, branchId, actorUserId:user.userId }, value) }; }
  catch(error) { return { ok:false as const, error:error instanceof Error ? error.message : "无法预览，请重试。" }; }
}
export async function publishTargetAction(branchId:string, value:unknown, token:string, requestKey:string) {
  assertTargetsEnabled();
  const { businessId, user } = await requireBusinessUser("PERFORMANCE_MANAGE_TARGETS");
  try {
    const result=await publishTargets({businessId,branchId,actorUserId:user.userId},value,token,requestKey);
    revalidatePath("/team/performance");
    return {ok:true as const,...result};
  } catch(error) { return {ok:false as const,error:error instanceof Error ? error.message : "发布失败，请保留当前输入重试。"}; }
}
