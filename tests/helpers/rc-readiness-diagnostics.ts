import type { PayrollReadinessCode } from "../../src/lib/payroll/readiness";
import { getPayrollPeriodReadiness } from "../../src/lib/payroll/readiness";
import { submitPayrollRunForReview as submit } from "../../src/lib/payroll/service";
import { prisma } from "../../src/lib/prisma";

export function readinessDiagnostic(input: { blockers: ReadonlyArray<{ code: PayrollReadinessCode }> }) {
  const codes: Partial<Record<PayrollReadinessCode, number>> = {};
  for (const issue of input.blockers) codes[issue.code] = (codes[issue.code] ?? 0) + 1;
  return { blockerCount: input.blockers.length, codes };
}

export async function diagnoseRun(businessId: string, runId: string, database = prisma) {
  const run = await database.payrollRun.findFirst({ where: { businessId, id: runId }, select: { periodStart: true } });
  if (!run) return;
  const readiness = await getPayrollPeriodReadiness({ businessId, runId, month: run.periodStart.toISOString().slice(0, 7) }, database);
  console.info(`RC_READINESS ${JSON.stringify(readinessDiagnostic(readiness))}`);
}

// Test-only observation; the real service and its refusal remain unchanged.
export async function submitPayrollRunForReview(...args: Parameters<typeof submit>) {
  try { return await submit(...args); }
  catch (error) {
    await diagnoseRun(args[0].businessId, args[0].runId, args[1] ?? prisma);
    throw error;
  }
}
