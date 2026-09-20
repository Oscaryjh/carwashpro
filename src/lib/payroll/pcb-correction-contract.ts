import type { PayrollDocumentEntry } from "./export";
export function correctedFrozenNetPay(entry: PayrollDocumentEntry, correctedPcb: number) {
  const money = (value: number | undefined) => Math.round((value ?? 0) * 100);
  const deductions = [entry.otherDeductions, entry.epfEmployee, entry.socsoEmployee, entry.eisEmployee,
    entry.lindung24Employee, correctedPcb, entry.cp38].reduce<number>((sum, value) => sum + money(value), 0);
  const reimbursements = (entry.claimReimbursements ?? []).reduce((sum, row) => sum + money(row.amount), 0);
  const priorRefunds = (entry.components ?? []).filter((row) => row.sourceType === "PRIOR_PERIOD_PCB" && row.type === "EARNING")
    .reduce((sum, row) => sum + money(row.amount), 0);
  return Math.max(0, money(entry.grossPay) - deductions + reimbursements + priorRefunds) / 100;
}
function cents(value: number) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("PCB_AMOUNT_INVALID");
}
export function correctionAmounts(previousCents: number, correctedCents: number) {
  cents(previousCents); cents(correctedCents);
  return { amountCents: correctedCents, deltaCents: correctedCents - previousCents };
}
export function latestPcbAmounts(versions: ReadonlyArray<{ entryKey: string; version: number; amountCents: number }>) {
  const latest = new Map<string, { version: number; amountCents: number }>();
  const seen = new Set<string>();
  for (const item of versions) {
    cents(item.amountCents);
    if (!Number.isSafeInteger(item.version) || item.version < 1 || seen.has(`${item.entryKey}:${item.version}`)) throw new Error("PCB_VERSION_CONFLICT");
    seen.add(`${item.entryKey}:${item.version}`);
    if ((latest.get(item.entryKey)?.version ?? 0) < item.version) latest.set(item.entryKey, item);
  }
  return [...latest.values()].reduce((sum, item) => sum + item.amountCents, 0);
}
export function correctionSettlementState(input: { activeEmployee: boolean; hasNextRun: boolean; applied: boolean }) {
  if (input.applied) return "APPLIED_TO_PAYROLL_NOT_PAYMENT" as const;
  return input.activeEmployee && input.hasNextRun ? "PENDING_NEXT_OPEN_RUN" as const : "UNSETTLED" as const;
}
