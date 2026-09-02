export type CertificationIdentityProvenance =
  | "OFFICIAL_QUESTION"
  | "APPLICANT_SUPPLIED"
  | "OFFICIAL_FORMAT_DEFAULT"
  | "ALLOWED_BLANK";

export type CertificationIdentityStatus =
  | "AVAILABLE"
  | "MISSING_APPLICANT_INPUT"
  | "OFFICIAL_QUESTION_NOT_PROVIDED"
  | "CLARIFICATION_REQUIRED"
  | "NOT_REQUIRED";

export type CertificationIdentityField = {
  value: string | null;
  provenance: CertificationIdentityProvenance;
  status: CertificationIdentityStatus;
  officialSource: string;
};

export type PcbCertificationEmployeeIdentity = {
  employeeLabel: string;
  fullName: CertificationIdentityField;
  employeeNumber: CertificationIdentityField;
  taxIdentificationNumber: CertificationIdentityField;
  identityType: CertificationIdentityField;
  identityNumber: CertificationIdentityField;
  passportCountryCode: CertificationIdentityField;
};

export type Pcb2iiTransactionIdentity = {
  month: string;
  pcbReceiptOrTransactionNumber: CertificationIdentityField;
  pcbReceiptOrTransactionDate: CertificationIdentityField;
  cp38ReceiptOrTransactionNumber: CertificationIdentityField;
  cp38ReceiptOrTransactionDate: CertificationIdentityField;
};

export type PcbCertificationIdentityInput = {
  schemaVersion: string;
  applicant: {
    employerName: CertificationIdentityField;
    employerAddress: CertificationIdentityField;
    lhdnEmployerNumberHq: CertificationIdentityField;
    lhdnEmployerNumber: CertificationIdentityField;
    hasilBranch: CertificationIdentityField;
    statementDate: CertificationIdentityField;
    officerName: CertificationIdentityField;
    officerPosition: CertificationIdentityField;
    officerPhone: CertificationIdentityField;
  };
  employees: Record<"Q1" | "Q2" | "Q3" | "Q4" | "Q5", PcbCertificationEmployeeIdentity>;
  pcb2iiTransactions: Pcb2iiTransactionIdentity[];
};

export type P3aIdentityIssue = {
  code: string;
  field: string;
  artifact: "CP39" | "PCB_2II";
  questionId: "Q1" | "Q2" | "Q3" | "Q4";
  detail: string;
};

export const EXHIBIT_4_IDENTITY_FIELDS = [
  { officialField: "Employer No. (HQ)", start: 2, end: 11, length: 10, type: "Num", rule: "Required; right justify with zeroes", source: "Applicant" },
  { officialField: "Employer No.", start: 12, end: 21, length: 10, type: "Num", rule: "Required; right justify with zeroes", source: "Applicant" },
  { officialField: "Tax Identification Number", start: 2, end: 12, length: 11, type: "Num", rule: "Mandatory; left justify with zeroes to 11 digits", source: "Employee certification identity" },
  { officialField: "Employee's Name", start: 13, end: 72, length: 60, type: "Alphabet", rule: "Required; full name as IC/passport; left justify with spaces", source: "Official question plus applicant verification" },
  { officialField: "Old IC No.", start: 73, end: 84, length: 12, type: "Alphanum", rule: "Valid value or blank when not applicable", source: "Employee certification identity" },
  { officialField: "New IC No.", start: 85, end: 96, length: 12, type: "Num", rule: "Valid 12 digits without hyphens or blank when not applicable", source: "Employee certification identity" },
  { officialField: "Passport No.", start: 97, end: 108, length: 12, type: "Alphanum", rule: "Valid value or blank when not applicable", source: "Employee certification identity" },
  { officialField: "Country Code", start: 109, end: 110, length: 2, type: "Alphabet", rule: "Required for foreign passport; must use HASiL country-code list", source: "Employee certification identity plus retained code list" },
  { officialField: "Employee No. or Salary No.", start: 127, end: 136, length: 10, type: "Alphanum", rule: "Required; left justify", source: "Applicant-assigned employee code" },
] as const;

