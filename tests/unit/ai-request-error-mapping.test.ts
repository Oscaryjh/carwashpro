import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { createRequire } from "node:module";

test("AI route distinguishes conflict, pending, limit, unconfigured, Pilot denial and provider failure", async () => {
  const result = await build({ entryPoints: ["src/app/api/ai/analyze/route.ts"], bundle: true, write: false, platform: "node", format: "cjs", packages: "external", plugins: [{ name: "route-boundaries", setup(b) {
    b.onResolve({ filter: /@\/lib\/(auth\/session|tenant|ai\/service|ai\/pilot-access)$/ }, a => ({ path: a.path, namespace: "fake" }));
    b.onLoad({ filter: /.*/, namespace: "fake" }, a => ({ contents: a.path.endsWith("session") ? "export async function requireUser(){return {activeBusinessId:'business'}}" : a.path.endsWith("tenant") ? "export async function requireBusinessContext(){return {businessId:'business',user:{},access:{}}}" : a.path.endsWith("pilot-access") ? "export const PILOT_OWNER_NOTICE='Business Owners only'; export const PILOT_GROUP_NOTICE='individual businesses only';" : "export class AiServiceError extends Error {constructor(code){super(code);this.code=code}}; export async function askTetamuAi(){throw new AiServiceError(globalThis.__aiRouteTestCode)}" }));
  } }] });
  const compiled = { exports: {} as { POST: (request: Request) => Promise<Response> } };
  new Function("require", "module", "exports", result.outputFiles[0].text)(createRequire(import.meta.url), compiled, compiled.exports);
  try {
    for (const [code, status, copy] of [
      ["AI_REQUEST_CONFLICT", 409, /different request|conflict/i], ["AI_REQUEST_PENDING", 409, /processing|progress/i],
      ["AI_REQUEST_FAILED", 422, /failed/i], ["AI_QUOTA_EXCEEDED", 429, /limit/i],
      ["AI_QUOTA_NOT_CONFIGURED", 403, /usage.*configured/i], ["AI_PILOT_OWNER_ONLY_DENIED", 403, /Owners only/],
      ["AI_PROVIDER_TEMPORARILY_UNAVAILABLE", 503, /temporarily unavailable/i],
    ] as const) {
      Reflect.set(globalThis, "__aiRouteTestCode", code);
      const response = await compiled.exports.POST(new Request("http://local/api/ai/analyze", { method: "POST", body: JSON.stringify({ scopeType: "BUSINESS", question: "Sales", clientRequestId: "00000000-0000-4000-8000-000000000001" }) }));
      assert.equal(response.status, status, code); const payload = await response.json(); assert.equal(payload.error, code); assert.match(payload.message, copy);
    }
  } finally { Reflect.deleteProperty(globalThis, "__aiRouteTestCode"); }
});
