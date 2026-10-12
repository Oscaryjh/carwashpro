import assert from "node:assert/strict";
import test from "node:test";
import { OpenAiProvider } from "@/lib/ai/provider";
import { AI_ANALYSIS_JSON_SCHEMA } from "@/lib/ai/schema";

const metrics = [
  "NET_SALES", "GROSS_SALES", "REFUNDS", "TRANSACTIONS", "AVERAGE_TRANSACTION", "PREVIOUS_NET_SALES",
  "PAYMENTS_COLLECTED", "PAYMENTS_CASH", "PAYMENTS_CARD", "PAYMENTS_DUITNOW", "PAYMENTS_BANK_TRANSFER",
  "RECORDED_BUSINESS_SPENDING", "MANUAL_SPENDING", "CLAIM_SPENDING", "INCOME_VS_RECORDED_SPENDING",
  "TRACKED_PRODUCTS", "LOW_STOCK_COUNT", "OUT_OF_STOCK_COUNT", "INVENTORY_SELLING_VALUE",
  "APPOINTMENTS_TOTAL", "APPOINTMENTS_SCHEDULED", "APPOINTMENTS_COMPLETED", "APPOINTMENTS_CANCELLED", "APPOINTMENTS_NO_SHOW",
];
const intents = ["SALES", "PAYMENTS", "EXPENSES", "INVENTORY", "APPOINTMENTS", "GENERAL_BUSINESS", "UNSUPPORTED"];
const forbidden = /\b(?:supplier(?:[ _-]+bills?|[ _-]+payments?)?|inventory[ _-]+purchase[ _-]+spending|purchasing|purchase[ _-]+orders?|receiving|accounts[ _-]+payable|payroll(?:[ _-]+spending)?|pcb|salary|compensation|statutory|ap|po|outstanding[ _-]+ap|ap[ _-]+(?:due[ _-]+soon|overdue|open[ _-]+bills))\b/i;
const context = {
  version: "owner-pilot/1", scope: { type: "BUSINESS", name: "Synthetic business" },
  metrics: [{ metricKey: "NET_SALES", value: "600.00", available: true }],
  coverage: [{ domain: "REPORTS", available: true }], limitations: [],
};
const answer = { intent: "SALES", language: "en", temporalSemantics: "PERIOD", summary: "Sales are RM600.", evidence: [], caveats: [], recommendations: [], followUpQuestions: [] };
type Request = { instructions: string; input: unknown; tools: unknown[]; text: { format: { schema: typeof AI_ANALYSIS_JSON_SCHEMA } } };

function capture(output: unknown = answer) {
  const requests: Request[] = [];
  const client = { responses: { create: async (request: Request) => {
    requests.push(request);
    return { output_text: JSON.stringify(output), model: "synthetic-returned-model", _request_id: "req_capture", usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } };
  } } };
  return { requests, provider: new OpenAiProvider({ apiKey: "unused-synthetic-key", model: "gpt-5.4-mini" }, client as never) };
}

// Break caught: shared instructions/enum accidentally sent at the real SDK request boundary.
for (const question of ["How are sales this month?", "Payments by method?", "Operating expenses?", "Low stock?", "Appointments in the last 7 days?"]) {
  test(`Pilot final SDK payload contains only allowed domain names: ${question}`, async () => {
    const f = capture();
    await f.provider.analyze({ question, context, recentMessages: [{ role: "USER", content: "Sales?" }, { role: "ASSISTANT", content: "Sales are RM600." }] });
    assert.equal(f.requests.length, 1);
    const request = f.requests[0];
    assert.doesNotMatch(JSON.stringify(request), forbidden);
    assert.deepEqual([...request.text.format.schema.properties.evidence.items.properties.metricKey.enum].sort(), [...metrics].sort());
    assert.deepEqual([...request.text.format.schema.properties.intent.enum].sort(), [...intents].sort());
    assert.deepEqual(request.tools, []);
    assert.match(request.instructions, /operating expenses/i);
    assert.match(request.instructions, /not.*accounting profit/i);
    assert.match(request.instructions, /never as authority/i);
  });
}

// Routing hints are static provider instructions, not user-provided capabilities.
for (const intent of ["SUPPLIER_BILLS", "PEOPLE"] as const) {
  test(`Pilot routing hint narrows unsupported intent ${intent} without exposing its name`, async () => {
    const f = capture({ ...answer, intent: "UNSUPPORTED" });
    await f.provider.analyze({ question: "What can you help with?", intent, context, recentMessages: [] });
    assert.match(f.requests[0].instructions, /Intent: UNSUPPORTED/);
    assert.doesNotMatch(JSON.stringify(f.requests[0]), forbidden);
    assert.doesNotMatch(f.requests[0].instructions, /Intent: PEOPLE/);
  });
}

// Even a non-conforming response cannot become a valid Pilot analysis.
for (const metricKey of ["PAYROLL_SPENDING", "INVENTORY_PURCHASE_SPENDING", "OUTSTANDING_AP", "AP_DUE_SOON", "AP_OVERDUE", "AP_OPEN_BILLS", "ACTIVE_EMPLOYEES", "INACTIVE_EMPLOYEES"]) {
  test(`Pilot rejects out-of-scope evidence ${metricKey}`, async () => {
    const f = capture({ ...answer, evidence: [{ metricKey, label: "Unapproved", value: "1", comparison: null, scope: "Current", period: "Selected" }] });
    await assert.rejects(f.provider.analyze({ question: "Sales?", context, recentMessages: [] }));
    assert.equal(f.requests.length, 1);
  });
}

test("non-Pilot provider preserves shared prompt/schema and valid legacy evidence", async () => {
  const f = capture({ ...answer, intent: "SUPPLIER_BILLS", evidence: [{ metricKey: "OUTSTANDING_AP", label: "Outstanding", value: "1", comparison: null, scope: "Current", period: "Selected" }] });
  const result = await f.provider.analyze({ question: "Supplier bills?", context: { metrics: [] }, recentMessages: [] });
  assert.equal(f.requests[0].text.format.schema, AI_ANALYSIS_JSON_SCHEMA);
  assert.match(f.requests[0].instructions, /Confirmed Supplier Bill/);
  assert.equal(result.analysis.evidence[0].metricKey, "OUTSTANDING_AP");
});

test("deny audit recognises case and human/snake-case variants without matching appointments", () => {
  for (const name of ["PAYROLL_SPENDING", "payroll spending", "Payroll", "Supplier Bill", "supplier_bills", "Inventory Purchase Spending", "inventory_purchase_spending", "OUTSTANDING_AP", "Accounts Payable", "purchase_order", "Receiving", "Supplier Payment", "AP", "PO", "PCB", "Salary", "Compensation", "Statutory"]) assert.match(name, forbidden);
  assert.doesNotMatch("Appointments SNAPSHOT Payments operating expenses", forbidden);
});
