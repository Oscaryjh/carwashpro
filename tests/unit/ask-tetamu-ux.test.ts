import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  ASK_TETAMU_SUGGESTED_QUESTIONS,
  aiScopeSummary,
  buildAiSourceActions,
  getAiUsageNotice,
  normalizeAiRange,
  showsCustomAiDates,
} from "@/lib/ai/presentation";
import { MockAiProvider } from "@/lib/ai/provider";
import { resolvePerformancePeriods } from "@/lib/business-performance/read-model";

test("Ask Tetamu exposes the four business periods and custom dates only for Custom", () => {
  assert.equal(normalizeAiRange("today"), "today");
  assert.equal(normalizeAiRange("7days"), "7days");
  assert.equal(normalizeAiRange("month"), "month");
  assert.equal(normalizeAiRange("custom"), "custom");
  assert.equal(normalizeAiRange("last_month"), "month");
  assert.equal(showsCustomAiDates("custom"), true);
  assert.equal(showsCustomAiDates("month"), false);
});

test("Ask Tetamu 7 Days means today and the preceding six business dates", () => {
  const period = resolvePerformancePeriods({
    range: "7days",
    now: new Date("2026-08-27T04:00:00.000Z"),
    timezone: "Asia/Kuala_Lumpur",
    businessDayCutoffTime: "00:00",
  });
  assert.equal(period.current.fromDateValue, "2026-08-21");
  assert.equal(period.current.toDateValue, "2026-08-27");
});

test("source drill-down preserves the answer period and any historical branch scope", () => {
  const snapshot = {
    scopeType: "BUSINESS" as const,
    businessName: "Safe Salon",
    selectedBranchId: "branch-1",
    selectedBranchName: "Main",
    range: "custom",
    from: "2026-08-01",
    to: "2026-08-12",
    timezone: "Asia/Kuala_Lumpur",
    businessDayCutoffTime: "00:00",
  };
  const actions = buildAiSourceActions({ domains: ["REPORTS", "EXPENSES"], snapshot });
  assert.match(actions[0]!.href, /range=custom/);
  assert.match(actions[0]!.href, /branchId=branch-1/);
  assert.match(actions[0]!.href, /from=2026-08-01/);
  assert.match(actions[1]!.href, /to=2026-08-12/);
  assert.match(aiScopeSummary(snapshot), /Main/);
});

test("business suggestions and UI do not expose misleading or internal commercial terminology", () => {
  assert.ok(ASK_TETAMU_SUGGESTED_QUESTIONS.includes("How are sales and expenses this month?"));
  assert.equal(ASK_TETAMU_SUGGESTED_QUESTIONS.some((question) => /profit/i.test(question)), false);
  const page = readFileSync("src/app/(business)/ai/page.tsx", "utf8");
  const chat = readFileSync("src/components/ai-business-chat.tsx", "utf8");
  const visibleCopy = `${page}\n${chat}`;
  assert.doesNotMatch(visibleCopy, /Technical failures|AI allowance is not configured|canonical business period|What is my profit\?/i);
  assert.doesNotMatch(page, /name="branchId"|<span>Branch<\/span>/i);
});

test("conversation sidebar contains navigation only and hides normal usage", () => {
  const page = readFileSync("src/app/(business)/ai/page.tsx", "utf8");
  assert.doesNotMatch(page, /AI usage|questions remaining|styles\.usage/i);
  assert.match(page, /archivedMode \? "Archived" : "Conversations"/);
  assert.match(page, /aria-label="Ask Tetamu conversations"/);
  assert.match(page, /Start a new conversation/);
  assert.equal(getAiUsageNotice({
    configured: true,
    status: "ACTIVE",
    remainingRequests: 300,
    periodEnd: new Date("2026-09-01T00:00:00.000Z"),
    timezone: "Asia\/Kuala_Lumpur",
  }), null);
});

test("conversation removal uses a confirmed soft archive scoped to the owning user and business", () => {
  const page = readFileSync("src/app/(business)/ai/page.tsx", "utf8");
  const action = readFileSync("src/app/(business)/ai/actions.ts", "utf8");
  const control = readFileSync("src/components/ai-conversation-actions.tsx", "utf8");
  assert.match(page, /ArchiveConversationButton/);
  assert.match(control, /Remove this conversation\?/);
  assert.match(control, /Keep conversation/);
  assert.match(control, /role="dialog"/);
  assert.doesNotMatch(control, /window\.confirm/);
  assert.match(action, /aiConversation\.updateMany/);
  assert.match(action, /createdById: context\.user\.userId/);
  assert.match(action, /businessId: context\.businessId/);
  assert.match(action, /archivedAt: new Date\(\)/);
  assert.doesNotMatch(action, /aiConversation\.delete/);
});

test("archived conversations are available from the sidebar footer and can be restored", () => {
  const page = readFileSync("src/app/(business)/ai/page.tsx", "utf8");
  const action = readFileSync("src/app/(business)/ai/actions.ts", "utf8");
  const control = readFileSync("src/components/ai-conversation-actions.tsx", "utf8");
  const styles = readFileSync("src/components/ask-tetamu.module.css", "utf8");

  assert.match(page, /Archived conversations/);
  assert.match(page, /conversationListFooter/);
  assert.match(page, /archivedAt: \{ not: null \}/);
  assert.match(page, /RestoreConversationButton/);
  assert.match(page, /conversation\.id} iconOnly/);
  assert.match(control, /restoreAiConversationAction/);
  assert.match(control, /Restore this conversation\?/);
  assert.match(control, /Keep archived/);
  assert.match(control, /aria-label="Restore conversation"/);
  assert.match(action, /data: \{ archivedAt: null \}/);
  assert.match(styles, /\.conversationListFooter/);
});

