import { z } from "zod";
import { cents, validateShares } from "./money";

const requestSchema = z.object({
  version: z.literal(1),
  sales: z.array(z.object({ membershipId: z.string().uuid(), basisPoints: z.number().int().positive().max(10_000) })).max(50).optional(),
  tipMembershipId: z.string().uuid().nullable().optional(),
  unassignedReason: z.string().trim().min(5).max(500).optional(),
}).strict();
export type PerformanceInput = z.infer<typeof requestSchema>;
export function performanceEnabled() { return process.env.TETAMU_PERFORMANCE_PHASE1 === "true"; }

export function parseCheckoutTipCents(form: FormData) {
  if (!performanceEnabled()) return 0;
  const raw = form.get("performanceTipAmount");
  if (raw == null || raw === "") return 0;
  if (typeof raw !== "string" || !/^\d{1,7}(\.\d{1,2})?$/.test(raw)) throw new Error("Tip must be a non-negative amount with at most two decimals.");
  return cents(raw);
}

/** Missing v1 field is an explicit legacy-client compatibility case, never cashier attribution. */
export function parsePerformanceInput(form: FormData): PerformanceInput | null {
  if (!performanceEnabled()) return null;
  const raw = form.get("performanceAttribution");
  if (raw == null || raw === "") return null;
  if (typeof raw !== "string" || raw.length > 12_000) throw new Error("Invalid performance allocation.");
  const result = requestSchema.parse(JSON.parse(raw));
  validateShares(result.sales ?? []);
  return result;
}

export function performanceFingerprint(form: FormData) {
  const input = parsePerformanceInput(form);
  return input ? { performance: input } : {};
}
