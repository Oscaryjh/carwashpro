import type {
  EmployeePayBasis,
  EmployeeRecurringPayComponentType,
  PayrollEntryComponentOrigin,
  PayrollEntryComponentSourceType,
  PayrollEntryComponentType,
} from "@prisma/client";

export const PAYROLL_COMPONENT_RECONCILIATION_FAILED =
  "PAYROLL_COMPONENT_RECONCILIATION_FAILED";

export type PayrollComponentLine = {
  lineKey: string;
  type: PayrollEntryComponentType;
  code: string;
  name: string;
  amountCents: number;
  currency: "MYR";
  sourceType: PayrollEntryComponentSourceType;
  sourceId: string | null;
  sourceVersionId: string | null;
  sourceRevision: number | null;
  effectiveFromMonth: Date | null;
  calculationBasis: string;
  origin: PayrollEntryComponentOrigin;
  reason: string | null;
  sourceReason?: string | null;
  sortOrder: number;
};

export type FrozenSystemComponentInput = {
  compensation: {
    versionId: string;
    effectiveFromMonth: Date;
    payBasis: EmployeePayBasis;
  };
  amounts: {
    basicPayCents: number;
    leavePayCents: number;
    overtimePayCents: number;
    publicHolidayPayCents: number;
  };
  recurring: ReadonlyArray<{
    componentId: string;
    versionId: string;
    revision: number;
    type: EmployeeRecurringPayComponentType;
    code: string;
    name: string;
    amountCents: number;
    effectiveFromMonth: Date;
  }>;
};

export type PayrollComponentAggregates = {
  grossPayCents: number;
  nonStatutoryDeductionsCents: number;
  allowancesCents: number;
  recurringAllowancesCents: number;
  recurringDeductionsCents: number;
  netPayCents: number;
};

export function buildSystemPayrollEntryComponents(
  input: FrozenSystemComponentInput,
): PayrollComponentLine[] {
  const lines: PayrollComponentLine[] = [];
  addPositiveLine(lines, {
    lineKey: "SYSTEM:BASIC_SALARY",
    type: "EARNING",
    code: "BASIC_SALARY",
    name: "Basic Salary",
    amountCents: input.amounts.basicPayCents,
    sourceType: "BASIC_SALARY",
    sourceId: null,
    sourceVersionId: input.compensation.versionId,
    sourceRevision: null,
    effectiveFromMonth: input.compensation.effectiveFromMonth,
    calculationBasis: `${input.compensation.payBasis}_CURRENT_POLICY`,
    sortOrder: 100,
  });
  addPositiveLine(lines, calculatedLine("LEAVE_PAY", "Paid Leave Pay", input.amounts.leavePayCents, 200));
  addPositiveLine(lines, calculatedLine("OVERTIME_PAY", "Overtime Pay", input.amounts.overtimePayCents, 300));
  addPositiveLine(lines, calculatedLine("PUBLIC_HOLIDAY_PAY", "Public Holiday Pay", input.amounts.publicHolidayPayCents, 400));

  [...input.recurring]
    .sort((left, right) =>
      left.type.localeCompare(right.type) ||
      left.code.localeCompare(right.code) ||
      left.versionId.localeCompare(right.versionId),
    )
    .forEach((component, index) => {
      addPositiveLine(lines, {
        lineKey: `RECURRING:${component.versionId.toUpperCase()}`,
        type: component.type,
        code: component.code,
        name: component.name,
        amountCents: component.amountCents,
        sourceType: "RECURRING_PAY",
        sourceId: component.componentId,
        sourceVersionId: component.versionId,
        sourceRevision: component.revision,
        effectiveFromMonth: component.effectiveFromMonth,
        calculationBasis: "FIXED_MONTHLY",
        sortOrder: 1000 + index,
      });
    });

  return lines;
}

export function buildStatutoryDeductionComponents(input: {
  epfEmployeeCents: number;
  socsoEmployeeCents: number;
  eisEmployeeCents: number;
  lindung24EmployeeCents: number;
  pcbCents: number;
  cp38Cents: number;
}): PayrollComponentLine[] {
  const lines: PayrollComponentLine[] = [];
  const values = [
    ["EPF_EMPLOYEE", "EPF / KWSP", input.epfEmployeeCents],
    ["SOCSO_EMPLOYEE", "SOCSO Employee", input.socsoEmployeeCents],
    ["EIS_EMPLOYEE", "EIS Employee", input.eisEmployeeCents],
    ["LINDUNG24_EMPLOYEE", "LINDUNG 24", input.lindung24EmployeeCents],
    ["PCB", "Monthly Tax Deduction (PCB)", input.pcbCents],
    ["CP38", "CP38 tax instruction", input.cp38Cents],
  ] as const;
  values.forEach(([code, name, amountCents], index) => {
    addPositiveLine(lines, {
      lineKey: `STATUTORY:${code}`,
      type: "DEDUCTION",
      code,
      name,
      amountCents,
      sourceType: "STATUTORY",
      sourceId: null,
      sourceVersionId: null,
      sourceRevision: null,
      effectiveFromMonth: null,
      calculationBasis: "STATUTORY_SNAPSHOT",
      sortOrder: 9000 + index,
    });
  });
  return lines;
}

