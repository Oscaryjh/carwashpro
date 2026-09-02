import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, relative, resolve } from "node:path";
import { buildTextPdf } from "../src/lib/business-groups/group-report-export";
import {
  buildPayslipPdf,
  type PayrollDocumentEntry,
  type PayrollDocumentRun,
} from "../src/lib/payroll/export";
import {
  buildOfficialSubmissionFile,
  statutorySubmissionFileName,
  type StatutoryBusinessProfile,
  type StatutoryIdentityType,
  type StatutorySubmissionRun,
} from "../src/lib/payroll/statutory-submission";
import {
  buildP3aIdentitySourceMatrix,
  validateP3aCertificationIdentity,
  type CertificationIdentityField,
  type PcbCertificationIdentityInput,
} from "../src/lib/payroll/pcb-certification-identity";

type P2Record = {
  month: string;
  tetamuPcbCents: number;
  tetamuPcb: string;
  difference: string;
  inputDigest: string;
  tetamuTraceDigest: string;
  tags: string[];
  housingLoanInterestReliefCents: number;
  otherAllowableDeductionsCents: number;
  tetamuTrace: P2Trace;
};

type P2Trace = {
  calculatorVersion: string;
  ruleVersion: string;
  taxRegime: string;
  employeeCategory: string;
  priorGrossRemunerationCents: number;
  priorEpfCents: number;
  priorPcbCents: number;
  currentNormalRemunerationCents: number;
  currentNormalEpfCents: number;
  currentAdditionalRemunerationCents: number;
  currentAdditionalEpfCents: number;
  accumulatedAllowableDeductionsCents: number;
  currentAllowableDeductionsCents: number;
  spouseReliefCents: number;
  childReliefCents: number;
  accumulatedZakatCents: number;
  currentZakatCents: number;
  currentReligiousTravelLevyCents: number;
  normalMtdBeforeCurrentRebatesCents: number;
  normalMtdAfterCurrentRebatesCents: number;
  additionalMtdCents: number;
  finalPcbCents: number;
  normalBracket: {
    chargeableIncomeCents: number;
    mCents: number;
    ratePercent: number;
    bCents: number;
    annualTaxCents: number;
  };
  normalRounding: {
    rawNumeratorCents: number;
    rawDivisor: number;
    truncatedToSenCents: number;
    minimumThresholdApplied: boolean;
    roundedUpToFiveSenCents: number;
    postZakatAndLevyCents: number;
  };
  additionalRounding: unknown;
  officialSections: string[];
};

type GeneratedArtifact = {
  type: string;
  status: string;
  files: string[];
  month?: string;
  pcbCents?: number;
  inputDigest?: string;
  generatorVersion: string;
  blocker?: string;
};

type P2Question = {
  employee: string;
  sourceSha256: string;
  fixtureSha256: string;
  records: P2Record[];
};

const root = resolve(process.cwd());
const outputRoot = resolve(root, "statutory/official/certifications/pcb-2026-p3");
const p2Root = resolve(root, "statutory/official/certifications/pcb-2026-p2");
const identityInputPath = resolve(root, "statutory/official/fixtures/pcb-2026-p3a-submission-identity.json");
const generatedAt = new Date().toISOString();
const generatorVersions = {
  package: "TETAMU_PCB_2026_P3_1.0.0",
  calculationDetail: "TETAMU_PCB_CALCULATION_DETAIL_1.0.0",
  payslip: "CANONICAL_PAYSLIP_RENDERER_2026",
  ea: "TETAMU_EA_TESTING_QUESTION_EQUIVALENT_1.0.0",
  pcb2ii: "TETAMU_PCB_2II_EXHIBIT_3_DRAFT_1.0.0",
  cp39: "LHDN_CP39_EXHIBIT_4_2026",
  identityMapping: "TETAMU_PCB_2026_P3A_IDENTITY_1.0.0",
};

const matrix = {
  Q1: { calculationDetail: ["2026-07", "2026-10"], payslip: ["2026-07", "2026-12"], ea: true, pcb2ii: false, textFile: ["2026-10"] },
  Q2: { calculationDetail: ["2026-03", "2026-09"], payslip: ["2026-03"], ea: false, pcb2ii: true, textFile: [] },
  Q3: { calculationDetail: ["2026-09", "2026-11"], payslip: ["2026-09"], ea: false, pcb2ii: false, textFile: ["2026-11"] },
  Q4: { calculationDetail: ["2026-08", "2026-11"], payslip: ["2026-10", "2026-12"], ea: true, pcb2ii: false, textFile: ["2026-12"] },
  Q5: { calculationDetail: ["2026-01", "2026-02"], payslip: ["2026-01"], ea: false, pcb2ii: false, textFile: [] },
} as const;

