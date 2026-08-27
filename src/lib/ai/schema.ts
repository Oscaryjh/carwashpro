import { z } from "zod";
import { AI_INTENTS } from "./intent";

export const AI_PROMPT_VERSION = "business-assistant/1.1.0";
export const AI_CONTEXT_VERSION = "business-performance/1.1.0";

export const allowedMetricKeys = [
  "NET_SALES",
  "PAYMENTS_COLLECTED",
  "GROSS_SALES",
  "REFUNDS",
  "TRANSACTIONS",
  "AVERAGE_TRANSACTION",
  "PREVIOUS_NET_SALES",
  "RECORDED_BUSINESS_SPENDING",
  "INCOME_VS_RECORDED_SPENDING",
  "MANUAL_SPENDING",
  "CLAIM_SPENDING",
  "PAYROLL_SPENDING",
  "INVENTORY_PURCHASE_SPENDING",
  "LOW_STOCK_COUNT",
  "OUT_OF_STOCK_COUNT",
  "TRACKED_PRODUCTS",
  "INVENTORY_SELLING_VALUE",
  "OUTSTANDING_AP",
  "AP_DUE_SOON",
  "AP_OVERDUE",
  "AP_OPEN_BILLS",
  "ACTIVE_EMPLOYEES",
  "INACTIVE_EMPLOYEES",
  "APPOINTMENTS_TOTAL",
  "APPOINTMENTS_SCHEDULED",
  "APPOINTMENTS_COMPLETED",
  "APPOINTMENTS_CANCELLED",
  "APPOINTMENTS_NO_SHOW",
  "PAYMENTS_CASH",
  "PAYMENTS_CARD",
  "PAYMENTS_DUITNOW",
  "PAYMENTS_BANK_TRANSFER",
] as const;

export type AllowedAiMetricKey = (typeof allowedMetricKeys)[number];
export const allowedMetricKeySet = new Set<string>(allowedMetricKeys);

export const aiEvidenceSchema = z.object({
  metricKey: z.enum(allowedMetricKeys),
  label: z.string().min(1).max(80),
  value: z.string().min(1).max(120),
  comparison: z.string().max(200).nullable(),
  scope: z.string().min(1).max(120),
  period: z.string().min(1).max(80),
});

export const aiAnalysisSchema = z.object({
  intent: z.enum(AI_INTENTS),
  language: z.enum(["en", "zh"]),
  temporalSemantics: z.enum(["PERIOD", "SNAPSHOT"]),
  summary: z.string().min(1).max(4000),
  evidence: z.array(aiEvidenceSchema).max(12),
  caveats: z.array(z.string().min(1).max(600)).max(10),
  recommendations: z.array(z.string().min(1).max(600)).max(10),
  followUpQuestions: z.array(z.string().min(1).max(240)).max(6),
});

export type AiAnalysis = z.infer<typeof aiAnalysisSchema>;

export const AI_ANALYSIS_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["intent", "language", "temporalSemantics", "summary", "evidence", "caveats", "recommendations", "followUpQuestions"],
  properties: {
    intent: { type: "string", enum: AI_INTENTS },
    language: { type: "string", enum: ["en", "zh"] },
    temporalSemantics: { type: "string", enum: ["PERIOD", "SNAPSHOT"] },
    summary: { type: "string" },
    evidence: {
      type: "array",
      maxItems: 12,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["metricKey", "label", "value", "comparison", "scope", "period"],
        properties: {
          metricKey: { type: "string", enum: allowedMetricKeys },
          label: { type: "string" },
          value: { type: "string" },
          comparison: { type: ["string", "null"] },
          scope: { type: "string" },
          period: { type: "string" },
        },
      },
    },
    caveats: { type: "array", maxItems: 10, items: { type: "string" } },
    recommendations: { type: "array", maxItems: 10, items: { type: "string" } },
    followUpQuestions: { type: "array", maxItems: 6, items: { type: "string" } },
  },
} as const;

export function validateAiAnalysis(value: unknown) {
  const parsed = aiAnalysisSchema.parse(value);
  if (parsed.evidence.some((item) => !allowedMetricKeySet.has(item.metricKey))) {
    throw new Error("AI_RESPONSE_UNSUPPORTED_EVIDENCE");
  }
  return parsed;
}
