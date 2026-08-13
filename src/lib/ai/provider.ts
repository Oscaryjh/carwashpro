import OpenAI from "openai";
import { buildAiInstructions } from "./prompt";
import { AI_ANALYSIS_JSON_SCHEMA, validateAiAnalysis, type AiAnalysis } from "./schema";

export type AiProviderResult = {
  analysis: AiAnalysis;
  provider: string;
  model: string;
  usage: { inputTokens: number | null; outputTokens: number | null; totalTokens: number | null };
  providerRequestId?: string | null;
};

export interface AiProvider {
  analyze(input: { question: string; context: unknown; recentMessages: Array<{ role: "USER" | "ASSISTANT"; content: string }> }): Promise<AiProviderResult>;
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
    const response = await this.client.responses.create({
      model: this.config.model,
      max_output_tokens: this.config.maxOutputTokens ?? 1200,
      store: false,
      instructions: buildAiInstructions(input.context),
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
    const context = input.context as {
      metrics?: Array<{ metricKey: string; value: unknown; available: boolean }>;
      businesses?: Array<{ name: string; metrics?: Array<{ metricKey: string; value: unknown; available: boolean }>; branchPerformance?: Array<{ name: string; netSales: string }> }>;
      reconciliationHealth?: { status?: string };
      branchPerformance?: Array<{ name: string; netSales: string }>;
    };
    const metricRows = context.metrics ?? aggregateGroupMetrics(context.businesses ?? []);
    const metrics = new Map(metricRows.map((metric) => [metric.metricKey, metric]));
    const profitQuestion = /profit|赚|賺|利润|利潤/i.test(input.question);
    const inventoryQuestion = /inventory|stock|商品|库存|庫存/i.test(input.question);
    const apQuestion = /supplier|bill|payable|供应商|供應商|账单|帳單/i.test(input.question);
    const spendingQuestion = /spend|expense|支出|费用|費用/i.test(input.question);
    const branchQuestion = /branch|store|分店|门店|門店/i.test(input.question);
    const caveats = [
      "AI analysis is advisory. Verify important decisions against Tetamu source reports.",
      ...(profitQuestion ? ["Income vs Recorded Business Spending is not accounting net profit because COGS, inventory valuation, depreciation, tax and General Ledger adjustments are not available."] : []),
      ...(context.reconciliationHealth?.status === "NEEDS_REVIEW" ? ["Some underlying data requires reconciliation review."] : []),
    ];
    const keys = profitQuestion ? ["INCOME_VS_RECORDED_SPENDING", "NET_SALES", "RECORDED_BUSINESS_SPENDING"]
      : inventoryQuestion ? ["LOW_STOCK_COUNT", "OUT_OF_STOCK_COUNT", "TRACKED_PRODUCTS"]
      : apQuestion ? ["OUTSTANDING_AP", "AP_DUE_SOON", "AP_OVERDUE"]
      : spendingQuestion ? ["RECORDED_BUSINESS_SPENDING", "MANUAL_SPENDING", "PAYROLL_SPENDING", "INVENTORY_PURCHASE_SPENDING"]
      : ["NET_SALES", "TRANSACTIONS", "AVERAGE_TRANSACTION", "PREVIOUS_NET_SALES"];
    const groupBranches = (context.businesses ?? []).flatMap((business) =>
      (business.branchPerformance ?? []).map((branch) => ({ ...branch, name: `${business.name} · ${branch.name}` })),
    );
    const rankedBranches = branchQuestion
      ? [...(context.branchPerformance ?? groupBranches)].sort((a, b) => Number(b.netSales) - Number(a.netSales))
      : [];
    const bestBranch = rankedBranches.length > 0 && Number(rankedBranches[0].netSales) > 0
      ? rankedBranches[0]
      : null;
    const countMetrics = new Set(["TRANSACTIONS", "LOW_STOCK_COUNT", "OUT_OF_STOCK_COUNT", "TRACKED_PRODUCTS", "AP_DUE_SOON", "AP_OVERDUE"]);
    const selected = keys.map((key) => metrics.get(key)).filter((metric): metric is NonNullable<typeof metric> => Boolean(metric?.available));
    const evidence = selected.map((metric) => ({
      metricKey: metric.metricKey as "NET_SALES" | "TRANSACTIONS" | "AVERAGE_TRANSACTION" | "PREVIOUS_NET_SALES" | "INCOME_VS_RECORDED_SPENDING" | "RECORDED_BUSINESS_SPENDING" | "LOW_STOCK_COUNT" | "OUT_OF_STOCK_COUNT" | "TRACKED_PRODUCTS" | "OUTSTANDING_AP" | "AP_DUE_SOON" | "AP_OVERDUE" | "MANUAL_SPENDING" | "PAYROLL_SPENDING" | "INVENTORY_PURCHASE_SPENDING",
      label: metric.metricKey.replaceAll("_", " ").toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase()),
      value: countMetrics.has(metric.metricKey) ? String(metric.value) : `RM ${metric.value}`,
      comparison: null,
      scope: "Current authorised scope",
      period: "Selected period",
    }));
    if (bestBranch) evidence.unshift({ metricKey: "NET_SALES", label: `Best branch by Net Sales: ${bestBranch.name}`, value: `RM ${bestBranch.netSales}`, comparison: null, scope: bestBranch.name, period: "Selected period" });
    return {
      analysis: validateAiAnalysis({
        summary: branchQuestion && !bestBranch
          ? "There isn't enough non-zero branch sales data in this period to identify a strongest branch."
          : evidence.length
            ? (bestBranch ? `${bestBranch.name} has the strongest Net Sales in the authorised branch scope.` : "Based on the available canonical Tetamu operating data, review the evidence below before making a business decision.")
            : "There isn't enough recorded business data in this period to support a meaningful comparison.",
        evidence,
        caveats,
        recommendations: ["Review the relevant Tetamu dashboard and source module before taking action."],
        followUpQuestions: ["Would you like to compare this with the previous period?"],
      }),
      provider: "mock",
      model: this.model,
      usage: { inputTokens: Math.ceil(JSON.stringify(input).length / 4), outputTokens: 120, totalTokens: Math.ceil(JSON.stringify(input).length / 4) + 120 },
    };
  }
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
