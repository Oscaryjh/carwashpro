export const AI_RANGE_OPTIONS = [
  { value: "today", label: "Today" },
  { value: "7days", label: "7 Days" },
  { value: "month", label: "This Month" },
  { value: "custom", label: "Custom" },
] as const;

export const ASK_TETAMU_SUGGESTED_QUESTIONS = [
  "Why are sales down this month?",
  "How are sales and expenses this month?",
  "Which inventory items need attention?",
  "Which supplier bills need attention?",
] as const;

export type AiRange = (typeof AI_RANGE_OPTIONS)[number]["value"];
import type { AiAnswerLanguage, AiIntent, AiTemporalSemantics } from "./intent";

export type AiSourceDomain = "REPORTS" | "PEOPLE" | "EXPENSES" | "INVENTORY" | "SUPPLIER_BILLS" | "APPOINTMENTS" | "PAYMENTS";
export type AiUsageNotice = { kind: "LOW" | "EXHAUSTED"; message: string };

export const AI_LOW_USAGE_WARNING_THRESHOLD = 20;

export type AiScopeSnapshot = {
  scopeType: "BUSINESS" | "GROUP";
  businessId?: string | null;
  businessName: string;
  selectedBranchId?: string | null;
  selectedBranchName?: string | null;
  authorisedBranches?: Array<{ id: string; name: string }>;
  range: string;
  from: string;
  to: string;
  timezone: string;
  businessDayCutoffTime: string;
};

export function normalizeAiRange(value?: string): AiRange {
  return AI_RANGE_OPTIONS.some((option) => option.value === value) ? value as AiRange : "month";
}

export function aiRangeLabel(value: string) {
  return AI_RANGE_OPTIONS.find((option) => option.value === value)?.label ?? "This Month";
}

export function showsCustomAiDates(value: string) {
  return value === "custom";
}

export function getAiUsageNotice(input: {
  configured: boolean;
  status: string;
  remainingRequests?: number | null;
  periodEnd?: Date;
  timezone?: string;
}): AiUsageNotice | null {
  if (!input.configured || input.status !== "ACTIVE" || input.remainingRequests == null || !input.periodEnd || !input.timezone) return null;
  const resetDate = input.periodEnd.toLocaleDateString("en-MY", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: input.timezone,
  }).replace("Sept", "Sep");
  if (input.remainingRequests === 0) {
    return {
      kind: "EXHAUSTED",
      message: `You've reached this month's Ask Tetamu limit. Available again on ${resetDate}.`,
    };
  }
  if (input.remainingRequests <= AI_LOW_USAGE_WARNING_THRESHOLD) {
    return {
      kind: "LOW",
      message: `${input.remainingRequests} Ask Tetamu question${input.remainingRequests === 1 ? "" : "s"} remaining this month. Resets ${resetDate}.`,
    };
  }
  return null;
}

export function inferAiSourceDomains(question: string): AiSourceDomain[] {
  const normalized = question.toLowerCase();
  if (/supplier|bill|payable|供应商|供應商|账单|帳單/.test(normalized)) return ["SUPPLIER_BILLS"];
  if (/inventory|stock|商品|库存|庫存/.test(normalized)) return ["INVENTORY"];
  if (/spend|expense|cost|支出|费用|費用/.test(normalized)) return ["REPORTS", "EXPENSES"];
  return ["REPORTS"];
}

export function sourceDomainsForIntent(intent: AiIntent): AiSourceDomain[] {
  if (intent === "PEOPLE") return ["PEOPLE"];
  if (intent === "EXPENSES") return ["EXPENSES"];
  if (intent === "INVENTORY") return ["INVENTORY"];
  if (intent === "SUPPLIER_BILLS") return ["SUPPLIER_BILLS"];
  if (intent === "APPOINTMENTS") return ["APPOINTMENTS"];
  if (intent === "PAYMENTS") return ["PAYMENTS"];
  if (intent === "GENERAL_BUSINESS") return ["REPORTS"];
  if (intent === "UNSUPPORTED") return [];
  return ["REPORTS"];
}

export function buildAiSourceActions(input: {
  domains: readonly AiSourceDomain[];
  snapshot?: AiScopeSnapshot | null;
  language?: AiAnswerLanguage;
}) {
  if (!input.snapshot) return [];
  const snapshot = input.snapshot;
  const reportParams = new URLSearchParams({ range: normalizeAiRange(snapshot.range) });
  if (snapshot.selectedBranchId) reportParams.set("branchId", snapshot.selectedBranchId);
  if (snapshot.range === "custom") {
    reportParams.set("from", snapshot.from);
    reportParams.set("to", snapshot.to);
  }
  const expenseParams = new URLSearchParams({ range: "custom", from: snapshot.from, to: snapshot.to });
  if (snapshot.selectedBranchId) expenseParams.set("branchId", snapshot.selectedBranchId);
  const inventoryParams = new URLSearchParams();
  if (snapshot.selectedBranchId) inventoryParams.set("branchId", snapshot.selectedBranchId);

  const zh = input.language === "zh";
  return [...new Set(input.domains)].map((domain) => {
    if (domain === "PEOPLE") return { domain, label: zh ? "查看员工" : "View Employees", href: "/team?section=people" };
    if (domain === "EXPENSES") return { domain, label: zh ? "查看支出" : "View Expenses", href: `/expenses?${expenseParams}` };
    if (domain === "INVENTORY") return { domain, label: zh ? "查看库存" : "View Inventory", href: `/inventory${inventoryParams.size ? `?${inventoryParams}` : ""}` };
    if (domain === "SUPPLIER_BILLS") return { domain, label: zh ? "查看供应商账单" : "View Supplier Bills", href: "/inventory/supplier-bills" };
    if (domain === "APPOINTMENTS") return { domain, label: zh ? "查看预约" : "View Appointments", href: "/appointments" };
    if (domain === "PAYMENTS") return { domain, label: zh ? "查看收款" : "View Payments", href: `/reports?${reportParams}` };
    return { domain, label: zh ? "查看销售报告" : "View Sales Report", href: `/reports?${reportParams}` };
  });
}

export function aiScopeSummary(snapshot: AiScopeSnapshot, options?: {
  language?: AiAnswerLanguage;
  temporalSemantics?: AiTemporalSemantics;
}) {
  const zh = options?.language === "zh";
  const branch = snapshot.selectedBranchName
    ? snapshot.selectedBranchName
    : (zh ? "所有获授权分店" : "All authorised branches");
  if (options?.temporalSemantics === "SNAPSHOT") {
    const date = formatScopeDate(snapshot.to, zh ? "zh-MY" : "en-MY");
    return zh ? `截至 ${date} · ${branch}` : `As of ${date} · ${branch}`;
  }
  const period = snapshot.from === snapshot.to
    ? formatScopeDate(snapshot.from, zh ? "zh-MY" : "en-MY")
    : `${formatScopeDate(snapshot.from, zh ? "zh-MY" : "en-MY")} – ${formatScopeDate(snapshot.to, zh ? "zh-MY" : "en-MY")}`;
  return `${period} · ${branch}`;
}

function formatScopeDate(value: string, locale: string) {
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}
