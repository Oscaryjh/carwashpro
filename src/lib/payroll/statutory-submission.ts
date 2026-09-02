export type StatutorySubmissionProvider = "EPF" | "PERKESO" | "PCB";
export type StatutoryIdentityType = "NEW_IC" | "OLD_IC" | "PASSPORT" | "OTHER";

export const STATUTORY_EXPORT_VERSION: Record<StatutorySubmissionProvider, string> = {
  EPF: "KWSP_ECARUMAN_CSV_2020",
  PERKESO: "PERKESO_COMBINED_TEXT_2.0_2026-02-13",
  PCB: "LHDN_CP39_EXHIBIT_4_2026",
};

export type StatutoryBusinessProfile = {
  epfEmployerNumber: string | null;
  perkesoEmployerCode: string | null;
  perkesoRegistrationNumber: string | null;
  lhdnEmployerNumberHq: string | null;
  lhdnEmployerNumber: string | null;
};

export type StatutoryEmployeeProfile = {
  statutoryIdentityType: StatutoryIdentityType | null;
  statutoryIdentityNumber: string | null;
  statutoryCountryCode: string | null;
  epfMemberNumber: string | null;
  socsoMemberNumber: string | null;
  taxIdentificationNumber: string | null;
};

export type StatutorySubmissionEntry = {
  id: string;
  membershipId: string;
  employeeCode: string;
  fullName: string;
  epfWageBase: number;
  perkesoWageBase: number;
  epfEmployee: number;
  employerEpf: number;
  socsoEmployee: number;
  employerSocso: number;
  eisEmployee: number;
  employerEis: number;
  lindung24Employee: number;
  pcb: number;
  cp38?: number;
  membership: StatutoryEmployeeProfile;
};

export type StatutorySubmissionRun = {
  id: string;
  status: "DRAFT" | "REVIEW" | "FINALIZED";
  periodStart: Date;
  entries: StatutorySubmissionEntry[];
};

export type StatutoryValidationIssue = {
  code: string;
  message: string;
  employeeName?: string;
  membershipId?: string;
};

export type StatutoryValidationResult = {
  provider: StatutorySubmissionProvider;
  ready: boolean;
  eligibleEntries: StatutorySubmissionEntry[];
  errors: StatutoryValidationIssue[];
  warnings: StatutoryValidationIssue[];
};

export function validateStatutorySubmission(
  provider: StatutorySubmissionProvider,
  profile: StatutoryBusinessProfile | null,
  run: StatutorySubmissionRun | null,
): StatutoryValidationResult {
  const errors: StatutoryValidationIssue[] = [];
  const warnings: StatutoryValidationIssue[] = [];
  if (!run) {
    errors.push({ code: "RUN_MISSING", message: "Generate and finalize this payroll month first." });
  } else if (run.status !== "FINALIZED") {
    errors.push({ code: "RUN_NOT_FINALIZED", message: "Only finalized payroll can produce official submission files." });
  }

  const eligibleEntries = run?.entries.filter((entry) => hasProviderAmount(provider, entry)) ?? [];
  if (run && eligibleEntries.length === 0) {
    errors.push({ code: "NO_RECORDS", message: `No ${providerLabel(provider)} contribution records exist for this month.` });
  }
  validateBusiness(provider, profile, errors);
  for (const entry of eligibleEntries) validateEmployee(provider, entry, errors, warnings);

  return { provider, ready: errors.length === 0, eligibleEntries, errors, warnings };
}

export function buildOfficialSubmissionFile(
  provider: StatutorySubmissionProvider,
  profile: StatutoryBusinessProfile,
  run: StatutorySubmissionRun,
) {
  const validation = validateStatutorySubmission(provider, profile, run);
  if (!validation.ready) throw new Error(validation.errors[0]?.message ?? "Statutory submission is not ready.");
  if (provider === "EPF") return Buffer.from(buildEpfCsv(validation.eligibleEntries), "utf8");
  if (provider === "PERKESO") {
    return Buffer.from(buildPerkesoText(profile, run, validation.eligibleEntries), "utf8");
  }
  return Buffer.from(buildPcbText(profile, run, validation.eligibleEntries), "utf8");
}

export function statutorySubmissionFileName(
  provider: StatutorySubmissionProvider,
  profile: StatutoryBusinessProfile,
  run: StatutorySubmissionRun,
) {
  const month = run.periodStart.toISOString().slice(0, 7);
  if (provider === "EPF") return `kwsp-e-caruman-${month}.csv`;
  if (provider === "PERKESO") return `perkeso-socso-eis-${month}.txt`;
  const employer = digits(profile.lhdnEmployerNumber).padStart(10, "0").slice(-10);
  return `${employer}${month.slice(5, 7)}_${month.slice(0, 4)}.txt`;
}

export function statutorySubmissionContentType(provider: StatutorySubmissionProvider) {
  return provider === "EPF" ? "text/csv; charset=utf-8" : "text/plain; charset=utf-8";
}

