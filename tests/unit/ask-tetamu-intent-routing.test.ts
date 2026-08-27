import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { classifyAiQuestion } from "@/lib/ai/intent";
import { aiScopeSummary, buildAiSourceActions, sourceDomainsForIntent } from "@/lib/ai/presentation";
import { MockAiProvider } from "@/lib/ai/provider";
import { formatReportMoney } from "@/lib/reports/presentation";

const snapshot = {
  scopeType: "BUSINESS" as const,
  businessName: "Royal Salon",
  selectedBranchId: null,
  selectedBranchName: null,
  range: "month",
  from: "2026-08-01",
  to: "2026-08-27",
  timezone: "Asia/Kuching",
  businessDayCutoffTime: "02:00",
};

test("intent router maps English and Chinese questions to one authoritative domain", () => {
  const cases = [
    ["How are sales?", "SALES"], ["现在有多少员工？", "PEOPLE"], ["How much did we spend?", "EXPENSES"],
    ["哪些商品缺货？", "INVENTORY"], ["Which supplier bills are overdue?", "SUPPLIER_BILLS"],
    ["今天有多少预约？", "APPOINTMENTS"], ["How much cash did we collect?", "PAYMENTS"],
    ["How is the business doing overall?", "GENERAL_BUSINESS"], ["Forecast next month", "UNSUPPORTED"],
  ] as const;
  for (const [question, intent] of cases) assert.equal(classifyAiQuestion(question).intent, intent, question);
});

test("status questions use snapshots while activity questions use periods", () => {
  assert.equal(classifyAiQuestion("How many active staff do I have?").temporalSemantics, "SNAPSHOT");
  assert.equal(classifyAiQuestion("How many staff joined this month?").temporalSemantics, "PERIOD");
  assert.equal(classifyAiQuestion("Which products are out of stock?").temporalSemantics, "SNAPSHOT");
  assert.equal(classifyAiQuestion("How many appointments this month?").temporalSemantics, "PERIOD");
});

test("intent controls matching source CTA without keyword re-inference", () => {
  assert.deepEqual(sourceDomainsForIntent("PEOPLE"), ["PEOPLE"]);
  const action = buildAiSourceActions({ domains: sourceDomainsForIntent("PEOPLE"), snapshot, language: "zh" })[0];
  assert.deepEqual(action, { domain: "PEOPLE", label: "查看员工", href: "/team?section=people" });
  assert.equal(buildAiSourceActions({ domains: sourceDomainsForIntent("APPOINTMENTS"), snapshot })[0]?.href, "/appointments");
});

test("scope wording distinguishes frozen snapshots from periods", () => {
  assert.match(aiScopeSummary(snapshot, { temporalSemantics: "SNAPSHOT", language: "en" }), /^As of 27 Aug 2026 · All authorised branches$/);
  assert.match(aiScopeSummary(snapshot, { temporalSemantics: "PERIOD", language: "zh" }), /2026.*所有获授权分店/);
});

test("grounded mock answers stay inside the routed intent and user language", async () => {
  const context = { metrics: [
    { metricKey: "NET_SALES", value: "1200.00", available: true },
    { metricKey: "ACTIVE_EMPLOYEES", value: 4, available: true },
    { metricKey: "LOW_STOCK_COUNT", value: 2, available: true },
  ] };
  const people = await new MockAiProvider().analyze({ question: "现在有多少员工？", context, recentMessages: [] });
  assert.equal(people.analysis.intent, "PEOPLE");
  assert.equal(people.analysis.language, "zh");
  assert.deepEqual(people.analysis.evidence.map((row) => row.metricKey), ["ACTIVE_EMPLOYEES"]);
  assert.doesNotMatch(people.analysis.summary, /销售|sales/i);
});

test("financial values reuse Reports formatting", () => {
  assert.equal(formatReportMoney(1289109.9), "RM1,289,109.90");
  assert.equal(formatReportMoney(0), "RM0.00");
});

test("server keeps branch authorization, frozen metadata and responsive chat width", () => {
  const service = readFileSync("src/lib/ai/service.ts", "utf8");
  const page = readFileSync("src/app/(business)/ai/page.tsx", "utf8");
  const css = readFileSync("src/components/ask-tetamu.module.css", "utf8");
  assert.match(service, /!readScope\.allowedBranchIds\?\.includes/);
  assert.match(service, /scopeSnapshot: safeContext\.scopeSnapshot/);
  assert.match(page, /message\.structuredMetadata/);
  assert.match(css, /width: min\(100%, 1100px\)/);
  assert.match(css, /max-width: 520px/);
});