const cashFacts: Record<string, Record<string, {
  earnings: Array<{ name: string; amountCents: number }>;
  epfCents: number;
  zakatCents: number;
  notes: string;
}>> = {
  Q1: {
    "2026-07": { earnings: [{ name: "Basic salary", amountCents: 2_000_000 }, { name: "Travel allowance (cash)", amountCents: 50_000 }], epfCents: 220_000, zakatCents: 100_000, notes: "RM500 travel allowance is cash paid but exempt for PCB in this month. Previous-employer TP3 facts are not current earnings." },
    "2026-12": { earnings: [{ name: "Basic salary", amountCents: 2_000_000 }, { name: "Travel allowance (cash)", amountCents: 50_000 }], epfCents: 220_000, zakatCents: 100_000, notes: "RM500 travel allowance is cash paid and taxable for PCB in this month. TP1 self-paid relief is not a payroll deduction." },
  },
  Q2: {
    "2026-03": { earnings: [{ name: "Director fee (non-monthly)", amountCents: 10_000_000 }], epfCents: 0, zakatCents: 1_200_000, notes: "Voluntary EPF is a TP1 relief input, not a payroll EPF deduction. Director fee is additional remuneration." },
  },
  Q3: {
    "2026-09": { earnings: [{ name: "Basic salary", amountCents: 1_050_000 }], epfCents: 110_000, zakatCents: 0, notes: "RM500 allocated BIK is non-cash taxable remuneration and is not included in cash gross or net pay." },
  },
  Q4: {
    "2026-10": { earnings: [{ name: "Basic salary", amountCents: 1_000_000 }], epfCents: 0, zakatCents: 0, notes: "RM1,000 VOLA is non-cash taxable remuneration. EPF participation is off through October." },
    "2026-12": { earnings: [{ name: "Basic salary", amountCents: 1_500_000 }], epfCents: 165_000, zakatCents: 0, notes: "RM1,500 VOLA is non-cash taxable remuneration. EPF participation is on from November." },
  },
  Q5: {
    "2026-01": { earnings: [{ name: "Basic salary", amountCents: 1_800_000 }], epfCents: 198_000, zakatCents: 0, notes: "RM500 housing-loan interest is a certified monthly relief input and is not a payroll deduction." },
  },
};

function sha(value: Buffer | string) {
  return createHash("sha256").update(value).digest("hex");
}

function money(cents: number | null | undefined) {
  return cents == null ? "Not applicable" : `RM${(cents / 100).toFixed(2)}`;
}