function buildEpfCsv(entries: StatutorySubmissionEntry[]) {
  return entries.map((entry) => {
    const identity = entry.membership.statutoryIdentityType === "NEW_IC"
      ? formatNewIc(entry.membership.statutoryIdentityNumber)
      : clean(entry.membership.statutoryIdentityNumber);
    return [
      entry.fullName,
      identity,
      clean(entry.membership.epfMemberNumber),
      entry.epfWageBase.toFixed(2),
      entry.employerEpf.toFixed(0),
      entry.epfEmployee.toFixed(0),
    ].map(csvCell).join(",");
  }).join("\r\n") + "\r\n";
}

function buildPerkesoText(
  profile: StatutoryBusinessProfile,
  run: StatutorySubmissionRun,
  entries: StatutorySubmissionEntry[],
) {
  const period = `${run.periodStart.toISOString().slice(5, 7)}${run.periodStart.toISOString().slice(0, 4)}`;
  return entries.map((entry) => {
    const identifier = clean(entry.membership.socsoMemberNumber) || clean(entry.membership.statutoryIdentityNumber);
    const line = [
      left(alnum(profile.perkesoEmployerCode), 12),
      left(alnum(profile.perkesoRegistrationNumber), 20),
      left(alnum(identifier), 12),
      left(entry.fullName, 150),
      period,
      cents(entry.perkesoWageBase, 14),
      cents(entry.employerSocso, 6),
      cents(entry.socsoEmployee, 6),
      cents(entry.employerEis, 6),
      cents(entry.eisEmployee, 6),
      cents(entry.lindung24Employee, 6),
      " ".repeat(14),
      " ".repeat(20),
    ].join("");
    if (line.length !== 278) throw new Error("PERKESO export record length is invalid.");
    return line;
  }).join("\r\n") + "\r\n";
}

function buildPcbText(
  profile: StatutoryBusinessProfile,
  run: StatutorySubmissionRun,
  entries: StatutorySubmissionEntry[],
) {
  const year = run.periodStart.toISOString().slice(0, 4);
  const month = run.periodStart.toISOString().slice(5, 7);
  const totalPcb = entries.reduce((sum, entry) => sum + entry.pcb, 0);
  const totalCp38 = entries.reduce((sum, entry) => sum + (entry.cp38 ?? 0), 0);
  const cp38EntryCount = entries.filter((entry) => (entry.cp38 ?? 0) > 0).length;
  const header = [
    "H",
    numeric(profile.lhdnEmployerNumberHq, 10),
    numeric(profile.lhdnEmployerNumber, 10),
    year,
    month,
    fixedCents(totalPcb, 10, "PCB header total"),
    String(entries.length).padStart(5, "0"),
    fixedCents(totalCp38, 10, "CP38 header total"),
    String(cp38EntryCount).padStart(5, "0"),
  ].join("");
  if (header.length !== 57) throw new Error("PCB export header length is invalid.");

  const details = entries.map((entry) => {
    const identity = clean(entry.membership.statutoryIdentityNumber);
    const type = entry.membership.statutoryIdentityType;
    const line = [
      "D",
      numeric(entry.membership.taxIdentificationNumber, 11),
      left(entry.fullName, 60),
      type === "OLD_IC" ? left(alnum(identity), 12) : " ".repeat(12),
      type === "NEW_IC" ? numeric(identity, 12) : " ".repeat(12),
      type === "PASSPORT" ? left(alnum(identity), 12) : " ".repeat(12),
      type === "PASSPORT" ? left(entry.membership.statutoryCountryCode?.toUpperCase(), 2) : "  ",
      fixedCents(entry.pcb, 8, "PCB employee amount"),
      fixedCents(entry.cp38 ?? 0, 8, "CP38 employee amount"),
      left(alnum(entry.employeeCode), 10),
    ].join("");
    if (line.length !== 136) throw new Error("PCB export detail length is invalid.");
    return line;
  });
  return [header, ...details].join("\r\n") + "\r\n";
}

function validateBusiness(
  provider: StatutorySubmissionProvider,
  profile: StatutoryBusinessProfile | null,
  errors: StatutoryValidationIssue[],
) {
  if (!profile) {
    errors.push({ code: "BUSINESS_PROFILE_MISSING", message: "Complete the company statutory registration profile." });
    return;
  }
  if (provider === "EPF" && !clean(profile.epfEmployerNumber)) {
    errors.push({ code: "EPF_EMPLOYER_MISSING", message: "KWSP employer number is required." });
  }
  if (provider === "PERKESO" && !/^[A-Za-z0-9]{12}$/.test(clean(profile.perkesoEmployerCode))) {
    errors.push({ code: "PERKESO_EMPLOYER_INVALID", message: "PERKESO employer code must contain exactly 12 letters or digits." });
  }
  if (provider === "PCB") {
    if (!/^\d{10}$/.test(clean(profile.lhdnEmployerNumberHq))) {
      errors.push({ code: "LHDN_HQ_INVALID", message: "LHDN HQ employer number must contain exactly 10 digits." });
    }
    if (!/^\d{10}$/.test(clean(profile.lhdnEmployerNumber))) {
      errors.push({ code: "LHDN_EMPLOYER_INVALID", message: "LHDN employer number must contain exactly 10 digits." });
    }
  }
}

