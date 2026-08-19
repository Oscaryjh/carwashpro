import { runtimeEnvironment } from "@/lib/release/environment";

export function getExpenseDocumentAiConfiguration(env: NodeJS.ProcessEnv = process.env) {
  const enabled = env.EXPENSE_RECEIPT_AUTOFILL_ENABLED === "true" && env.EXPENSE_DOCUMENT_AI_ENABLED === "true";
  const environment = runtimeEnvironment(env);
  const provider = (env.EXPENSE_DOCUMENT_AI_PROVIDER ?? "mock").trim().toLowerCase();
  if (!new Set(["mock", "openai"]).has(provider)) throw new Error("EXPENSE_DOCUMENT_AI_PROVIDER_INVALID");
  if (environment === "production") return { enabled: false, environment, provider: provider as "mock" | "openai", model: "disabled", maxOutputTokens: 1200 };
  if (provider === "openai" && !env.OPENAI_API_KEY) throw new Error("EXPENSE_DOCUMENT_AI_PROVIDER_UNAVAILABLE");
  return {
    enabled,
    environment,
    provider: provider as "mock" | "openai",
    model: env.EXPENSE_DOCUMENT_AI_MODEL?.trim() || env.OPENAI_MODEL?.trim() || "gpt-5.4-mini",
    maxOutputTokens: boundedInt(env.EXPENSE_DOCUMENT_AI_MAX_OUTPUT_TOKENS, 1200, 256, 4096),
  };
}
function boundedInt(value: string | undefined, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}
