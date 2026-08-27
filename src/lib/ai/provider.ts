import OpenAI from "openai";
import { formatReportMoney } from "@/lib/reports/presentation";
import { buildAiInstructions } from "./prompt";
import { classifyAiQuestion, type AiAnswerLanguage, type AiIntent, type AiTemporalSemantics } from "./intent";
import { AI_ANALYSIS_JSON_SCHEMA, validateAiAnalysis, type AiAnalysis, type AllowedAiMetricKey } from "./schema";

export type AiProviderResult = {
  analysis: AiAnalysis;
  provider: string;
  model: string;
  usage: { inputTokens: number | null; outputTokens: number | null; totalTokens: number | null };
  providerRequestId?: string | null;
};

export interface AiProvider {
  analyze(input: {
    question: string;
    intent?: AiIntent;
    language?: AiAnswerLanguage;
    temporalSemantics?: AiTemporalSemantics;
    context: unknown;
    recentMessages: Array<{ role: "USER" | "ASSISTANT"; content: string }>;
  }): Promise<AiProviderResult>;
}

export function getAiConfiguration(env: NodeJS.ProcessEnv = process.env) {
  const provider = (env.AI_PROVIDER ?? "mock").toLowerCase();
  const model = env.OPENAI_MODEL ?? "gpt-5.4-mini";
  if (!new Set(["mock", "openai"]).has(provider)) throw new Error("AI_PROVIDER_INVALID");
  if (provider === "openai" && !env.OPENAI_API_KEY) throw new Error("AI_PROVIDER_UNAVAILABLE");
  if (env.NODE_ENV === "production" && provider === "mock") throw new Error("AI_MOCK_PRODUCTION_FORBIDDEN");
  const maxOutputTokens = boundedInt(env.AI_MAX_OUTPUT_TOKENS, 1200, 128, 4096);
  return { provider: provider as "mock" | "openai", model, maxOutputTokens };
}

export function createAiProvider(env: NodeJS.ProcessEnv = process.env): AiProvider {
  const config = getAiConfiguration(env);
  return config.provider === "openai"
    ? new OpenAiProvider({ apiKey: env.OPENAI_API_KEY!, model: config.model, maxOutputTokens: config.maxOutputTokens })
    : new MockAiProvider(config.model);
}

export class OpenAiProvider implements AiProvider {
  private readonly client: Pick<OpenAI, "responses">;
  constructor(private readonly config: { apiKey: string; model: string; maxOutputTokens?: number }, client?: Pick<OpenAI, "responses">) {
    this.client = client ?? new OpenAI({ apiKey: config.apiKey, timeout: 30_000, maxRetries: 1 });
  }

  async analyze(input: Parameters<AiProvider["analyze"]>[0]): Promise<AiProviderResult> {
    const inferred = classifyAiQuestion(input.question);
    const routing = {
      intent: input.intent ?? inferred.intent,
      language: input.language ?? inferred.language,
      temporalSemantics: input.temporalSemantics ?? inferred.temporalSemantics,
    };
    const response = await this.client.responses.create({
      model: this.config.model,
      max_output_tokens: this.config.maxOutputTokens ?? 1200,
      store: false,
      instructions: buildAiInstructions(input.context, {
        intent: routing.intent,
        language: routing.language,
        temporalSemantics: routing.temporalSemantics,
      }),
      input: [
        ...input.recentMessages.slice(-8).map((message) => ({
          role: message.role === "USER" ? "user" as const : "assistant" as const,
          content: message.content,
        })),
        { role: "user", content: input.question },
      ],
      tools: [],
      text: {
        format: {
          type: "json_schema",
          name: "tetamu_business_analysis",
          strict: true,
          schema: AI_ANALYSIS_JSON_SCHEMA,
        },
      },
    });
    let parsed: unknown;
    try { parsed = JSON.parse(response.output_text); } catch { throw new Error("AI_RESPONSE_INVALID"); }
    return {
      analysis: validateAiAnalysis(parsed),
      provider: "openai",
      model: this.config.model,
      usage: {
        inputTokens: response.usage?.input_tokens ?? null,
        outputTokens: response.usage?.output_tokens ?? null,
        totalTokens: response.usage?.total_tokens ?? null,
      },
      providerRequestId: response._request_id ?? null,
    };
  }
}

