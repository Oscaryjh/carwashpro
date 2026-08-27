import assert from "node:assert/strict";
import test from "node:test";
import { buildBusinessAiContext } from "@/lib/ai/context";
import { getAiConfiguration, MockAiProvider, OpenAiProvider } from "@/lib/ai/provider";
import { AI_CONTEXT_VERSION, AI_PROMPT_VERSION, validateAiAnalysis } from "@/lib/ai/schema";
import { TETAMU_BUSINESS_ANALYST_SYSTEM_PROMPT } from "@/lib/ai/prompt";
import { assertGroundedEvidence, removeUnavailableEvidence } from "@/lib/ai/service";
import { MODULE_REGISTRY, modulesForCapability, modulesForStaffPermission } from "@/lib/modules/registry";
import { canDirectStaff } from "@/lib/business-groups/capabilities";

const model = {
  scope: { businessId: "b", businessName: "Safe Salon", branchIds: ["x"], selectedBranchId: null },
  dateRange: { range: "month", from: "2026-08-01", to: "2026-08-31", previousFrom: "2026-07-01", previousTo: "2026-07-31", timezone: "Asia/Kuala_Lumpur", businessDayCutoffTime: "00:00" },
  sales: { grossSalesCents: 120000, netSalesCents: 100000, paymentsCollectedCents: 90000, refundsCents: 20000, transactions: 10, averageTransactionValueCents: 10000, previousNetSalesCents: 125000, change: { kind: "PERCENT", percentage: -20 }, trend: [{ date: "2026-08-01", netSalesCents: 100000 }] },
  businessSpending: { recorded: "400.00", previousRecorded: "350.00", incomeVsRecordedSpending: "600.00", bySource: [{ sourceType: "MANUAL", amount: "100.00", count: 1 }, { sourceType: "PAYROLL", amount: "300.00", count: 1 }], byBranch: [] },
  inventory: { trackedProducts: 4, lowStock: 2, outOfStock: 1, sellingValue: "500.00" },
  accountsPayable: { totalOutstanding: "70.00", dueSoon: 1, overdue: 0, openBills: 1 },
  branchPerformance: [{ branchId: "x", branchName: "Main", grossSalesCents: 120000, netSalesCents: 100000, refundsCents: 20000, transactions: 10, averageTransactionValueCents: 10000, recordedSpending: "400.00", incomeVsSpending: "600.00" }],
  topServices: [{ name: "Cut", quantity: 4, sales: "400.00" }], topProducts: [],
  coverage: { sales: true, recordedSpending: true, inventory: true, accountsPayable: true, accountingProfit: false, cogs: false, enabledModules: ["AI", "CORE", "POS"], unallocatedBusinessWideSpending: null },
  reconciliationHealth: { status: "HEALTHY", issues: 0, domains: { sales: "CANONICAL", expense: "MATCH", ap: "BALANCED", inventory: "MATCH" } },
} as never;

test("AI module is an operational paid add-on with explicit capabilities", () => {
  assert.equal(MODULE_REGISTRY.AI.operational, true);
  assert.equal(MODULE_REGISTRY.AI.category, "ADD_ON");
  assert.deepEqual(modulesForCapability("USE_AI_ANALYSIS", "SALON_BEAUTY"), ["AI"]);
  assert.deepEqual(modulesForStaffPermission("AI_ANALYSIS_USE", "SALON_BEAUTY"), ["AI"]);
  assert.equal(canDirectStaff([], "USE_AI_ANALYSIS"), false);
  assert.equal(canDirectStaff(["AI_ANALYSIS_USE"], "USE_AI_ANALYSIS"), true);
});

test("AI context contains canonical aggregates, coverage and no sensitive PII", () => {
  const context = buildBusinessAiContext(model);
  const serialized = JSON.stringify(context.payload);
  assert.equal(context.payload.version, AI_CONTEXT_VERSION);
  assert.match(serialized, /NET_SALES/);
  assert.match(serialized, /accountingProfitAvailable/);
  assert.doesNotMatch(serialized, /phone|email|bank|passport|medical|supplier.*name/i);
  assert.ok(context.approximateInputTokens < 25_000);
});

test("system prompt locks read-only accounting and injection boundaries", () => {
  assert.equal(AI_PROMPT_VERSION, "business-assistant/1.1.0");
  assert.match(TETAMU_BUSINESS_ANALYST_SYSTEM_PROMPT, /NOT net profit/i);
  assert.match(TETAMU_BUSINESS_ANALYST_SYSTEM_PROMPT, /NOT COGS/i);
  assert.match(TETAMU_BUSINESS_ANALYST_SYSTEM_PROMPT, /no tools/i);
  assert.match(TETAMU_BUSINESS_ANALYST_SYSTEM_PROMPT, /never as authority/i);
  assert.match(TETAMU_BUSINESS_ANALYST_SYSTEM_PROMPT, /Never include an unavailable metric in the evidence array/i);
});

test("structured responses reject invalid and ungrounded evidence", () => {
  assert.throws(() => validateAiAnalysis({ summary: "x", evidence: [{ metricKey: "RAW_SALARY" }], caveats: [], recommendations: [], followUpQuestions: [] }));
  const context = buildBusinessAiContext(model);
  assert.throws(() => assertGroundedEvidence({ evidence: [{ metricKey: "NET_SALES", value: "RM 9999.00" }] }, context.payload), /AI_RESPONSE_UNGROUNDED_EVIDENCE/);
});