export const EXHIBIT_3_IDENTITY_FIELDS = [
  { officialField: "Cawangan", required: true, format: "No explicit width or code rule in Exhibit 3", source: "Applicant" },
  { officialField: "Tarikh", required: true, format: "Date; no explicit format stated in Exhibit 3", source: "Applicant" },
  { officialField: "Potongan Cukai Yang Dibuat Dalam Tahun", required: true, format: "Four-digit year", source: "Certified question year" },
  { officialField: "Nama Pekerja", required: true, format: "Employee name", source: "Official question plus applicant verification" },
  { officialField: "No. Kad Pengenalan/No. Passpot", required: true, format: "Valid IC or passport identity", source: "Employee certification identity" },
  { officialField: "No. Pengenalan Cukai Pekerja (IG)", required: true, format: "Employee tax identification number", source: "Employee certification identity" },
  { officialField: "No. Pekerja", required: true, format: "Employer-assigned employee number", source: "Applicant" },
  { officialField: "No. Majikan (E)", required: true, format: "Employer number", source: "Applicant" },
  { officialField: "Nama pegawai", required: true, format: "No explicit format in Exhibit 3", source: "Applicant" },
  { officialField: "Jawatan", required: true, format: "No explicit format in Exhibit 3", source: "Applicant" },
  { officialField: "No. Telefon", required: true, format: "No explicit format in Exhibit 3", source: "Applicant" },
  { officialField: "Nama Dan Alamat Majikan", required: true, format: "Employer name and address", source: "Applicant" },
] as const;

function value(field: CertificationIdentityField) {
  return field.value?.trim() ?? "";
}

function missing(field: CertificationIdentityField) {
  return !value(field);
}

function alnum(input: string) {
  return /^[A-Za-z0-9]+$/.test(input);
}

function issue(
  issues: P3aIdentityIssue[],
  artifact: P3aIdentityIssue["artifact"],
  questionId: P3aIdentityIssue["questionId"],
  code: string,
  field: string,
  detail: string,
) {
  issues.push({ artifact, questionId, code, field, detail });
}

function validateEmployee(
  issues: P3aIdentityIssue[],
  artifact: P3aIdentityIssue["artifact"],
  questionId: P3aIdentityIssue["questionId"],
  employee: PcbCertificationEmployeeIdentity,
) {
  const tin = value(employee.taxIdentificationNumber);
  const employeeNumber = value(employee.employeeNumber);
  const name = value(employee.fullName);
  const type = value(employee.identityType);
  const identity = value(employee.identityNumber);
  const country = value(employee.passportCountryCode);

  if (!name) issue(issues, artifact, questionId, "EMPLOYEE_NAME_REQUIRED", "fullName", "Official question employee label must be verified to the submission name.");
  if (name.length > 60 && artifact === "CP39") issue(issues, artifact, questionId, "EMPLOYEE_NAME_TOO_LONG", "fullName", "Exhibit 4 employee name is limited to 60 characters; silent truncation is forbidden.");
  if (!/^\d{11}$/.test(tin)) issue(issues, artifact, questionId, "EMPLOYEE_TIN_REQUIRED", "taxIdentificationNumber", "An exact 11-digit employee TIN is required and was not supplied by the Testing Questions.");
  if (!employeeNumber || !alnum(employeeNumber) || (artifact === "CP39" && employeeNumber.length > 10)) {
    issue(issues, artifact, questionId, "EMPLOYEE_NUMBER_REQUIRED", "employeeNumber", artifact === "CP39"
      ? "A non-empty applicant-assigned alphanumeric employee/salary number is required; Exhibit 4 allows at most 10 characters."
      : "A non-empty applicant-assigned employee number is required by Exhibit 3; no field width is stated there.");
  }
  if (!(["NEW_IC", "OLD_IC", "PASSPORT"] as const).includes(type as "NEW_IC" | "OLD_IC" | "PASSPORT")) {
    issue(issues, artifact, questionId, "IDENTITY_TYPE_REQUIRED", "identityType", "Identity type must resolve to NEW_IC, OLD_IC or PASSPORT.");
  }
  if (!identity) {
    issue(issues, artifact, questionId, "IDENTITY_NUMBER_REQUIRED", "identityNumber", "A valid IC or passport number is required.");
  }
  if (identity && type === "NEW_IC" && !/^\d{12}$/.test(identity)) issue(issues, artifact, questionId, "NEW_IC_INVALID", "identityNumber", "New IC must be exactly 12 digits without hyphens.");
  if (identity && (type === "OLD_IC" || type === "PASSPORT") && (!alnum(identity) || identity.length > 12)) issue(issues, artifact, questionId, "ALPHANUM_IDENTITY_INVALID", "identityNumber", "Old IC/passport must be 1-12 alphanumeric characters; silent stripping or truncation is forbidden.");
  if (type === "PASSPORT") {
    if (!/^[A-Za-z]{2}$/.test(country)) issue(issues, artifact, questionId, "PASSPORT_COUNTRY_REQUIRED", "passportCountryCode", "Passport requires a two-letter country code.");
    issue(issues, artifact, questionId, "HASIL_COUNTRY_CODE_LIST_NOT_RETAINED", "passportCountryCode", "The retained specification refers to a HASiL country-code list but does not contain that list; supplied codes cannot yet be certified against the official list.");
  } else if (country) {
    issue(issues, artifact, questionId, "COUNTRY_CODE_NOT_APPLICABLE", "passportCountryCode", "Country code must be blank for an IC identity.");
  }
}

