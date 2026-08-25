import { createHash } from "node:crypto";
import { PCB_2026_CALCULATOR_VERSION, PCB_2026_RULE_VERSION } from "./pcb-2026";

export const PCB_RUNTIME_ENVIRONMENTS = ["LOCAL", "TESTING", "PRODUCTION"] as const;
export type PcbRuntimeEnvironment = (typeof PCB_RUNTIME_ENVIRONMENTS)[number];

export const PCB_READINESS_LEVELS = [
  "ENGINEERING_TEST_ONLY",
  "READY_FOR_INTERNAL_UAT",
  "READY_FOR_HASIL_VERIFICATION",
  "HASIL_VERIFIED",
  "ACTIVE_FOR_PRODUCTION",
] as const;
export type PcbReadinessLevel = (typeof PCB_READINESS_LEVELS)[number];

export type PcbGovernedRule = {
  version: string;
  effectiveFrom: Date;
  status?: string | null;
  sourceDigest?: string | null;
  datasetDigest?: string | null;
  classificationVersion?: string | null;
  classificationDigest?: string | null;
  calculatorVersion?: string | null;
  verificationEvidence?: unknown;
};

export function currentPcbRuntimeEnvironment(): PcbRuntimeEnvironment {
  const configured = process.env.TETAMU_PAYROLL_ENVIRONMENT?.trim().toUpperCase();
  if (configured === "LOCAL" || configured === "TESTING" || configured === "PRODUCTION") {
    return configured;
  }
  return process.env.NODE_ENV === "production" ? "PRODUCTION" : "LOCAL";
}

export function resolvePcbReadiness(rule: PcbGovernedRule): PcbReadinessLevel {
  const evidence = recordValue(rule.verificationEvidence);
  const hasil = recordValue(evidence?.hasilSoftwareVerification);
  const verified = hasil?.status === "APPROVED";
  const productionEnabled = verified && rule.status === "ACTIVE";
  if (verified && productionEnabled) return "ACTIVE_FOR_PRODUCTION";
  if (verified) return "HASIL_VERIFIED";
  if (rule.calculatorVersion === PCB_2026_CALCULATOR_VERSION && rule.classificationDigest) {
    return "READY_FOR_HASIL_VERIFICATION";
  }
  if (rule.calculatorVersion === PCB_2026_CALCULATOR_VERSION) {
    return "READY_FOR_INTERNAL_UAT";
  }
  return "ENGINEERING_TEST_ONLY";
}

export function buildPcbGovernanceBinding(rule: PcbGovernedRule) {
  const binding = {
    taxYear: 2026,
    officialRuleVersion: PCB_2026_RULE_VERSION,
    calculatorVersion: PCB_2026_CALCULATOR_VERSION,
    ruleSetVersion: rule.version,
    ruleSetCalculatorVersion: rule.calculatorVersion ?? null,
    officialSourceDigest: rule.sourceDigest ?? null,
    datasetDigest: rule.datasetDigest ?? null,
    classificationVersion: rule.classificationVersion ?? null,
    classificationDigest: rule.classificationDigest ?? null,
    effectiveFrom: rule.effectiveFrom.toISOString().slice(0, 10),
    readiness: resolvePcbReadiness(rule),
    environment: currentPcbRuntimeEnvironment(),
  } as const;
  return {
    ...binding,
    bindingDigest: sha256(binding),
  };
}

export function assertPcbRuleCanCalculate(rule: PcbGovernedRule) {
  if (rule.calculatorVersion !== PCB_2026_CALCULATOR_VERSION) {
    throw new Error("PCB_CALCULATOR_RULESET_VERSION_MISMATCH");
  }
  if (!rule.sourceDigest || !rule.datasetDigest || !rule.classificationDigest) {
    throw new Error("PCB_RULESET_GOVERNANCE_LINK_INCOMPLETE");
  }
  const readiness = resolvePcbReadiness(rule);
  if (
    currentPcbRuntimeEnvironment() === "PRODUCTION" &&
    readiness !== "ACTIVE_FOR_PRODUCTION"
  ) {
    throw new Error("PCB_RULE_NOT_APPROVED_FOR_PRODUCTION");
  }
  return buildPcbGovernanceBinding(rule);
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function sha256(value: unknown) {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
