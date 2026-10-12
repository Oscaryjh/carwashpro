import { createHash } from "node:crypto";
import { getBusinessDayRange, getCurrentBusinessDateValue } from "@/lib/business-day";
import { addDaysToDateValue, isValidDateValue, startOfBusinessMonth } from "@/lib/business-time";
import type { PilotGrant } from "./pilot-access";
import { PILOT_ALLOWED_METRIC_KEYS } from "./pilot-schema";

export const PILOT_HISTORY_PLACEHOLDER = "此旧回答无法在当前权限下重新显示";
export const PILOT_METRIC_KEYS = new Set<string>(PILOT_ALLOWED_METRIC_KEYS);

export function pilotPeriod(input: { range?: string; from?: string; to?: string; now: Date; timezone: string; businessDayCutoffTime: string }) {
  const range = input.range ?? "month";
  if (!["today", "7days", "month", "custom"].includes(range)) throw new Error("AI_DATE_RANGE_INVALID");
  const today = getCurrentBusinessDateValue(input.now, input.timezone, input.businessDayCutoffTime);
  const from = range === "custom" ? input.from : range === "7days" ? addDaysToDateValue(today, -6) : range === "month" ? startOfBusinessMonth(today) : today;
  const to = range === "custom" ? input.to : today;
  if (!from || !to || !isValidDateValue(from) || !isValidDateValue(to)) throw new Error("AI_DATE_RANGE_INVALID");
  const days = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
  if (days < 1) throw new Error("AI_DATE_RANGE_INVALID");
  if (days > 90) throw new Error("AI_DATE_RANGE_TOO_LARGE");
  // Reuse canonical timezone/cutoff conversion without changing the global
  // Reports 31-day rule. Only the AI query window allows up to 90 days.
  const first = getBusinessDayRange({ ...input, fromDateValue: from, toDateValue: from });
  const last = getBusinessDayRange({ ...input, fromDateValue: to, toDateValue: to });
  return { range, from, to, timezone: input.timezone, businessDayCutoffTime: input.businessDayCutoffTime, fromDate: first.fromDate, toDateExclusive: last.toDateExclusive };
}

export type PilotProvenance = { version: "owner-pilot/1"; businessId: string; grants: PilotGrant[] };
export function pilotProvenance(businessId: string, grants: PilotGrant[]): PilotProvenance {
  return { version: "owner-pilot/1", businessId, grants };
}

/** Provenance is written only by the server after the allowlisted read. Legacy
 * records stay intact in storage; unprovable content never reaches UI/provider. */
export function isPilotHistoryVisible(metadata: unknown, businessId: string, current: PilotGrant[]) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return false;
  const data = metadata as Record<string, unknown>;
  const proof = data.ownerPilot as PilotProvenance | undefined;
  if (!proof || proof.version !== "owner-pilot/1" || proof.businessId !== businessId || !Array.isArray(proof.grants)) return false;
  if (!proof.grants.every(saved => {
    if (!saved || !Array.isArray(saved.branchIds) || typeof saved.allBranches !== "boolean" || typeof saved.includeBusinessWide !== "boolean") return false;
    const fresh = current.find(grant => grant.domain === saved.domain);
    return fresh && (!saved.allBranches || fresh.allBranches) && (!saved.includeBusinessWide || fresh.includeBusinessWide) &&
      (fresh.allBranches || saved.branchIds.every(id => fresh.branchIds.includes(id)));
  })) return false;
  if (Array.isArray(data.sourceDomains) && data.sourceDomains.some(domain => !proof.grants.some(grant => grant.domain === domain))) return false;
  if (Array.isArray(data.evidence) && data.evidence.some(item => !item || typeof item !== "object" || !PILOT_METRIC_KEYS.has(String((item as { metricKey?: unknown }).metricKey)))) return false;
  return true;
}

export function pilotDigest<T>(payload: T) {
  const json = JSON.stringify(payload);
  return { payload, digest: createHash("sha256").update(json).digest("hex"), approximateInputTokens: Math.ceil(json.length / 4) };
}