function boundedInt(value: string | undefined, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

export class MockAiProvider implements AiProvider {
  constructor(private readonly model = "tetamu-mock-1") {}
  async analyze(input: Parameters<AiProvider["analyze"]>[0]): Promise<AiProviderResult> {
    const inferred = classifyAiQuestion(input.question);
    const intent = input.intent ?? inferred.intent;
    const language = input.language ?? inferred.language;
    const temporalSemantics = input.temporalSemantics ?? inferred.temporalSemantics;
    const context = input.context as {
      metrics?: Array<{ metricKey: string; value: unknown; available: boolean }>;
      businesses?: Array<{ name: string; metrics?: Array<{ metricKey: string; value: unknown; available: boolean }>; branchPerformance?: Array<{ name: string; netSales: string }> }>;
      reconciliationHealth?: { status?: string };
      branchPerformance?: Array<{ name: string; netSales: string }>;
    };
    const metricRows = context.metrics ?? aggregateGroupMetrics(context.businesses ?? []);
    const metrics = new Map(metricRows.map((metric) => [metric.metricKey, metric]));
    const branchQuestion = /branch|store|分店|门店|門店/i.test(input.question);
    const profitQuestion = /profit|利润|利潤|盈利|赚了|賺了/i.test(input.question);
    const comparisonQuestion = /previous|compare|comparison|last period|down|up|上期|之前|比较|比較|下降|增长|增長/i.test(input.question);
    const keys = metricKeysForIntent(intent, comparisonQuestion);
    const groupBranches = (context.businesses ?? []).flatMap((business) =>
      (business.branchPerformance ?? []).map((branch) => ({ ...branch, name: `${business.name} · ${branch.name}` })),
    );
    const rankedBranches = branchQuestion
      ? [...(context.branchPerformance ?? groupBranches)].sort((a, b) => Number(b.netSales) - Number(a.netSales))
      : [];
    const bestBranch = rankedBranches.length > 0 && Number(rankedBranches[0].netSales) > 0
      ? rankedBranches[0]
      : null;
    const countMetrics = new Set([
      "TRANSACTIONS", "LOW_STOCK_COUNT", "OUT_OF_STOCK_COUNT", "TRACKED_PRODUCTS", "AP_DUE_SOON", "AP_OVERDUE", "AP_OPEN_BILLS",
      "ACTIVE_EMPLOYEES", "INACTIVE_EMPLOYEES", "APPOINTMENTS_TOTAL", "APPOINTMENTS_SCHEDULED", "APPOINTMENTS_COMPLETED",
      "APPOINTMENTS_CANCELLED", "APPOINTMENTS_NO_SHOW",
    ]);
    const selected = keys.map((key) => metrics.get(key)).filter((metric): metric is NonNullable<typeof metric> => Boolean(metric?.available));
    const evidence = selected.map((metric) => ({
      metricKey: metric.metricKey as AllowedAiMetricKey,
      label: metricLabel(metric.metricKey, language),
      value: countMetrics.has(metric.metricKey) ? String(metric.value) : formatReportMoney(metric.value),
      comparison: null,
      scope: "Current authorised scope",
      period: "Selected period",
    }));
    if (bestBranch && intent === "SALES") evidence.unshift({ metricKey: "NET_SALES", label: language === "zh" ? `净销售额最高：${bestBranch.name}` : `Best branch by Net Sales: ${bestBranch.name}`, value: formatReportMoney(bestBranch.netSales), comparison: null, scope: bestBranch.name, period: "Selected period" });
    const caveats = [
      ...(profitQuestion ? [language === "zh" ? "简单营运余额不是会计净利润；目前资料不包含完整的销货成本、折旧、税务及总账调整。" : "Simple Operating Balance is not accounting net profit because complete COGS, depreciation, tax and General Ledger adjustments are not available."] : []),
      ...(context.reconciliationHealth?.status === "NEEDS_REVIEW" ? [language === "zh" ? "部分相关来源存在具体对账项目，请在来源页面复核。" : "A related source has specific reconciliation items that should be reviewed in its source module."] : []),
    ];
    return {
      analysis: validateAiAnalysis({
        intent,
        language,
        temporalSemantics,
        summary: buildSummary({ intent, language, metrics, evidenceCount: evidence.length, bestBranch, branchRequested: branchQuestion }),
        evidence,
        caveats,
        recommendations: [],
        followUpQuestions: [],
      }),
      provider: "mock",
      model: this.model,
      usage: { inputTokens: Math.ceil(JSON.stringify(input).length / 4), outputTokens: 120, totalTokens: Math.ceil(JSON.stringify(input).length / 4) + 120 },
    };
  }
}

const METRIC_LABELS: Partial<Record<AllowedAiMetricKey, string>> = {
  NET_SALES: "Net Sales",
  PAYMENTS_COLLECTED: "Payments Collected",
  RECORDED_BUSINESS_SPENDING: "Confirmed Expenses",
  INCOME_VS_RECORDED_SPENDING: "Simple Operating Balance",
  OUTSTANDING_AP: "Outstanding Supplier Bills",
  AP_DUE_SOON: "Supplier Bills Due Soon",
  AP_OVERDUE: "Overdue Supplier Bills",
  AVERAGE_TRANSACTION: "Average Sale",
  ACTIVE_EMPLOYEES: "Active employees",
  INACTIVE_EMPLOYEES: "Inactive employees",
  APPOINTMENTS_TOTAL: "Appointments",
  APPOINTMENTS_SCHEDULED: "Scheduled",
  APPOINTMENTS_COMPLETED: "Completed",
  APPOINTMENTS_CANCELLED: "Cancelled",
  APPOINTMENTS_NO_SHOW: "No-show",
  PAYMENTS_CASH: "Cash",
  PAYMENTS_CARD: "Card",
  PAYMENTS_DUITNOW: "DuitNow",
  PAYMENTS_BANK_TRANSFER: "Bank Transfer",
};

function metricLabel(metricKey: string, language: AiAnswerLanguage) {
  const english = METRIC_LABELS[metricKey as AllowedAiMetricKey]
    ?? metricKey.replaceAll("_", " ").toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
  return language === "zh" ? (ZH_METRIC_LABELS[metricKey as AllowedAiMetricKey] ?? english) : english;
}

const ZH_METRIC_LABELS: Partial<Record<AllowedAiMetricKey, string>> = {
  NET_SALES: "净销售额（Net Sales）", GROSS_SALES: "销售总额", REFUNDS: "退款", TRANSACTIONS: "交易数", AVERAGE_TRANSACTION: "平均销售额",
  PAYMENTS_COLLECTED: "已收款项", RECORDED_BUSINESS_SPENDING: "已确认支出", INCOME_VS_RECORDED_SPENDING: "简单营运余额",
  LOW_STOCK_COUNT: "低库存", OUT_OF_STOCK_COUNT: "缺货", TRACKED_PRODUCTS: "追踪中的商品",
  OUTSTANDING_AP: "未结供应商账单", AP_DUE_SOON: "即将到期", AP_OVERDUE: "逾期账单", AP_OPEN_BILLS: "未结账单",
  ACTIVE_EMPLOYEES: "在职员工", INACTIVE_EMPLOYEES: "非在职员工", APPOINTMENTS_TOTAL: "预约总数",
  APPOINTMENTS_SCHEDULED: "已安排", APPOINTMENTS_COMPLETED: "已完成", APPOINTMENTS_CANCELLED: "已取消", APPOINTMENTS_NO_SHOW: "未到场",
  PAYMENTS_CASH: "现金", PAYMENTS_CARD: "银行卡", PAYMENTS_DUITNOW: "DuitNow", PAYMENTS_BANK_TRANSFER: "银行转账",
};

function metricKeysForIntent(intent: AiIntent, includeComparison: boolean) {
  if (intent === "PEOPLE") return ["ACTIVE_EMPLOYEES", "INACTIVE_EMPLOYEES"];
  if (intent === "INVENTORY") return ["OUT_OF_STOCK_COUNT", "LOW_STOCK_COUNT", "TRACKED_PRODUCTS"];
  if (intent === "SUPPLIER_BILLS") return ["AP_OVERDUE", "AP_DUE_SOON", "AP_OPEN_BILLS", "OUTSTANDING_AP"];
  if (intent === "EXPENSES") return ["RECORDED_BUSINESS_SPENDING", "INCOME_VS_RECORDED_SPENDING", "MANUAL_SPENDING", "CLAIM_SPENDING", "PAYROLL_SPENDING", "INVENTORY_PURCHASE_SPENDING"];
  if (intent === "PAYMENTS") return ["PAYMENTS_COLLECTED", "PAYMENTS_CASH", "PAYMENTS_CARD", "PAYMENTS_DUITNOW", "PAYMENTS_BANK_TRANSFER", "REFUNDS"];
  if (intent === "APPOINTMENTS") return ["APPOINTMENTS_TOTAL", "APPOINTMENTS_SCHEDULED", "APPOINTMENTS_COMPLETED", "APPOINTMENTS_CANCELLED", "APPOINTMENTS_NO_SHOW"];
  if (intent === "GENERAL_BUSINESS") return ["NET_SALES", "RECORDED_BUSINESS_SPENDING", "LOW_STOCK_COUNT", "OUT_OF_STOCK_COUNT", "AP_OVERDUE", "APPOINTMENTS_TOTAL"];
  if (intent === "UNSUPPORTED") return [];
  return ["NET_SALES", "TRANSACTIONS", "AVERAGE_TRANSACTION", "REFUNDS", ...(includeComparison ? ["PREVIOUS_NET_SALES"] : [])];
}

function buildSummary(input: {
  intent: AiIntent;
  language: AiAnswerLanguage;
  metrics: Map<string, { metricKey: string; value: unknown; available: boolean }>;
  evidenceCount: number;
  bestBranch: { name: string; netSales: string } | null;
  branchRequested: boolean;
}) {
  const zh = input.language === "zh";
  if (input.intent === "UNSUPPORTED") return zh ? "目前没有可靠的预测数据可以回答这个问题。你可以改为查询现有的销售、支出、员工、库存、预约、收款或供应商账单。" : "I don't have a reliable forecast or connected data for that question yet. I can help with sales, expenses, employees, inventory, appointments, payments and supplier bills.";
  if (input.intent === "PEOPLE") {
    const active = input.metrics.get("ACTIVE_EMPLOYEES")?.value ?? 0;
    return zh ? `你目前在获授权范围内有 ${active} 名在职员工。` : `You currently have ${active} active employee${Number(active) === 1 ? "" : "s"} in your authorised scope.`;
  }
  if (input.intent === "SALES" && input.branchRequested && input.bestBranch === null && input.evidenceCount > 0) return zh ? "所选期间没有足够的非零分店净销售数据来判断表现最强的分店。" : "There isn't enough non-zero branch sales data in the selected period to identify a strongest branch.";
  if (input.intent === "SALES" && Number(input.metrics.get("NET_SALES")?.value ?? 0) === 0) return zh ? "所选期间没有已确认的销售。" : "There are no recognised sales in the selected period.";
  if (input.intent === "INVENTORY" && input.evidenceCount === 0) return zh ? "目前没有可读取的库存状态。" : "Current inventory status is not available from the connected records.";
  if (input.intent === "SUPPLIER_BILLS" && input.evidenceCount === 0) return zh ? "目前没有可读取的供应商账单状态。" : "Supplier bill status is not available from the connected records.";
  if (input.intent === "APPOINTMENTS" && input.evidenceCount === 0) return zh ? "所选期间没有预约记录。" : "There are no appointments in the selected period.";
  if (input.branchRequested && input.bestBranch) return zh ? `${input.bestBranch.name} 在获授权范围内的净销售额最高。` : `${input.bestBranch.name} has the strongest Net Sales in the authorised branch scope.`;
  return zh ? "以下是从你获授权的 Tetamu 记录读取到的结果。" : "Here are the relevant figures from your authorised Tetamu records.";
}

function aggregateGroupMetrics(
  businesses: Array<{ metrics?: Array<{ metricKey: string; value: unknown; available: boolean }> }>,
) {
  const totals = new Map<string, { value: number; available: boolean }>();
  for (const business of businesses) {
    for (const metric of business.metrics ?? []) {
      if (!metric.available || !Number.isFinite(Number(metric.value))) continue;
      const current = totals.get(metric.metricKey) ?? { value: 0, available: false };
      current.value += Number(metric.value);
      current.available = true;
      totals.set(metric.metricKey, current);
    }
  }
  return [...totals.entries()].map(([metricKey, total]) => ({
    metricKey,
    value: Number.isInteger(total.value) ? total.value : total.value.toFixed(2),
    available: total.available,
  }));
}