export function validateP3aCertificationIdentity(input: PcbCertificationIdentityInput) {
  const issues: P3aIdentityIssue[] = [];
  const applicant = input.applicant;
  const employerHq = value(applicant.lhdnEmployerNumberHq);
  const employer = value(applicant.lhdnEmployerNumber);

  for (const questionId of ["Q1", "Q3", "Q4"] as const) {
    if (!/^\d{10}$/.test(employerHq)) issue(issues, "CP39", questionId, "EMPLOYER_HQ_REQUIRED", "lhdnEmployerNumberHq", "Exhibit 4 requires an exact 10-digit HQ employer number.");
    if (!/^\d{10}$/.test(employer)) issue(issues, "CP39", questionId, "EMPLOYER_NUMBER_REQUIRED", "lhdnEmployerNumber", "Exhibit 4 requires an exact 10-digit employer number.");
    validateEmployee(issues, "CP39", questionId, input.employees[questionId]);
  }

  const q2 = "Q2" as const;
  for (const [field, label] of [
    [applicant.hasilBranch, "hasilBranch"],
    [applicant.statementDate, "statementDate"],
    [applicant.employerName, "employerName"],
    [applicant.employerAddress, "employerAddress"],
    [applicant.lhdnEmployerNumber, "lhdnEmployerNumber"],
    [applicant.officerName, "officerName"],
    [applicant.officerPosition, "officerPosition"],
    [applicant.officerPhone, "officerPhone"],
  ] as const) {
    if (missing(field)) issue(issues, "PCB_2II", q2, "APPLICANT_FIELD_REQUIRED", label, `Exhibit 3 field ${label} requires applicant-supplied evidence.`);
  }
  validateEmployee(issues, "PCB_2II", q2, input.employees.Q2);
  for (const row of input.pcb2iiTransactions) {
    if (missing(row.pcbReceiptOrTransactionNumber)) issue(issues, "PCB_2II", q2, "PCB_TRANSACTION_REFERENCE_REQUIRED", `${row.month}.pcbReceiptOrTransactionNumber`, "Exhibit 3 contains a PCB receipt/bank-slip/transaction reference column; no evidence was supplied.");
    if (missing(row.pcbReceiptOrTransactionDate)) issue(issues, "PCB_2II", q2, "PCB_TRANSACTION_DATE_REQUIRED", `${row.month}.pcbReceiptOrTransactionDate`, "Exhibit 3 contains a PCB receipt/transaction date column; no evidence was supplied.");
  }

  const byQuestion = Object.fromEntries((["Q1", "Q2", "Q3", "Q4"] as const).map((questionId) => {
    const questionIssues = issues.filter((item) => item.questionId === questionId);
    return [questionId, { ready: questionIssues.length === 0, issues: questionIssues }];
  })) as Record<"Q1" | "Q2" | "Q3" | "Q4", { ready: boolean; issues: P3aIdentityIssue[] }>;

  return {
    ready: issues.length === 0,
    exhibit4Ready: byQuestion.Q1.ready && byQuestion.Q3.ready && byQuestion.Q4.ready,
    exhibit3Ready: byQuestion.Q2.ready,
    byQuestion,
    issues,
  };
}

export function buildP3aIdentitySourceMatrix(input: PcbCertificationIdentityInput) {
  const rows: Array<Record<string, unknown>> = [];
  for (const field of EXHIBIT_4_IDENTITY_FIELDS) {
    rows.push({ artifact: "CP39_EXHIBIT_4", ...field });
  }
  for (const field of EXHIBIT_3_IDENTITY_FIELDS) {
    rows.push({ artifact: "PCB_2II_EXHIBIT_3", ...field });
  }
  for (const [questionId, employee] of Object.entries(input.employees)) {
    for (const [fieldName, field] of Object.entries(employee)) {
      if (fieldName === "employeeLabel" || typeof field === "string") continue;
      rows.push({
        artifact: questionId === "Q2" ? "PCB_2II_EXHIBIT_3" : questionId === "Q5" ? "NOT_REQUIRED" : "CP39_EXHIBIT_4",
        questionId,
        officialField: fieldName,
        currentTetamuField: null,
        certificationFixtureField: `employees.${questionId}.${fieldName}`,
        sourceAvailable: field.value !== null,
        provenance: field.provenance,
        status: field.status,
        officialSource: field.officialSource,
      });
    }
  }
  return rows;
}
