import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  compensationAuditChangedFields,
  safeBusinessStatutoryAuditSnapshot,
  safeCompensationAuditSnapshot,
  safeEmployeeSubmissionIdentityAuditSnapshot,
  safePayrollEntryManualAuditChange,
  safeStatutoryContributionAuditSnapshot,
  writeSensitiveAuditLog,
} from "../../src/lib/audit/payroll-sensitive";
import { buildAuditLogWhere } from "../../src/lib/audit/query";
import {
  isSensitiveAuditKey,
  sanitizeAuditReason,
  sanitizeAuditValue,
} from "../../src/lib/audit/sanitize";

test("audit sanitizer removes credentials at every nesting level", () => {
  const value = sanitizeAuditValue({
    email: "owner@example.com",
    password: "plain-text",
    nested: {
      apiSecret: "connector-secret",
      sessionStatus: "connected",
      accessToken: "access-token",
    },
  });

  assert.deepEqual(value, {
    email: "owner@example.com",
    password: "[REDACTED]",
    nested: {
      apiSecret: "[REDACTED]",
      sessionStatus: "connected",
      accessToken: "[REDACTED]",
    },
  });
});

test("audit sanitizer handles dates, bigint, circular values and long strings", () => {
  const circular: Record<string, unknown> = {};
  circular.self = circular;

  const value = sanitizeAuditValue({
    at: new Date("2026-07-13T00:00:00.000Z"),
    count: 2n,
    circular,
    long: "a".repeat(2_100),
  }) as Record<string, unknown>;

  assert.equal(value.at, "2026-07-13T00:00:00.000Z");
  assert.equal(value.count, "2");
  assert.deepEqual(value.circular, { self: "[CIRCULAR]" });
  assert.match(String(value.long), /\.\.\.$/);
});

test("sensitive key matching is normalized but does not hide session health", () => {
  assert.equal(isSensitiveAuditKey("password_hash"), true);
  assert.equal(isSensitiveAuditKey("DATABASE_URL"), true);
  assert.equal(isSensitiveAuditKey("epfMemberNumber"), true);
  assert.equal(isSensitiveAuditKey("socso_member_number"), true);
  assert.equal(isSensitiveAuditKey("employeeIdentityNumber"), true);
  assert.equal(isSensitiveAuditKey("dateOfBirth"), true);
  assert.equal(isSensitiveAuditKey("baseRateSnapshot"), true);
  assert.equal(isSensitiveAuditKey("epfMemberNumberMasked"), false);
  assert.equal(isSensitiveAuditKey("sessionStatus"), false);
});

test("payroll-sensitive amounts and real Prisma identifiers are redacted", () => {
  assert.deepEqual(
    sanitizeAuditValue({
      allowances: "120.00",
      baseRate: "2000.00",
      eisEmployee: "5.00",
      epfMemberNumber: "1234567890",
      nested: { socsoMemberNumber: "SOC998877" },
      pcb: "25.00",
      perkesoWageBase: "2200.00",
    }),
    {
      allowances: "[REDACTED]",
      baseRate: "[REDACTED]",
      eisEmployee: "[REDACTED]",
      epfMemberNumber: "[REDACTED]",
      nested: { socsoMemberNumber: "[REDACTED]" },
      pcb: "[REDACTED]",
      perkesoWageBase: "[REDACTED]",
    },
  );
});

test("audit reasons preserve meaning while removing common identifiers", () => {
  const reason = sanitizeAuditReason(
    "Correct IC 900101-12-3456 for staff@example.com and RM 2,500.00; reference AB12345678.",
  );

  assert.equal(
    reason,
    "Correct IC [REDACTED_NUMBER] for [REDACTED_EMAIL] and RM [REDACTED_AMOUNT]; reference [REDACTED_IDENTIFIER].",
  );
  assert.deepEqual(
    sanitizeAuditValue({ notes: "Use TIN IG123456789 and call 012-3456789." }),
    { notes: "Use TIN [REDACTED_IDENTIFIER] and call [REDACTED_NUMBER]." },
  );
});