function monthLabel(month: string) {
  return new Intl.DateTimeFormat("en-MY", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${month}-01T00:00:00Z`));
}

function safeJson(value: unknown) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function identityValue(field: CertificationIdentityField) {
  return field.value?.trim() ?? "";
}

function repositoryPath(path: string) {
  return relative(root, path).replaceAll("\\", "/");
}

async function writeJson(path: string, value: unknown) {
  await mkdir(resolve(path, ".."), { recursive: true });
  await writeFile(path, safeJson(value));
}

async function writePdf(path: string, lines: string[]) {
  await mkdir(resolve(path, ".."), { recursive: true });
  await writeFile(path, buildTextPdf(lines.filter((line) => line !== undefined)));
}

function recordFor(question: P2Question, month: string) {
  const record = question.records.find((item) => item.month === month);
  if (!record) throw new Error(`P2 record missing for ${question.employee} ${month}`);
  if (record.difference !== "RM0.00") throw new Error(`P2 evidence inconsistency for ${question.employee} ${month}`);
  return record;
}

function calculationSource(questionId: string, question: P2Question, record: P2Record) {
  const t = record.tetamuTrace;
  const priorEmployerGross = questionId === "Q1" ? 6_000_000 : 0;
  const priorEmployerEpf = questionId === "Q1" ? 660_000 : 0;
  const priorEmployerPcb = questionId === "Q1" ? 300_000 : 0;
  const currentEmployerPriorGross = Math.max(0, t.priorGrossRemunerationCents - priorEmployerGross);
  return {
    artifactType: "CALCULATION_DETAIL",
    status: "CERTIFICATION_READY",
    questionId,
    employeeLabel: question.employee,
    month: record.month,
    source: {
      officialTestingQuestionSha256: question.sourceSha256,
      fixtureSha256: question.fixtureSha256,
      p2InputDigest: record.inputDigest,
      p2TraceDigest: record.tetamuTraceDigest,
      calculatorVersion: t.calculatorVersion,
      ruleVersion: t.ruleVersion,
    },
    facts: {
      taxRegime: t.taxRegime,
      employeeCategory: t.employeeCategory,
      normalRemunerationCents: t.currentNormalRemunerationCents,
      additionalRemunerationCents: t.currentAdditionalRemunerationCents,
      nonCashOrExemptContext: record.tags,
      currentEmployerYtdBeforeCurrentCents: currentEmployerPriorGross,
      previousEmployerRemunerationCents: priorEmployerGross,
      previousEmployerEpfCents: priorEmployerEpf,
      previousEmployerPcbCents: priorEmployerPcb,
      currentNormalEpfCents: t.currentNormalEpfCents,
      currentAdditionalEpfCents: t.currentAdditionalEpfCents,
      accumulatedTp1DeductionsCents: t.accumulatedAllowableDeductionsCents,
      currentTp1DeductionsCents: t.currentAllowableDeductionsCents,
      housingLoanInterestReliefCents: record.housingLoanInterestReliefCents,
      spouseReliefCents: t.spouseReliefCents,
      childReliefCents: t.childReliefCents,
      chargeableIncomeCents: t.normalBracket.chargeableIncomeCents,
      bracketMCents: t.normalBracket.mCents,
      taxRatePercent: t.normalBracket.ratePercent,
      bracketBCents: t.normalBracket.bCents,
      annualTaxCents: t.normalBracket.annualTaxCents,
      accumulatedZakatCents: t.accumulatedZakatCents,
      currentZakatCents: t.currentZakatCents,
      currentReligiousTravelLevyCents: t.currentReligiousTravelLevyCents,
      normalPcbBeforeCurrentRebatesCents: t.normalMtdBeforeCurrentRebatesCents,
      normalPcbAfterCurrentRebatesCents: t.normalMtdAfterCurrentRebatesCents,
      additionalPcbCents: t.additionalMtdCents,
      finalPcbCents: t.finalPcbCents,
    },
    rounding: {
      rawNumeratorCents: t.normalRounding.rawNumeratorCents,
      divisor: t.normalRounding.rawDivisor,
      truncatedToSenCents: t.normalRounding.truncatedToSenCents,
      minimumThresholdApplied: t.normalRounding.minimumThresholdApplied,
      roundedUpToFiveSenCents: t.normalRounding.roundedUpToFiveSenCents,
      postZakatAndLevyCents: t.normalRounding.postZakatAndLevyCents,
      additional: t.additionalRounding,
    },
    officialSections: t.officialSections,
    generatedAt,
    environment: "LOCAL_DISPOSABLE_CERTIFICATION",
    productionTouched: false,
  };
}

function calculationLines(source: ReturnType<typeof calculationSource>) {
  const f = source.facts;
  const r = source.rounding;
  return [
    "TETAMU PAYROLL",
    "PCB 2026 COMPUTERISED CALCULATION DETAIL",
    "LOCAL CERTIFICATION EVIDENCE - HASiL APPROVAL PENDING",
    "",
    `Question: ${source.questionId}`,
    `Employee: ${source.employeeLabel}`,
    `Month: ${monthLabel(source.month)}`,
    `Tax regime: ${f.taxRegime}`,
    `Employee category: ${f.employeeCategory}`,
    "",
    "REMUNERATION AND GOVERNED INPUTS",
    `Normal remuneration: ${money(f.normalRemunerationCents)}`,
    `Additional remuneration: ${money(f.additionalRemunerationCents)}`,
    `Current-employer YTD before current month: ${money(f.currentEmployerYtdBeforeCurrentCents)}`,
    `Previous-employer remuneration: ${money(f.previousEmployerRemunerationCents)}`,
    `Previous-employer EPF: ${money(f.previousEmployerEpfCents)}`,
    `Previous-employer PCB: ${money(f.previousEmployerPcbCents)}`,
    `Current normal EPF input: ${money(f.currentNormalEpfCents)}`,
    `Current additional EPF input: ${money(f.currentAdditionalEpfCents)}`,
    `Accumulated TP1 deductions: ${money(f.accumulatedTp1DeductionsCents)}`,
    `Current TP1 deductions: ${money(f.currentTp1DeductionsCents)}`,
    ...(f.housingLoanInterestReliefCents ? [`Housing-loan interest relief: ${money(f.housingLoanInterestReliefCents)}`] : []),
    `Scenario context: ${f.nonCashOrExemptContext.join("; ") || "None"}`,
    "",
    "RELIEFS, TAX AND REBATES",
    `Spouse relief: ${money(f.spouseReliefCents)}`,
    `Child relief: ${money(f.childReliefCents)}`,
    `Chargeable income: ${money(f.chargeableIncomeCents)}`,
    `Tax bracket M: ${money(f.bracketMCents)}`,
    `Tax rate: ${f.taxRatePercent}%`,
    `Tax bracket B: ${money(f.bracketBCents)}`,
    `Annual tax: ${money(f.annualTaxCents)}`,
    `Accumulated zakat: ${money(f.accumulatedZakatCents)}`,
    `Current zakat: ${money(f.currentZakatCents)}`,
    `Current religious travel levy: ${money(f.currentReligiousTravelLevyCents)}`,
    "",
    "PCB AND ROUNDING TRACE",
    `Raw numerator: ${money(r.rawNumeratorCents)}`,
    `Divisor: ${r.divisor}`,
    `Truncated to sen: ${money(r.truncatedToSenCents)}`,
    `Minimum threshold applied: ${r.minimumThresholdApplied ? "YES" : "NO"}`,
    `Rounded up to 5 sen: ${money(r.roundedUpToFiveSenCents)}`,
    `Post-zakat/levy normal PCB: ${money(r.postZakatAndLevyCents)}`,
    `Current normal PCB before rebates: ${money(f.normalPcbBeforeCurrentRebatesCents)}`,
    `Current normal PCB after rebates: ${money(f.normalPcbAfterCurrentRebatesCents)}`,
    `Additional remuneration PCB: ${money(f.additionalPcbCents)}`,
    `FINAL PCB: ${money(f.finalPcbCents)}`,
    "",
    `P2 trace digest: ${source.source.p2TraceDigest}`,
    "This evidence is derived from the certified P2 trace. It is not proof of HASiL approval.",
  ];
}

function payslipDocument(questionId: string, question: P2Question, month: string, record: P2Record) {
  const fact = cashFacts[questionId]?.[month];
  if (!fact) throw new Error(`Cash payslip mapping missing for ${questionId} ${month}`);
  const grossCents = fact.earnings.reduce((sum, item) => sum + item.amountCents, 0);
  const pcbCents = record.tetamuPcbCents;
  const netCents = grossCents - fact.epfCents - fact.zakatCents - pcbCents;
  const entry: PayrollDocumentEntry = {
    id: `${questionId}-${month}`,
    employeeCode: questionId,
    fullName: question.employee,
    payBasis: "MONTHLY",
    attendanceDays: 0,
    regularMinutes: 0,
    overtimeMinutes: 0,
    publicHolidayMinutes: 0,
    basicPay: (fact.earnings.find((item) => item.name === "Basic salary")?.amountCents ?? 0) / 100,
    overtimePay: 0,
    publicHolidayPay: 0,
    allowances: 0,
    otherDeductions: fact.zakatCents / 100,
    epfEmployee: fact.epfCents / 100,
    socsoEmployee: 0,
    eisEmployee: 0,
    lindung24Employee: 0,
    pcb: pcbCents / 100,
    cp38: 0,
    employerEpf: 0,
    employerSocso: 0,
    employerEis: 0,
    grossPay: grossCents / 100,
    netPay: netCents / 100,
    statutoryStatus: "CERTIFICATION EVIDENCE",
    statutoryRuleVersion: record.tetamuTrace.ruleVersion,
    notes: `${fact.notes} SOCSO/EIS/employer contributions are not supplied by the official question and are shown as RM0.00, not certified contributions.`,
    components: [
      ...fact.earnings.map((item) => ({ name: item.name, type: "EARNING" as const, amount: item.amountCents / 100 })),
      ...(fact.zakatCents ? [{ name: "Zakat deducted from remuneration", type: "DEDUCTION" as const, amount: fact.zakatCents / 100 }] : []),
    ],
    statutoryEvidenceNature: "SYNTHETIC_TESTING",
    statutoryEvidenceEnvironment: "LOCAL",
    statutoryFixturePurpose: "PAYROLL_PAYSLIP_UAT",
    officialStatutoryExportEligible: false,
  };
  const start = new Date(`${month}-01T00:00:00Z`);
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0));
  const run: Omit<PayrollDocumentRun, "entries"> = {
    id: `${questionId}-${month}`,
    business: { name: "Tetamu Payroll - PCB 2026 Certification", companyNo: null, address: "Local certification evidence", phone: null, email: null },
    periodStart: start,
    periodEnd: end,
    status: "FINALIZED",
    submittedAt: null,
    finalizedAt: new Date("2026-08-29T00:00:00Z"),
  };
  return { pdf: buildPayslipPdf(run, entry), source: { questionId, employeeLabel: question.employee, month, grossCents, epfCents: fact.epfCents, zakatCents: fact.zakatCents, pcbCents, netCents, p2TraceDigest: record.tetamuTraceDigest, notes: fact.notes, renderer: generatorVersions.payslip, environment: "LOCAL_DISPOSABLE_CERTIFICATION", productionTouched: false } };
}

async function main() {
  await mkdir(outputRoot, { recursive: true });
  const p2ManifestBytes = await readFile(resolve(p2Root, "manifest.json"));
  const p2Manifest = JSON.parse(p2ManifestBytes.toString("utf8"));
  if (p2Manifest.verdict !== "READY") throw new Error("P2 certification is not READY");
  const p2CertificationDigest = sha(p2ManifestBytes);
  const identityInputBytes = await readFile(identityInputPath);
  const identityInput = JSON.parse(identityInputBytes.toString("utf8")) as PcbCertificationIdentityInput;
  const identityValidation = validateP3aCertificationIdentity(identityInput);
  const identitySourceMatrix = buildP3aIdentitySourceMatrix(identityInput);
  const questionManifests: Array<{ questionId: string; employeeLabel: string; verdict: string }> = [];
  const generatedFiles: string[] = [];
  const identityMatrixPath = resolve(outputRoot, "manifest/identity-source-matrix.json");
  const identityValidationPath = resolve(outputRoot, "manifest/identity-validation.json");
  await writeJson(identityMatrixPath, {
    authority: [
      "HASiL Computerised Calculation Specification 2026 Exhibit 3, printed page 42",
      "HASiL Computerised Calculation Specification 2026 Exhibits 4-5, printed pages 43-44",
      "HASiL MTD Testing Questions 2026",
    ],
    rows: identitySourceMatrix,
    generatedAt,
    environment: "LOCAL_DISPOSABLE_CERTIFICATION",
    productionTouched: false,
  });
  await writeJson(identityValidationPath, {
    validator: generatorVersions.identityMapping,
    identityInputSha256: sha(identityInputBytes),
    ...identityValidation,
    generatedAt,
    environment: "LOCAL_DISPOSABLE_CERTIFICATION",
    productionTouched: false,
  });
  generatedFiles.push(identityMatrixPath, identityValidationPath);

  for (const questionId of Object.keys(matrix) as Array<keyof typeof matrix>) {
    const spec = matrix[questionId];
    const question = JSON.parse(await readFile(resolve(p2Root, questionId.toLowerCase(), "reconciliation.json"), "utf8")) as P2Question;
    const questionRoot = resolve(outputRoot, questionId.toLowerCase());
    const artifacts: GeneratedArtifact[] = [];
    const identityResult = questionId === "Q5" ? null : identityValidation.byQuestion[questionId];

    await writeJson(resolve(questionRoot, "inputs/p2-binding.json"), {
      questionId,
      employeeLabel: question.employee,
      officialSourceSha256: question.sourceSha256,
      fixtureSha256: question.fixtureSha256,
      p2CertificationDigest,
      sourcePath: `statutory/official/certifications/pcb-2026-p2/${questionId.toLowerCase()}/reconciliation.json`,
      environment: "LOCAL_DISPOSABLE_CERTIFICATION",
      productionTouched: false,
    });

    for (const month of spec.calculationDetail) {
      const record = recordFor(question, month);
      const source = calculationSource(questionId, question, record);
      const jsonPath = resolve(questionRoot, "calculation-detail", `${questionId.toLowerCase()}-${month}-calculation-detail.json`);
      const pdfPath = jsonPath.replace(/\.json$/, ".pdf");
      await writeJson(jsonPath, source);
      await writePdf(pdfPath, calculationLines(source));
      artifacts.push({ type: "CALCULATION_DETAIL", month, status: "CERTIFICATION_READY", files: [jsonPath, pdfPath], pcbCents: record.tetamuPcbCents, inputDigest: record.inputDigest, generatorVersion: generatorVersions.calculationDetail });
      generatedFiles.push(jsonPath, pdfPath);
    }

    for (const month of spec.payslip) {
      const record = recordFor(question, month);
      const rendered = payslipDocument(questionId, question, month, record);
      const sourcePath = resolve(questionRoot, "payslip", `${questionId.toLowerCase()}-${month}-payslip.json`);
      const pdfPath = sourcePath.replace(/\.json$/, ".pdf");
      await writeJson(sourcePath, rendered.source);
      await writeFile(pdfPath, rendered.pdf);
      artifacts.push({ type: "PAYSLIP", month, status: "CERTIFICATION_READY", files: [sourcePath, pdfPath], pcbCents: record.tetamuPcbCents, inputDigest: record.inputDigest, generatorVersion: generatorVersions.payslip });
      generatedFiles.push(sourcePath, pdfPath);
    }

    if (spec.ea) {
      const records = question.records;
      const q1 = questionId === "Q1";
      const source = {
        artifactType: "EA_TESTING_QUESTION_EVIDENCE",
        status: "CERTIFICATION_READY_SYSTEM_EQUIVALENT",
        label: "EA - Testing Question Evidence (SYSTEM-GENERATED EQUIVALENT)",
        questionId,
        employeeLabel: question.employee,
        employerIdentity: "Not supplied by official testing question",
        employeeOfficialIdentity: "Not supplied by official testing question",
        employmentPeriod: q1 ? "2026-07-01 to 2026-12-31" : "2026-08-01 to 2026-12-31",
        currentEmployerCashRemunerationCents: q1 ? 12_300_000 : 6_000_000,
        taxableBenefitsCents: q1 ? 0 : 600_000,
        exemptAllowancesCents: q1 ? 200_000 : 0,
        employeeEpfCents: q1 ? 1_320_000 : 330_000,
        pcbCents: records.reduce((sum, item) => sum + item.tetamuPcbCents, 0),
        zakatDeductedFromRemunerationCents: q1 ? 600_000 : 0,
        previousEmployerAmountsIncluded: false,
        sourceP2TraceDigests: records.map((item) => item.tetamuTraceDigest),
        limitation: "Exact official EA machine template is not retained. This equivalent covers only Q1/Q4 scenario evidence and does not claim generic EA compliance.",
        generatedAt,
        environment: "LOCAL_DISPOSABLE_CERTIFICATION",
        productionTouched: false,
      };
      const jsonPath = resolve(questionRoot, "ea", `${questionId.toLowerCase()}-ea-testing-question-evidence.json`);
      const pdfPath = jsonPath.replace(/\.json$/, ".pdf");
      await writeJson(jsonPath, source);
      await writePdf(pdfPath, [
        "TETAMU PAYROLL", "EA - TESTING QUESTION EVIDENCE", "SYSTEM-GENERATED EQUIVALENT", "HASiL APPROVAL PENDING", "",
        `Question: ${questionId}`, `Employee: ${question.employee}`, `Employment period: ${source.employmentPeriod}`,
        `Employer identity: ${source.employerIdentity}`, `Employee official identity: ${source.employeeOfficialIdentity}`, "",
        `Current-employer cash remuneration: ${money(source.currentEmployerCashRemunerationCents)}`,
        `Taxable benefits (BIK/VOLA): ${money(source.taxableBenefitsCents)}`,
        `Exempt allowances: ${money(source.exemptAllowancesCents)}`,
        `Employee EPF: ${money(source.employeeEpfCents)}`,
        `PCB for current-employer period: ${money(source.pcbCents)}`,
        `Zakat deducted from remuneration: ${money(source.zakatDeductedFromRemunerationCents)}`,
        "Previous-employer amounts included: NO", "", source.limitation,
      ]);
      artifacts.push({ type: "EA", status: "CERTIFICATION_READY_SYSTEM_EQUIVALENT", files: [jsonPath, pdfPath], pcbCents: source.pcbCents, generatorVersion: generatorVersions.ea });
      generatedFiles.push(jsonPath, pdfPath);
    }

    if (spec.pcb2ii) {
      const employee = identityInput.employees.Q2;
      const applicant = identityInput.applicant;
      const ready = identityValidation.byQuestion.Q2.ready;
      const source = {
        artifactType: "PCB_2II_EXHIBIT_3",
        status: ready ? "CERTIFICATION_READY" : "WAITING_FOR_APPLICANT_IDENTITY_AND_TRANSACTION_EVIDENCE",
        questionId,
        employeeLabel: question.employee,
        hasilBranch: identityValue(applicant.hasilBranch) || null,
        statementDate: identityValue(applicant.statementDate) || null,
        employeeIdentityType: identityValue(employee.identityType) || null,
        employeeIdentity: identityValue(employee.identityNumber) || null,
        employeeTin: identityValue(employee.taxIdentificationNumber) || null,
        employeeNumber: identityValue(employee.employeeNumber) || null,
        employerNumber: identityValue(applicant.lhdnEmployerNumber) || null,
        employerNameAndAddress: [identityValue(applicant.employerName), identityValue(applicant.employerAddress)].filter(Boolean).join(", ") || null,
        officer: {
          name: identityValue(applicant.officerName) || null,
          position: identityValue(applicant.officerPosition) || null,
          phone: identityValue(applicant.officerPhone) || null,
        },
        deductions: question.records.map((item) => {
          const transaction = identityInput.pcb2iiTransactions.find((candidate) => candidate.month === item.month);
          return {
            month: item.month,
            pcbCents: item.tetamuPcbCents,
            cp38Cents: 0,
            pcbReceiptOrTransactionNumber: transaction ? identityValue(transaction.pcbReceiptOrTransactionNumber) || null : null,
            pcbReceiptOrTransactionDate: transaction ? identityValue(transaction.pcbReceiptOrTransactionDate) || null : null,
            cp38ReceiptOrTransactionNumber: null,
            cp38ReceiptOrTransactionDate: null,
          };
        }),
        authority: "HASiL Computerised Calculation Specification 2026 Exhibit 3, page 42 (PDF page 43)",
        identityProvenance: employee,
        unresolvedIdentityInputs: identityValidation.byQuestion.Q2.issues,
        blocker: ready ? null : "Official Q2 omits mandatory employee/applicant identities and the applicant has not supplied Exhibit 3 transaction evidence. Values were not invented.",
        generatedAt,
        environment: "LOCAL_DISPOSABLE_CERTIFICATION",
        productionTouched: false,
      };
      const jsonPath = resolve(questionRoot, "pcb-2ii", "q2-pcb-2ii-structured-source.json");
      const pdfPath = resolve(questionRoot, "pcb-2ii", "q2-pcb-2ii-blocked-draft.pdf");
      await writeJson(jsonPath, source);
      await writePdf(pdfPath, ready ? [
        "PENYATA BAYARAN CUKAI OLEH MAJIKAN", "PCB 2(II)-Pin. 2012 - TESTING QUESTION EVIDENCE", "HASiL APPROVAL PENDING", "",
        `Cawangan: ${source.hasilBranch}`, `Tarikh: ${source.statementDate}`, "Potongan Cukai Yang Dibuat Dalam Tahun: 2026",
        `Nama Pekerja: ${question.employee}`, `No. Kad Pengenalan/No. Passpot: ${source.employeeIdentity}`,
        `No. Pengenalan Cukai Pekerja (IG): ${source.employeeTin}`, `No. Pekerja: ${source.employeeNumber}`,
        `No. Majikan (E): ${source.employerNumber}`, "", "POTONGAN TAHUN SEMASA",
        ...source.deductions.map((item) => `${item.month} | PCB ${money(item.pcbCents)} | CP38 ${money(item.cp38Cents)} | PCB Ref ${item.pcbReceiptOrTransactionNumber} | PCB Date ${item.pcbReceiptOrTransactionDate}`),
        "", `Nama pegawai: ${source.officer.name}`, `Jawatan: ${source.officer.position}`, `No. Telefon: ${source.officer.phone}`,
        `Nama Dan Alamat Majikan: ${source.employerNameAndAddress}`,
      ] : [
        "PCB 2(II) - TESTING QUESTION EVIDENCE DRAFT", "NOT CERTIFICATION READY", "",
        `Employee: ${question.employee}`, "Employee identity: NOT SUPPLIED", "Employee TIN: NOT SUPPLIED", "Employee number: NOT SUPPLIED", "Employer number: NOT SUPPLIED", "",
        ...source.deductions.map((item) => `${item.month} | PCB ${money(item.pcbCents)} | CP38 ${money(item.cp38Cents)}`),
        "", source.blocker ?? "Identity input required.",
      ]);
      artifacts.push({ type: "PCB_2II", status: source.status, files: [jsonPath, pdfPath], generatorVersion: generatorVersions.pcb2ii, blocker: source.blocker ?? undefined });
      generatedFiles.push(jsonPath, pdfPath);
    }

    for (const month of spec.textFile) {
      const record = recordFor(question, month);
      const questionKey = questionId as "Q1" | "Q3" | "Q4";
      const ready = identityValidation.byQuestion[questionKey].ready;
      if (ready) {
        const applicant = identityInput.applicant;
        const employee = identityInput.employees[questionKey];
        const profile: StatutoryBusinessProfile = {
          epfEmployerNumber: null,
          perkesoEmployerCode: null,
          perkesoRegistrationNumber: null,
          lhdnEmployerNumberHq: identityValue(applicant.lhdnEmployerNumberHq),
          lhdnEmployerNumber: identityValue(applicant.lhdnEmployerNumber),
        };
        const run: StatutorySubmissionRun = {
          id: `${questionId}-${month}-certification`,
          status: "FINALIZED",
          periodStart: new Date(`${month}-01T00:00:00Z`),
          entries: [{
            id: `${questionId}-${month}`,
            membershipId: `${questionId}-certification-identity`,
            employeeCode: identityValue(employee.employeeNumber),
            fullName: identityValue(employee.fullName),
            epfWageBase: 0,
            perkesoWageBase: 0,
            epfEmployee: 0,
            employerEpf: 0,
            socsoEmployee: 0,
            employerSocso: 0,
            eisEmployee: 0,
            employerEis: 0,
            lindung24Employee: 0,
            pcb: record.tetamuPcbCents / 100,
            cp38: 0,
            membership: {
              statutoryIdentityType: identityValue(employee.identityType) as StatutoryIdentityType,
              statutoryIdentityNumber: identityValue(employee.identityNumber),
              statutoryCountryCode: identityValue(employee.passportCountryCode) || null,
              epfMemberNumber: null,
              socsoMemberNumber: null,
              taxIdentificationNumber: identityValue(employee.taxIdentificationNumber),
            },
          }],
        };
        const bytes = buildOfficialSubmissionFile("PCB", profile, run);
        const canonicalName = statutorySubmissionFileName("PCB", profile, run);
        const textPath = resolve(questionRoot, "text-file", canonicalName);
        const previewPath = resolve(questionRoot, "text-file", `${questionId.toLowerCase()}-${month}-cp39-preview.pdf`);
        await mkdir(resolve(textPath, ".."), { recursive: true });
        await writeFile(textPath, bytes);
        const rawLines = bytes.toString("utf8").replace(/\r\n$/, "").split("\r\n");
        await writePdf(previewPath, [
          "TETAMU PAYROLL", "HASiL CP39 / EXHIBIT 4 TEXT FILE PREVIEW", "HASiL APPROVAL PENDING", "",
          `Question: ${questionId}`, `Employee: ${question.employee}`, `Month: ${monthLabel(month)}`,
          `Raw file: ${canonicalName}`, `Raw SHA-256: ${sha(bytes)}`, "", "FIXED-WIDTH CONTENT",
          ...rawLines, "", `Header characters: ${rawLines[0]?.length ?? 0}`, `Detail characters: ${rawLines[1]?.length ?? 0}`,
          `PCB: ${money(record.tetamuPcbCents)}`, "CP38: RM0.00",
        ]);
        artifacts.push({ type: "CP39_TEXT_FILE", month, status: "CERTIFICATION_READY", files: [textPath, previewPath], pcbCents: record.tetamuPcbCents, generatorVersion: generatorVersions.cp39 });
        generatedFiles.push(textPath, previewPath);
        continue;
      }
      const blocker = {
        artifactType: "CP39_TEXT_FILE",
        status: "BLOCKED_MISSING_OFFICIAL_IDENTITIES",
        questionId,
        month,
        employeeLabel: question.employee,
        p2PcbCents: record.tetamuPcbCents,
        cp38Cents: 0,
        requiredFormat: generatorVersions.cp39,
        missingRequiredFields: identityValidation.byQuestion[questionKey].issues.map((item) => ({ code: item.code, field: item.field, detail: item.detail })),
        identityProvenance: identityInput.employees[questionKey],
        blocker: "The retained official question does not provide mandatory Exhibit 4 identity fields, applicant employer numbers are absent, and the retained country-code list is incomplete. The canonical exporter was intentionally not called with invented identifiers.",
        generatedAt,
        environment: "LOCAL_DISPOSABLE_CERTIFICATION",
        productionTouched: false,
      };
      const blockerPath = resolve(questionRoot, "text-file", `${questionId.toLowerCase()}-${month}-cp39-blocker.json`);
      await writeJson(blockerPath, blocker);
      artifacts.push({ type: "CP39_TEXT_FILE", month, status: blocker.status, files: [blockerPath], pcbCents: record.tetamuPcbCents, generatorVersion: generatorVersions.cp39, blocker: blocker.blocker });
      generatedFiles.push(blockerPath);
    }

    const filesWithHashes = [];
    for (const artifact of artifacts) {
      for (const file of artifact.files) {
        const bytes = await readFile(file);
        filesWithHashes.push({ filename: basename(file), repositoryPath: relative(root, file).replaceAll("\\", "/"), bytes: bytes.length, sha256: sha(bytes), artifactType: artifact.type, month: artifact.month ?? null, status: artifact.status, inputDigest: artifact.inputDigest ?? null, generatorVersion: artifact.generatorVersion });
      }
    }
    const manifest = {
      questionId,
      employeeLabel: question.employee,
      officialSourceSha256: question.sourceSha256,
      fixtureSha256: question.fixtureSha256,
      p2CertificationDigest,
      calculatorVersion: p2Manifest.tetamuCalculatorVersion,
      independentVerifierVersion: p2Manifest.independentVerifierVersion,
      requiredArtifacts: spec,
      identitySource: `statutory/official/fixtures/pcb-2026-p3a-submission-identity.json`,
      identityInputSha256: sha(identityInputBytes),
      identityStatus: identityResult == null ? "NOT_REQUIRED" : identityResult.ready ? "COMPLETE" : "INPUT_REQUIRED",
      requiredIdentityFields: identityResult?.issues.map((item) => item.field) ?? [],
      unresolvedIdentityInputs: identityResult?.issues ?? [],
      generatedArtifacts: artifacts.map(({ files, ...artifact }) => ({ ...artifact, files: files.map((file: string) => relative(root, file).replaceAll("\\", "/")) })),
      artifactSha256: filesWithHashes,
      generationTimestamp: generatedAt,
      environment: "LOCAL_DISPOSABLE_CERTIFICATION",
      productionTouched: false,
      verdict: artifacts.every((artifact) => String(artifact.status).startsWith("CERTIFICATION_READY")) ? "READY" : "PARTIAL",
    };
    const manifestPath = resolve(questionRoot, "manifest", "manifest.json");
    await writeJson(manifestPath, manifest);
    generatedFiles.push(manifestPath);
    questionManifests.push(manifest);
  }

  const coverPath = resolve(outputRoot, "shared", "tetamu-pcb-2026-p3-cover-sheet.pdf");
  await writePdf(coverPath, [
    "TETAMU PAYROLL", "PCB 2026 COMPUTERISED CALCULATION VERIFICATION", "QUESTION 1-5 ARTIFACT PACKAGE", "",
    "Environment: LOCAL certification", "Calculation authority: PCB 2026 P2 certified results", "HASiL submission: NO", "HASiL approval: PENDING", "Production touched: NO", "",
    "Package status: PARTIAL", "Reason: governed P3A mapping is ready, but applicant/employer and Employee A-D statutory identities are not supplied. The retained HASiL passport country-code list is also absent. CP39 and final PCB 2(II) were not fabricated.", "",
    "All generated calculation details and payslips reconcile to P2 with RM0.00 difference.",
  ]);
  generatedFiles.push(coverPath);

  const allFiles = [];
  for (const file of generatedFiles) {
    const bytes = await readFile(file);
    allFiles.push({ repositoryPath: relative(root, file).replaceAll("\\", "/"), bytes: bytes.length, sha256: sha(bytes) });
  }
  const master = {
    certification: "TETAMU PCB 2026 P3 OFFICIAL QUESTION ARTIFACT PREPARATION",
    verdict: questionManifests.every((item) => item.verdict === "READY") ? "READY" : "PARTIAL",
    environment: "LOCAL_DISPOSABLE_CERTIFICATION",
    isolatedWorktree: true,
    productionTouched: false,
    testingBusinessDataChanged: false,
    p2CertificationDigest,
    officialSources: p2Manifest.officialSources,
    generatorVersions,
    identitySource: {
      repositoryPath: repositoryPath(identityInputPath),
      sha256: sha(identityInputBytes),
      status: identityValidation.ready ? "COMPLETE" : "INPUT_REQUIRED",
      exhibit4Ready: identityValidation.exhibit4Ready,
      exhibit3Ready: identityValidation.exhibit3Ready,
      unresolvedIdentityInputs: identityValidation.issues,
      provenanceRequired: true,
    },
    officialArtifactMatrix: matrix,
    questions: questionManifests.map((item) => ({ questionId: item.questionId, employeeLabel: item.employeeLabel, verdict: item.verdict, manifestPath: `statutory/official/certifications/pcb-2026-p3/${item.questionId.toLowerCase()}/manifest/manifest.json` })),
    artifacts: allFiles,
    openClarifications: [
      { code: "APPLICANT_AND_EMPLOYEE_IDENTITY_INPUT_REQUIRED", affects: ["Q1 CP39", "Q2 PCB 2(II)", "Q3 CP39", "Q4 CP39"], detail: "Governed mapping and strict validation are implemented. Applicant employer data, Employee A-D submission identities and Q2 transaction evidence are not supplied. No values were invented." },
      { code: "HASIL_COUNTRY_CODE_LIST_NOT_RETAINED", affects: ["Q4 CP39"], detail: "Exhibit 4 requires the passport-issuing country code from a HASiL list, but the retained specification only refers to the list and does not include it." },
      { code: "SUBMISSION_FORMAT_CLARIFICATION_STILL_REQUIRED", affects: ["Q1 CP39", "Q3 CP39", "Q4 CP39"], detail: "HASiL email asks for PDF documents while the Testing Questions require text files. Preserve raw text plus PDF preview after identity mapping is supplied." },
    ],
    submissionStatus: "NOT_SUBMITTED",
    claimOfHasilApproval: false,
    generatedAt,
  };
  await writeJson(resolve(outputRoot, "manifest.json"), master);
  console.log(JSON.stringify({ outputRoot, verdict: master.verdict, artifactFiles: allFiles.length, questions: master.questions }, null, 2));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