export function calculatePayrollComponentAggregates(
  lines: readonly PayrollComponentLine[],
  statutory: {
    epfEmployeeCents: number;
    socsoEmployeeCents: number;
    eisEmployeeCents: number;
    lindung24EmployeeCents: number;
    pcbCents: number;
    cp38Cents: number;
  },
  reimbursementCents = 0,
): PayrollComponentAggregates {
  lines.forEach(assertLine);
  Object.values(statutory).forEach((value) => assertMoneyCents(value));
  assertMoneyCents(reimbursementCents);

  const grossPayCents = sumLines(lines, (line) => line.type === "EARNING");
  const nonStatutoryDeductionsCents = sumLines(
    lines,
    (line) => line.type === "DEDUCTION" && line.sourceType !== "STATUTORY",
  );
  const allowancesCents = sumLines(
    lines,
    (line) =>
      line.type === "EARNING" &&
      (line.sourceType === "RECURRING_PAY" ||
        line.sourceType === "MANUAL_ADJUSTMENT"),
  );
  const recurringAllowancesCents = sumLines(
    lines,
    (line) => line.type === "EARNING" && line.sourceType === "RECURRING_PAY",
  );
  const recurringDeductionsCents = sumLines(
    lines,
    (line) => line.type === "DEDUCTION" && line.sourceType === "RECURRING_PAY",
  );
  const statutoryDeductionsCents = Object.values(statutory).reduce(
    (total, value) => total + value,
    0,
  );

  return {
    grossPayCents,
    nonStatutoryDeductionsCents,
    allowancesCents,
    recurringAllowancesCents,
    recurringDeductionsCents,
    netPayCents: Math.max(
      0,
      grossPayCents - nonStatutoryDeductionsCents - statutoryDeductionsCents + reimbursementCents,
    ),
  };
}

export function reconcilePayrollEntryComponents(
  lines: readonly PayrollComponentLine[],
  statutory: Parameters<typeof calculatePayrollComponentAggregates>[1],
  stored: PayrollComponentAggregates,
  reimbursementCents = 0,
) {
  const calculated = calculatePayrollComponentAggregates(lines, statutory, reimbursementCents);
  const keys = Object.keys(calculated) as Array<keyof PayrollComponentAggregates>;
  if (keys.some((key) => calculated[key] !== stored[key])) {
    throw new Error(PAYROLL_COMPONENT_RECONCILIATION_FAILED);
  }
  return calculated;
}

export function parsePayrollComponentAmount(value: unknown) {
  const text = String(value ?? "").trim();
  if (!/^\d{1,10}(?:\.\d{1,2})?$/.test(text)) {
    throw new Error("Enter a valid positive RM amount with up to 2 decimals.");
  }
  const [ringgit, sen = ""] = text.split(".");
  const cents = Number(ringgit) * 100 + Number(sen.padEnd(2, "0"));
  if (cents <= 0 || !Number.isSafeInteger(cents)) {
    throw new Error("Manual adjustment amount must be greater than zero.");
  }
  return cents;
}

export function normalizeManualAdjustmentText(input: {
  name: unknown;
  reason: unknown;
}) {
  const name = String(input.name ?? "").trim();
  const reason = String(input.reason ?? "").trim();
  if (name.length < 2 || name.length > 120) {
    throw new Error("Adjustment description must be 2 to 120 characters.");
  }
  if (reason.length < 5 || reason.length > 500) {
    throw new Error("Adjustment reason must be 5 to 500 characters.");
  }
  return { name, reason };
}

function calculatedLine(
  code: string,
  name: string,
  amountCents: number,
  sortOrder: number,
) {
  return {
    lineKey: `SYSTEM:${code}`,
    type: "EARNING" as const,
    code,
    name,
    amountCents,
    sourceType: "PAYROLL_CALCULATION" as const,
    sourceId: null,
    sourceVersionId: null,
    sourceRevision: null,
    effectiveFromMonth: null,
    calculationBasis: "EXISTING_PAYROLL_POLICY",
    sortOrder,
  };
}

function addPositiveLine(
  lines: PayrollComponentLine[],
  line: Omit<PayrollComponentLine, "currency" | "origin" | "reason">,
) {
  assertMoneyCents(line.amountCents);
  if (line.amountCents === 0) return;
  lines.push({ ...line, currency: "MYR", origin: "SYSTEM", reason: null });
}

function sumLines(
  lines: readonly PayrollComponentLine[],
  predicate: (line: PayrollComponentLine) => boolean,
) {
  return lines.reduce(
    (total, line) => total + (predicate(line) ? line.amountCents : 0),
    0,
  );
}

function assertLine(line: PayrollComponentLine) {
  assertMoneyCents(line.amountCents);
  if (line.amountCents === 0) {
    throw new Error("Payroll component lines must have a positive amount.");
  }
  if (line.origin === "MANUAL" && !line.reason?.trim()) {
    throw new Error("Manual payroll adjustments require a reason.");
  }
}

function assertMoneyCents(value: number) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error("Payroll component amount must use safe integer cents.");
  }
}