test("mobile drawer reuses the conversation-only sidebar at phone widths", () => {
  const page = readFileSync("src/app/(business)/ai/page.tsx", "utf8");
  const styles = readFileSync("src/components/ask-tetamu.module.css", "utf8");
  assert.match(page, /<details className=\{styles\.mobileConversations\}>[\s\S]*\{sidebar\}[\s\S]*<\/details>/);
  assert.match(styles, /@media \(max-width: 900px\)[\s\S]*\.sidebar\s*\{[\s\S]*display: none;/);
  assert.match(styles, /@media \(max-width: 900px\)[\s\S]*\.mobileConversations\s*\{[\s\S]*display: block;/);
  assert.match(styles, /@media \(max-width: 620px\)[\s\S]*\.composerSection/);
});

test("low usage warning appears only near the monthly limit", () => {
  const notice = getAiUsageNotice({
    configured: true,
    status: "ACTIVE",
    remainingRequests: 20,
    periodEnd: new Date("2026-09-01T00:00:00.000Z"),
    timezone: "Asia\/Kuala_Lumpur",
  });
  assert.equal(notice?.kind, "LOW");
  assert.match(notice?.message ?? "", /20 Ask Tetamu questions remaining this month/i);
  assert.match(notice?.message ?? "", /Resets 1 Sep 2026/i);
});

test("composer shows the remaining monthly questions at its lower left", () => {
  const page = readFileSync("src/app/(business)/ai/page.tsx", "utf8");
  const chat = readFileSync("src/components/ai-business-chat.tsx", "utf8");
  const styles = readFileSync("src/components/ask-tetamu.module.css", "utf8");
  assert.match(page, /remainingRequests=\{allowance\.remainingRequests\}/);
  assert.match(chat, /Ask Tetamu questions remaining this month/);
  assert.match(chat, /styles\.composerMeta/);
  assert.match(styles, /\.composerMeta[\s\S]*justify-content: space-between/);
  assert.match(styles, /\.quotaRemaining,[\s\S]*text-align: left/);
});

test("exhausted usage has a natural reset message and disables Ask", () => {
  const notice = getAiUsageNotice({
    configured: true,
    status: "ACTIVE",
    remainingRequests: 0,
    periodEnd: new Date("2026-09-01T00:00:00.000Z"),
    timezone: "Asia\/Kuala_Lumpur",
  });
  const page = readFileSync("src/app/(business)/ai/page.tsx", "utf8");
  const chat = readFileSync("src/components/ai-business-chat.tsx", "utf8");
  assert.equal(notice?.kind, "EXHAUSTED");
  assert.match(notice?.message ?? "", /reached this month's Ask Tetamu limit/i);
  assert.match(notice?.message ?? "", /Available again on 1 Sep 2026/i);
  assert.match(page, /allowance\.remainingRequests === 0/);
  assert.match(chat, /disabled=\{props\.quotaBlocked \|\| pending\}/);
  assert.match(chat, /disabled=\{props\.quotaBlocked \|\| pending \|\| !question\.trim\(\)\}/);
});

test("backend quota reservation and enforcement remain connected", () => {
  const service = readFileSync("src/lib/ai/service.ts", "utf8");
  const commercial = readFileSync("src/lib/ai/commercial.ts", "utf8");
  assert.match(service, /assertAiAllowanceConfigured/);
  assert.match(service, /reserveAiQuota/);
  assert.match(service, /finalizeAiSuccess/);
  assert.match(commercial, /AI_QUOTA_EXCEEDED/);
  assert.match(commercial, /consumedRequests: \{ increment: 1 \}/);
});

test("mock answers use Reports-compatible financial labels and fail safely for forecasts", async () => {
  const context = {
    metrics: [
      { metricKey: "NET_SALES", value: "1000.00", available: true },
      { metricKey: "PAYMENTS_COLLECTED", value: "900.00", available: true },
      { metricKey: "TRANSACTIONS", value: 5, available: true },
      { metricKey: "AVERAGE_TRANSACTION", value: "200.00", available: true },
      { metricKey: "PREVIOUS_NET_SALES", value: "800.00", available: true },
    ],
  };
  const provider = new MockAiProvider();
  const current = await provider.analyze({ question: "How are sales?", context, recentMessages: [] });
  assert.equal(current.analysis.evidence.find((item) => item.metricKey === "NET_SALES")?.label, "Net Sales");
  assert.equal(current.analysis.evidence.find((item) => item.metricKey === "AVERAGE_TRANSACTION")?.label, "Average Sale");
  const payments = await provider.analyze({ question: "How much payment was collected?", context, recentMessages: [] });
  assert.equal(payments.analysis.evidence.find((item) => item.metricKey === "PAYMENTS_COLLECTED")?.label, "Payments Collected");
  const forecast = await provider.analyze({ question: "Forecast next month", context, recentMessages: [] });
  assert.match(forecast.analysis.summary, /don't have a reliable forecast/i);
});

test("mock answers distinguish no recognised sales from a provider failure", async () => {
  const result = await new MockAiProvider().analyze({
    question: "How are sales?",
    context: { metrics: [{ metricKey: "NET_SALES", value: "0.00", available: true }] },
    recentMessages: [],
  });
  assert.match(result.analysis.summary, /no recognised sales/i);
});