test("payroll safe DTOs never expose raw compensation or identifiers", () => {
  assert.deepEqual(
    safeCompensationAuditSnapshot({
      baseSalary: "2500.00",
      normalWorkMinutesPerDay: 480,
      payBasis: "MONTHLY",
      targetBreakMinutes: 60,
    }),
    {
      baseSalary: "[REDACTED]",
      normalWorkMinutesPerDay: 480,
      payBasis: "MONTHLY",
      targetBreakMinutes: 60,
    },
  );
  assert.deepEqual(
    compensationAuditChangedFields(
      {
        baseSalary: "2000.00",
        normalWorkMinutesPerDay: 480,
        payBasis: "MONTHLY",
        targetBreakMinutes: 60,
      },
      {
        baseSalary: "2200.00",
        normalWorkMinutesPerDay: 480,
        payBasis: "MONTHLY",
        targetBreakMinutes: 45,
      },
    ),
    ["baseSalary", "targetBreakMinutes"],
  );
  assert.deepEqual(
    safeStatutoryContributionAuditSnapshot({
      dateOfBirth: new Date("1990-01-01T00:00:00.000Z"),
      eisEnabled: true,
      eisPreviouslyContributed: false,
      epfEnabled: true,
      epfMemberBeforeAug1998: false,
      lindung24OptIn: false,
      socsoCategory: "FIRST",
      socsoEnabled: true,
      statutoryNationality: "MALAYSIAN",
    }),
    {
      dateOfBirthConfigured: true,
      eisEnabled: true,
      eisPreviouslyContributed: false,
      epfEnabled: true,
      epfMemberBeforeAug1998: false,
      lindung24OptIn: false,
      socsoCategory: "FIRST",
      socsoEnabled: true,
      statutoryNationality: "MALAYSIAN",
    },
  );
  assert.deepEqual(
    safeEmployeeSubmissionIdentityAuditSnapshot({
      epfMemberNumber: "1234567890",
      socsoMemberNumber: "SOC99887766",
      statutoryCountryCode: "MY",
      statutoryIdentityNumber: "900101123456",
      statutoryIdentityType: "NEW_IC",
      taxIdentificationNumber: "IG123456789",
    }),
    {
      epfMemberNumberMasked: "•••• 7890",
      socsoMemberNumberMasked: "•••• 7766",
      statutoryCountryCode: "MY",
      statutoryIdentityNumberMasked: "•••• 3456",
      statutoryIdentityType: "NEW_IC",
      taxIdentificationNumberMasked: "•••• 6789",
    },
  );
  assert.deepEqual(
    safeBusinessStatutoryAuditSnapshot({
      epfEmployerNumber: "EPF123456",
      lhdnEmployerNumber: "1234567890",
      lhdnEmployerNumberHq: "0987654321",
      perkesoEmployerCode: "SOCSO998877",
      perkesoRegistrationNumber: "REG123456789",
    }),
    {
      epfEmployerNumberMasked: "•••• 3456",
      lhdnEmployerNumberHqMasked: "•••• 4321",
      lhdnEmployerNumberMasked: "•••• 7890",
      perkesoEmployerCodeMasked: "•••• 8877",
      perkesoRegistrationNumberMasked: "•••• 6789",
    },
  );
});

test("manual payroll audit reports changed fields without storing amounts or notes", () => {
  const before = payrollEntryAuditFixture();
  const after = {
    ...before,
    allowances: "100.00",
    notes: "IC 900101123456 corrected",
  };
  const result = safePayrollEntryManualAuditChange(before, after);

  assert.deepEqual(result.changedFields, ["allowances", "notes"]);
  assert.equal((result.before as Record<string, unknown>).allowances, "[REDACTED]");
  assert.equal((result.after as Record<string, unknown>).allowances, "[REDACTED]");
  assert.equal((result.before as Record<string, unknown>).notes, false);
  assert.equal((result.after as Record<string, unknown>).notes, true);
  assert.doesNotMatch(JSON.stringify(result), /100\.00|900101123456/);
});

test("sensitive audit writer propagates failures instead of degrading to best effort", async () => {
  const transaction = {
    auditLog: {
      create: async () => {
        throw new Error("audit unavailable");
      },
    },
  };

  await assert.rejects(
    writeSensitiveAuditLog(
      {
        action: "EMPLOYEE_COMPENSATION_UPDATED",
        businessId: "business-a",
        entityType: "EmployeeBusinessMembership",
        summary: "Compensation updated.",
      },
      transaction as never,
    ),
    /audit unavailable/,
  );
});

test("production application source treats AuditLog as append-only", () => {
  const sourceRoot = path.join(process.cwd(), "src");
  const mutationPattern =
    /\bauditLog\s*(?:\.\s*(?:delete|deleteMany|update|updateMany|upsert)\s*\(|\[\s*["'](?:delete|deleteMany|update|updateMany|upsert)["']\s*\]\s*\()/;
  const rawMutationPattern =
    /\b(?:delete\s+from|truncate(?:\s+table)?|update)\s+["'`]?audit_logs\b/i;
  const offenders = sourceFiles(sourceRoot).filter((file) => {
    const source = fs.readFileSync(file, "utf8");
    return mutationPattern.test(source) || rawMutationPattern.test(source);
  });

  assert.deepEqual(offenders, []);
});

test("attendance authentication secrets are always redacted from audit metadata", () => {
  assert.deepEqual(
    sanitizeAuditValue({
      otp: "123456",
      phoneNumberNormalized: "+60123456789",
      deviceIdentifier: "raw-browser-identifier",
      phoneMasked: "+60 12-*** 6789",
    }),
    {
      otp: "[REDACTED]",
      phoneNumberNormalized: "[REDACTED]",
      deviceIdentifier: "[REDACTED]",
      phoneMasked: "+60 12-*** 6789",
    },
  );
});

test("audit query scope cannot be replaced by filters", () => {
  const where = buildAuditLogWhere("business-a", {
    actorUserId: "staff-a",
    action: "PAYMENT_RECORDED",
  });

  assert.deepEqual(where, {
    businessId: "business-a",
    actorUserId: "staff-a",
    action: "PAYMENT_RECORDED",
  });
});

function payrollEntryAuditFixture() {
  return {
    allowances: "0.00",
    otherDeductions: "0.00",
    epfWageBase: "2000.00",
    perkesoWageBase: "2000.00",
    lindung24Employee: "0.00",
    epfEmployee: "220.00",
    socsoEmployee: "9.75",
    eisEmployee: "3.90",
    pcb: "0.00",
    employerEpf: "260.00",
    employerSocso: "34.15",
    employerEis: "3.90",
    grossPay: "2000.00",
    netPay: "1766.35",
    notes: "",
  };
}

function sourceFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(target);
    return /\.(?:ts|tsx)$/.test(entry.name) ? [target] : [];
  });
}
