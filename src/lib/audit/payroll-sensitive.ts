import type { Prisma } from "@prisma/client";
import {
  writeAuditLog,
  type WriteAuditLogInput,
} from "@/lib/audit";
import type { AuditJsonValue } from "@/lib/audit/sanitize";

const REDACTED = "[REDACTED]";

type SafeSensitiveAuditInput = Omit<
  WriteAuditLogInput,
  "after" | "before" | "metadata"
> & {
  after?: AuditJsonValue;
  before?: AuditJsonValue;
  metadata?: AuditJsonValue;
};

type SensitiveAuditTransaction = Pick<Prisma.TransactionClient, "auditLog">;

export async function writeSensitiveAuditLog(
  input: SafeSensitiveAuditInput,
  transaction: SensitiveAuditTransaction,
) {
  // Sensitive writes deliberately use the throwing writer and the caller's
  // transaction. An audit failure must roll back the business mutation.
  return writeAuditLog(input, transaction);
}

export function safeCompensationAuditSnapshot(input: {
  baseSalary: unknown | null;
  normalWorkMinutesPerDay: number | null;
  payBasis: string;
  targetBreakMinutes: number | null;
}) {
  return {
    baseSalary: input.baseSalary === null ? null : REDACTED,
    normalWorkMinutesPerDay: input.normalWorkMinutesPerDay,
    payBasis: input.payBasis,
    targetBreakMinutes: input.targetBreakMinutes,
  } satisfies AuditJsonValue;
}

export function compensationAuditChangedFields(
  before: CompensationAuditSource,
  after: CompensationAuditSource,
) {
  return COMPENSATION_AUDIT_FIELDS.filter(
    (field) => String(before[field] ?? "") !== String(after[field] ?? ""),
  );
}

export function safeStatutoryContributionAuditSnapshot(input: {
  dateOfBirth: Date | null;
  eisEnabled: boolean;
  eisPreviouslyContributed: boolean;
  epfEnabled: boolean;
  epfMemberBeforeAug1998: boolean;
  lindung24OptIn: boolean;
  socsoCategory: string | null;
  socsoEnabled: boolean;
  statutoryNationality: string | null;
}) {
  return {
    dateOfBirthConfigured: input.dateOfBirth !== null,
    eisEnabled: input.eisEnabled,
    eisPreviouslyContributed: input.eisPreviouslyContributed,
    epfEnabled: input.epfEnabled,
    epfMemberBeforeAug1998: input.epfMemberBeforeAug1998,
    lindung24OptIn: input.lindung24OptIn,
    socsoCategory: input.socsoCategory,
    socsoEnabled: input.socsoEnabled,
    statutoryNationality: input.statutoryNationality,
  } satisfies AuditJsonValue;
}

export function safeEmployeeSubmissionIdentityAuditSnapshot(input: {
  epfMemberNumber: string | null;
  socsoMemberNumber: string | null;
  statutoryCountryCode: string | null;
  statutoryIdentityNumber: string | null;
  statutoryIdentityType: string | null;
  taxIdentificationNumber: string | null;
}) {
  return {
    epfMemberNumberMasked: maskAuditIdentifier(input.epfMemberNumber),
    socsoMemberNumberMasked: maskAuditIdentifier(input.socsoMemberNumber),
    statutoryCountryCode: input.statutoryCountryCode,
    statutoryIdentityNumberMasked: maskAuditIdentifier(
      input.statutoryIdentityNumber,
    ),
    statutoryIdentityType: input.statutoryIdentityType,
    taxIdentificationNumberMasked: maskAuditIdentifier(
      input.taxIdentificationNumber,
    ),
  } satisfies AuditJsonValue;
}

export function safeBusinessStatutoryAuditSnapshot(input: {
  epfEmployerNumber: string | null;
  lhdnEmployerNumber: string | null;
  lhdnEmployerNumberHq: string | null;
  perkesoEmployerCode: string | null;
  perkesoRegistrationNumber: string | null;
}) {
  return {
    epfEmployerNumberMasked: maskAuditIdentifier(input.epfEmployerNumber),
    lhdnEmployerNumberHqMasked: maskAuditIdentifier(
      input.lhdnEmployerNumberHq,
    ),
    lhdnEmployerNumberMasked: maskAuditIdentifier(input.lhdnEmployerNumber),
    perkesoEmployerCodeMasked: maskAuditIdentifier(input.perkesoEmployerCode),
    perkesoRegistrationNumberMasked: maskAuditIdentifier(
      input.perkesoRegistrationNumber,
    ),
  } satisfies AuditJsonValue;
}

export function safePayrollEntryManualAuditChange(
  before: PayrollEntryManualAuditSource,
  after: PayrollEntryManualAuditSource,
) {
  const changedFields = PAYROLL_ENTRY_MANUAL_FIELDS.filter(
    (field) => String(before[field] ?? "") !== String(after[field] ?? ""),
  );

  return {
    after: redactChangedFields(after, changedFields),
    before: redactChangedFields(before, changedFields),
    changedFields,
  };
}

type PayrollEntryManualAuditSource = Record<
  (typeof PAYROLL_ENTRY_MANUAL_FIELDS)[number],
  unknown
>;

type CompensationAuditSource = {
  baseSalary: unknown | null;
  normalWorkMinutesPerDay: number | null;
  payBasis: string;
  targetBreakMinutes: number | null;
};

const COMPENSATION_AUDIT_FIELDS = [
  "payBasis",
  "baseSalary",
  "normalWorkMinutesPerDay",
  "targetBreakMinutes",
] as const;

const PAYROLL_ENTRY_MANUAL_FIELDS = [
  "allowances",
  "otherDeductions",
  "epfWageBase",
  "perkesoWageBase",
  "lindung24Employee",
  "epfEmployee",
  "socsoEmployee",
  "eisEmployee",
  "pcb",
  "employerEpf",
  "employerSocso",
  "employerEis",
  "grossPay",
  "netPay",
  "notes",
] as const;

function redactChangedFields(
  source: PayrollEntryManualAuditSource,
  changedFields: readonly string[],
) {
  return Object.fromEntries(
    PAYROLL_ENTRY_MANUAL_FIELDS.map((field) => [
      field,
      field === "notes"
        ? Boolean(String(source[field] ?? "").trim())
        : changedFields.includes(field)
          ? REDACTED
          : "[UNCHANGED]",
    ]),
  ) as AuditJsonValue;
}

export function maskAuditIdentifier(value: string | null) {
  if (!value) return null;
  const compact = value.replace(/[^A-Za-z0-9]/g, "");
  if (!compact) return null;
  return compact.length <= 4 ? "••••" : `•••• ${compact.slice(-4)}`;
}