function validateEmployee(
  provider: StatutorySubmissionProvider,
  entry: StatutorySubmissionEntry,
  errors: StatutoryValidationIssue[],
  warnings: StatutoryValidationIssue[],
) {
  const issue = (code: string, message: string) => errors.push({ code, message, employeeName: entry.fullName, membershipId: entry.membershipId });
  const identity = clean(entry.membership.statutoryIdentityNumber);
  if (!entry.membership.statutoryIdentityType || !identity) issue("IDENTITY_MISSING", "Identity type and number are required.");
  if (identity && entry.membership.statutoryIdentityType === "NEW_IC" && !/^\d{12}$/.test(digits(identity))) {
    issue("NEW_IC_INVALID", "New IC must contain exactly 12 digits.");
  }
  if (provider === "EPF" && !clean(entry.membership.epfMemberNumber)) issue("EPF_MEMBER_MISSING", "KWSP member number is required.");
  if (provider === "PERKESO") {
    const identifier = alnum(entry.membership.socsoMemberNumber) || alnum(identity);
    if (!identifier || identifier.length > 12) issue("PERKESO_ID_INVALID", "SOCSO/identity number must be 1 to 12 letters or digits.");
  }
  if (provider === "PCB") {
    if (!/^\d{11}$/.test(clean(entry.membership.taxIdentificationNumber))) issue("TIN_INVALID", "Tax Identification Number must contain exactly 11 digits without separators.");
    if (entry.membership.statutoryIdentityType === "OLD_IC" && (!/^[A-Za-z0-9]{1,12}$/.test(identity))) {
      issue("OLD_IC_INVALID", "Old IC must contain 1 to 12 alphanumeric characters without separators.");
    }
    if (entry.membership.statutoryIdentityType === "PASSPORT" && (!/^[A-Za-z0-9]{1,12}$/.test(identity))) {
      issue("PASSPORT_INVALID", "Passport must contain 1 to 12 alphanumeric characters without separators.");
    }
    if (entry.membership.statutoryIdentityType === "OTHER") issue("IDENTITY_TYPE_UNSUPPORTED", "CP39 supports New IC, Old IC or Passport identity only.");
    if (entry.membership.statutoryIdentityType === "PASSPORT" && !/^[A-Za-z]{2}$/.test(clean(entry.membership.statutoryCountryCode))) {
      issue("COUNTRY_CODE_INVALID", "Passport holders require a 2-letter LHDN country code.");
    }
    if (!/^[A-Za-z0-9]{1,10}$/.test(clean(entry.employeeCode))) issue("EMPLOYEE_CODE_INVALID", "Employee code must be 1 to 10 letters or digits for CP39; silent stripping or truncation is forbidden.");
    if (entry.fullName.length > 60) issue("EMPLOYEE_NAME_TOO_LONG", "Employee name exceeds the 60-character CP39 field; silent truncation is forbidden.");
  }
  if (provider !== "PCB" && entry.fullName.length > (provider === "PERKESO" ? 150 : 120)) {
    warnings.push({ code: "NAME_TRUNCATED", message: `Name will be truncated in the ${providerLabel(provider)} file.`, employeeName: entry.fullName, membershipId: entry.membershipId });
  }
}

function hasProviderAmount(provider: StatutorySubmissionProvider, entry: StatutorySubmissionEntry) {
  if (provider === "EPF") return entry.epfEmployee + entry.employerEpf > 0;
  if (provider === "PERKESO") return entry.socsoEmployee + entry.employerSocso + entry.eisEmployee + entry.employerEis + entry.lindung24Employee > 0;
  return entry.pcb + (entry.cp38 ?? 0) > 0;
}

function providerLabel(provider: StatutorySubmissionProvider) {
  return provider === "EPF" ? "KWSP" : provider === "PERKESO" ? "PERKESO" : "PCB";
}

function clean(value: string | null | undefined) { return value?.trim() ?? ""; }
function digits(value: string | null | undefined) { return clean(value).replace(/\D/g, ""); }
function alnum(value: string | null | undefined) { return clean(value).replace(/[^A-Za-z0-9]/g, ""); }
function left(value: string | null | undefined, width: number) { return clean(value).slice(0, width).padEnd(width, " "); }
function numeric(value: string | null | undefined, width: number) { return digits(value).slice(-width).padStart(width, "0"); }
function cents(value: number, width: number) { return String(Math.round(value * 100)).padStart(width, "0").slice(-width); }
function fixedCents(value: number, width: number, label: string) {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a non-negative amount.`);
  }
  const encoded = String(Math.round(value * 100));
  if (encoded.length > width) throw new Error(`${label} exceeds the CP39 field width.`);
  return encoded.padStart(width, "0");
}
function formatNewIc(value: string | null) {
  const number = digits(value);
  return number.length === 12 ? `${number.slice(0, 6)}-${number.slice(6, 8)}-${number.slice(8)}` : clean(value);
}
function csvCell(value: string) { return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value; }
