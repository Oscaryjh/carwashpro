import { createHash } from "node:crypto";

export const MANUAL_PCB_INPUT_VERSION = 1;

export function parseManualPcbConfirmation(input: { amount: unknown; externalReference: unknown; confirmed: unknown }) {
  const amount = typeof input.amount === "string" ? input.amount.trim() : "";
  const externalReference = typeof input.externalReference === "string" ? input.externalReference.trim() : "";
  if (input.confirmed !== true || !/^\d{1,10}(\.\d{1,2})?$/.test(amount) || externalReference.length < 5 || externalReference.length > 500) {
    throw new Error("PCB_MANUAL_AMOUNT_CONFIRMATION_AND_EVIDENCE_REQUIRED");
  }
  const [whole, fraction = ""] = amount.split(".");
  return { amountCents: Number(whole) * 100 + Number(fraction.padEnd(2, "0")), externalReference };
}

function canonical(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonical);
  return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
}

export function manualPcbDigest(input: unknown) {
  return createHash("sha256").update(JSON.stringify({ version: MANUAL_PCB_INPUT_VERSION, input: canonical(input) })).digest("hex");
}

export type ManualPcbBinding = {
  businessId: string;
  membershipId: string;
  payrollEntryId: string;
  payrollMonth: string;
  inputRevision: number;
  inputDigest: string;
};

export function isManualPcbCurrent(source: (ManualPcbBinding & {
  amount: { toString(): string } | string;
  externalReference: string;
  confirmedById: string;
  confirmedAt: Date;
  inputVersion: number;
  invalidations: unknown[];
}) | null, current: ManualPcbBinding): boolean {
  if (!source || source.inputVersion !== MANUAL_PCB_INPUT_VERSION || source.invalidations.length || !source.confirmedById || !Number.isFinite(source.confirmedAt.getTime())) return false;
  try { parseManualPcbConfirmation({ amount: source.amount.toString(), externalReference: source.externalReference, confirmed: true }); } catch { return false; }
  return (Object.keys(current) as (keyof ManualPcbBinding)[]).every((key) => source[key] === current[key]);
}