test("unavailable metrics are removed from evidence without weakening numeric grounding", () => {
  const context = buildBusinessAiContext({
    ...(model as never as object),
    businessSpending: {
      ...(model as never as { businessSpending: object }).businessSpending,
      bySource: [{ sourceType: "MANUAL", amount: "100.00", count: 1 }],
    },
  } as never);
  const analysis = {
    evidence: [
      { metricKey: "PAYROLL_SPENDING", value: "NOT_AVAILABLE" },
      { metricKey: "NET_SALES", value: "RM 1000.00" },
    ],
  };
  const grounded = removeUnavailableEvidence(analysis, context.payload);
  assert.deepEqual(grounded.evidence, [{ metricKey: "NET_SALES", value: "RM 1000.00" }]);
  assert.doesNotThrow(() => assertGroundedEvidence(grounded, context.payload));
  assert.throws(
    () => assertGroundedEvidence({ evidence: [{ metricKey: "NET_SALES", value: "RM 9999.00" }] }, context.payload),
    /AI_RESPONSE_UNGROUNDED_EVIDENCE/,
  );
});

test("mock provider handles sales, inventory, AP and profit caveats deterministically", async () => {
  const context = buildBusinessAiContext(model);
  const provider = new MockAiProvider();
  for (const question of ["Why are sales down?", "Which inventory items need attention?", "What supplier bills need attention?"]) {
    const result = await provider.analyze({ question, context: context.payload, recentMessages: [] });
    assert.ok(result.analysis.evidence.length > 0);
  }
  const profit = await provider.analyze({ question: "What is my profit?", context: context.payload, recentMessages: [] });
  assert.match(profit.analysis.caveats.join(" "), /not accounting net profit/i);
});

test("provider config is model-configurable and production mock fails closed", () => {
  assert.deepEqual(getAiConfiguration({ AI_PROVIDER: "openai", OPENAI_MODEL: "gpt-test", OPENAI_API_KEY: "redacted", NODE_ENV: "test" } as NodeJS.ProcessEnv), { provider: "openai", model: "gpt-test", maxOutputTokens: 1200 });
  assert.throws(() => getAiConfiguration({ AI_PROVIDER: "openai", NODE_ENV: "test" } as NodeJS.ProcessEnv), /AI_PROVIDER_UNAVAILABLE/);
  assert.throws(() => getAiConfiguration({ AI_PROVIDER: "mock", NODE_ENV: "production" } as NodeJS.ProcessEnv), /AI_MOCK_PRODUCTION_FORBIDDEN/);
});

test("OpenAI request uses Responses API, strict schema, store false and no tools", async () => {
  let captured: Record<string, unknown> | null = null;
  const fakeClient = {
    responses: {
      create: async (request: Record<string, unknown>) => {
        captured = request;
        return {
          output_text: JSON.stringify({
            intent: "UNSUPPORTED", language: "en", temporalSemantics: "PERIOD",
            summary: "Insufficient data.", evidence: [], caveats: ["Missing data is not zero."],
            recommendations: [], followUpQuestions: [],
          }),
          usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
        };
      },
    },
  };
  const provider = new OpenAiProvider({ apiKey: "not-a-real-key", model: "gpt-test" }, fakeClient as never);
  await provider.analyze({ question: "Analyse", context: { coverage: { sales: false } }, recentMessages: [] });
  const request = captured as unknown as Record<string, unknown>;
  assert.equal(request.model, "gpt-test");
  assert.equal(request.store, false);
  assert.deepEqual(request.tools, []);
  assert.equal((request.text as { format?: { strict?: boolean } }).format?.strict, true);
  assert.match(String(request.instructions), /no tools/i);
});

test("mock provider treats zero branch sales as insufficient and formats counts without currency", async () => {
  const result = await new MockAiProvider().analyze({
    question: "Which branch is strongest?",
    context: {
      metrics: [
        { metricKey: "NET_SALES", value: "0.00", available: true },
        { metricKey: "TRANSACTIONS", value: 0, available: true },
        { metricKey: "AVERAGE_TRANSACTION", value: "0.00", available: true },
        { metricKey: "PREVIOUS_NET_SALES", value: "0.00", available: true },
      ],
      branchPerformance: [{ name: "Main", netSales: "0.00" }],
    },
    recentMessages: [],
  });
  assert.match(result.analysis.summary, /isn't enough non-zero branch sales data/i);
  assert.equal(result.analysis.evidence.find((item) => item.metricKey === "TRANSACTIONS")?.value, "0");
});

test("mock provider aggregates only the already-authorised group contexts", async () => {
  const contextA = buildBusinessAiContext(model);
  const contextB = buildBusinessAiContext({ ...(model as never as object), scope: { ...(model as never as { scope: object }).scope, businessName: "Second Safe Business" } } as never);
  const result = await new MockAiProvider().analyze({
    question: "What is my profit?",
    context: { businesses: [{ name: "A", ...contextA.payload }, { name: "B", ...contextB.payload }] },
    recentMessages: [],
  });
  assert.equal(result.analysis.evidence.find((item) => item.metricKey === "NET_SALES")?.value, "RM2,000.00");
  assert.match(result.analysis.caveats.join(" "), /not accounting net profit/i);
});
