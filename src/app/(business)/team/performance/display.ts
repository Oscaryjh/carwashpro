import { formatTargetMoney } from "@/lib/performance/targets-contract";

// Presentation only: retain the existing money formatter and server contracts.
export const performanceMoney = (value: number | null) =>
  value === null ? "Pending verification" : formatTargetMoney(value);

const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export const performanceMonth = (month: number) => months[month - 1];
export const comparisonLabel = (label: string) =>
  label === "上月整月" ? "Previous month (full period)" : "Previous period";

const errors: Record<string, string> = {
  "业绩目标功能尚未启用。": "Target management is not enabled.",
  "目标版本已改变，请重新加载并预览。": "Targets have changed. Reload and preview again.",
  "员工不属于该门店及年度，请检查成员变化。": "An employee is not part of this branch and year. Review the team members.",
  "请先完成发布预览。": "Preview the targets before publishing.",
  "预览凭证无效。": "This preview is invalid. Preview the targets again.",
  "预览已失效，请重新预览。": "This preview is no longer valid. Preview the targets again.",
  "重复请求内容不一致。": "The request has changed. Preview the targets again.",
  "预览已过期，请重新预览。": "This preview has expired. Preview the targets again.",
  "业绩、成员或权限已改变，请重新预览。": "Performance, team members or permissions have changed. Preview again.",
  "请明确确认目标分配差额。": "Confirm the target allocation gap before publishing.",
  "三级门槛必须大于零且严格递增。": "All three thresholds must be above zero and increase at each level.",
  "员工不能重复分配。": "Each employee can only be allocated once.",
  "店长必须包含在个人目标中。": "Include the manager in the individual targets.",
  "店长目标超过第一级，无法平均分配。": "The manager target exceeds Level 1. Adjust it before distributing evenly.",
  "请选择店长及至少一名其他员工。": "Select a manager and at least one other employee.",
  "请输入有效金额，最多两位小数。": "Enter a valid amount with up to two decimal places.",
  "无法预览，请重试。": "Unable to preview targets. Please try again.",
  "发布失败，请保留当前输入重试。": "Unable to publish targets. Keep your current entries and try again.",
  "Individual targets exceed Level 1. Adjust them before distributing evenly.": "Individual targets exceed Level 1. Adjust them before distributing evenly.",
  "Select employees first.": "Select employees first.",
};
const fallback = "Unable to update targets. Check your entries and try again.";

export function performanceError(message: string): string {
  if (Object.hasOwn(errors, message)) return errors[message];
  // Zod errors arrive as JSON from the unchanged action contract.
  // Only show recognised validation copy, never raw exceptions or internal details.
  try {
    const issues: unknown = JSON.parse(message);
    if (Array.isArray(issues) && issues.length) {
      return [...new Set(issues.map((issue: unknown) => {
        if (!issue || typeof issue !== "object") return fallback;
        const item = issue as { message?: unknown; path?: unknown; code?: unknown };
        if (typeof item.message === "string" && Object.hasOwn(errors, item.message)) return errors[item.message];
        if (Array.isArray(item.path) && item.path[0] === "reason" && (item.code === "too_small" || item.code === "too_big")) return "Enter a reason between 5 and 500 characters.";
        return fallback;
      }))].join(" ");
    }
  } catch { /* Unknown errors use safe English copy. */ }
  return fallback;
}
