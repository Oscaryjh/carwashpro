import { z } from "zod";
import type { AiIntent } from "./intent";
import { AI_ANALYSIS_JSON_SCHEMA, aiAnalysisSchema, aiEvidenceSchema } from "./schema";

// Positive capability vocabulary for the server-produced Owner Pilot context.
// Shared/non-Pilot schemas retain their own independent contracts.
export const PILOT_ALLOWED_METRIC_KEYS = [
  "NET_SALES", "GROSS_SALES", "REFUNDS", "TRANSACTIONS", "AVERAGE_TRANSACTION", "PREVIOUS_NET_SALES",
  "PAYMENTS_COLLECTED", "PAYMENTS_CASH", "PAYMENTS_CARD", "PAYMENTS_DUITNOW", "PAYMENTS_BANK_TRANSFER",
  "RECORDED_BUSINESS_SPENDING", "MANUAL_SPENDING", "CLAIM_SPENDING", "INCOME_VS_RECORDED_SPENDING",
  "TRACKED_PRODUCTS", "LOW_STOCK_COUNT", "OUT_OF_STOCK_COUNT", "INVENTORY_SELLING_VALUE",
  "APPOINTMENTS_TOTAL", "APPOINTMENTS_SCHEDULED", "APPOINTMENTS_COMPLETED", "APPOINTMENTS_CANCELLED", "APPOINTMENTS_NO_SHOW",
] as const;

export const PILOT_ALLOWED_INTENTS = [
  "SALES", "PAYMENTS", "EXPENSES", "INVENTORY", "APPOINTMENTS", "GENERAL_BUSINESS", "UNSUPPORTED",
] as const;

export function isOwnerPilotContext(context: unknown) {
  return Boolean(context && typeof context === "object" && "version" in context && context.version === "owner-pilot/1");
}

export function pilotProviderIntent(intent: AiIntent): AiIntent {
  return (PILOT_ALLOWED_INTENTS as readonly string[]).includes(intent) ? intent : "UNSUPPORTED";
}

// Reuse only structural fields, replacing every domain enum positively.
// This is a provider response schema, not a database schema.
export const PILOT_AI_ANALYSIS_JSON_SCHEMA = {
  ...AI_ANALYSIS_JSON_SCHEMA,
  properties: {
    ...AI_ANALYSIS_JSON_SCHEMA.properties,
    intent: { type: "string", enum: PILOT_ALLOWED_INTENTS },
    evidence: {
      ...AI_ANALYSIS_JSON_SCHEMA.properties.evidence,
      items: {
        ...AI_ANALYSIS_JSON_SCHEMA.properties.evidence.items,
        properties: {
          ...AI_ANALYSIS_JSON_SCHEMA.properties.evidence.items.properties,
          metricKey: { type: "string", enum: PILOT_ALLOWED_METRIC_KEYS },
        },
      },
    },
  },
} as const;

const pilotAnalysisSchema = aiAnalysisSchema.extend({
  intent: z.enum(PILOT_ALLOWED_INTENTS),
  evidence: z.array(aiEvidenceSchema.extend({ metricKey: z.enum(PILOT_ALLOWED_METRIC_KEYS) })).max(12),
});

export function validatePilotAiAnalysis(value: unknown) {
  return pilotAnalysisSchema.parse(value);
}
