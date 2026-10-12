import assert from "node:assert/strict";
import test from "node:test";
import { OpenAiProvider, MockAiProvider } from "@/lib/ai/provider";

const input = { question: "How are sales this month?", context: { metrics: [] }, recentMessages: [] };
const analysis = { intent: "SALES", language: "en", temporalSemantics: "PERIOD", summary: "No sales data available.", evidence: [], caveats: [], recommendations: [], followUpQuestions: [] };

// Break caught: a nonzero SDK retry setting sends another outbound attempt on transient failure.
for (const failure of ["429", "503", "network", "timeout"] as const) {
  test(`real SDK makes one outbound attempt on ${failure}, with the existing timeout`, async () => {
    const original = globalThis.fetch;
    let attempts = 0;
    globalThis.fetch = async () => {
      attempts++;
      if (failure === "network") throw new TypeError("synthetic network failure");
      if (failure === "timeout") throw Object.assign(new Error("synthetic timeout"), { name: "TimeoutError" });
      return new Response(JSON.stringify({ error: { message: "synthetic failure", type: "server_error" } }), {
        status: Number(failure), headers: { "content-type": "application/json", "retry-after": "0" },
      });
    };
    try {
      const provider = new OpenAiProvider({ apiKey: "synthetic-unused-key", model: "gpt-5.4-mini" });
      const sdk = (provider as unknown as { client: { timeout: number; maxRetries: number } }).client;
      assert.equal(sdk.timeout, 30_000);
      await assert.rejects(provider.analyze(input));
      assert.equal(attempts, 1);
      assert.equal(sdk.maxRetries, 0);
    } finally { globalThis.fetch = original; }
  });
}

// Break caught: configured alias is incorrectly presented as the provider-returned model.
for (const returned of ["gpt-5.4-mini-2026-03-17", undefined, null, "", "   "] as const) {
  test(`model telemetry uses response model only: ${String(returned)}`, async () => {
    let attempts = 0;
    const client = { responses: { create: async () => {
      attempts++;
      return { output_text: JSON.stringify(analysis), model: returned, _request_id: "req_synthetic_1", usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 } };
    } } };
    const provider = new OpenAiProvider({ apiKey: "synthetic-unused-key", model: "gpt-5.4-mini" }, client as never);
    const result = await provider.analyze(input);
    assert.equal(result.model, "gpt-5.4-mini"); // legacy/requested model remains compatible
    assert.equal(result.actualModel, returned === "gpt-5.4-mini-2026-03-17" ? "gpt-5.4-mini-2026-03-17" : null);
    assert.equal(result.providerRequestId, "req_synthetic_1");
    assert.deepEqual(result.usage, { inputTokens: 10, outputTokens: 5, totalTokens: 15 });
    assert.equal(attempts, 1);
  });
}

test("mock never claims a provider-returned actual model", async () => {
  const result = await new MockAiProvider("synthetic-mock").analyze(input);
  assert.equal(result.model, "synthetic-mock");
  assert.equal(result.actualModel, null);
});
