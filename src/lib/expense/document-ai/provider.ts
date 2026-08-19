import { getExpenseDocumentAiConfiguration } from "./config";
import type { ExpenseDocumentExtraction } from "./schema";
import { MockExpenseDocumentProvider } from "./providers/mock";
import { OpenAiExpenseDocumentProvider } from "./providers/openai";

export type ExpenseDocumentProviderInput = Readonly<{
  bytes: Buffer;
  mimeType: string;
  fileName: string;
}>;

export type ExpenseDocumentProviderResult = Readonly<{
  extraction: ExpenseDocumentExtraction;
  provider: string;
  model: string;
  providerRequestId: string | null;
}>;

export interface ExpenseDocumentProvider {
  readonly name: string;
  extract(input: ExpenseDocumentProviderInput): Promise<ExpenseDocumentProviderResult>;
}

export function createExpenseDocumentProvider(env: NodeJS.ProcessEnv = process.env): ExpenseDocumentProvider {
  const config = getExpenseDocumentAiConfiguration(env);
  if (config.provider === "openai") {
    return new OpenAiExpenseDocumentProvider({ apiKey: env.OPENAI_API_KEY!, model: config.model, maxOutputTokens: config.maxOutputTokens });
  }
  return new MockExpenseDocumentProvider();
}

export { MockExpenseDocumentProvider } from "./providers/mock";
export { OpenAiExpenseDocumentProvider } from "./providers/openai";
