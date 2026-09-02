import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  PCB_2026_CALCULATOR_VERSION,
  PCB_2026_RULE_VERSION,
  calculatePcb2026,
  type PCB2026CalculationInput,
} from "../src/lib/payroll/pcb-2026";
import {
  PCB_2026_INDEPENDENT_VERIFIER_VERSION,
  independentlyVerifyPcb2026,
} from "../tests/certification/pcb-2026-independent-verifier";
import {
  advanceLedger,
  certificationInputDigest,
  monthInput,
  openLedger,
  pcb2026P2Questions,
} from "../tests/certification/pcb-2026-p2-scenarios";

async function main() {
const root = resolve(process.cwd());
const outputRoot = resolve(root, "statutory/official/certifications/pcb-2026-p2");
const generatedAt = new Date().toISOString();
const officialSpecificationSha256 = "a1618051c858393d92d868c9975c183309d3d07e48f0e4f0cdef589f45f5800c";
const hasilQ5ClarificationPath = "statutory/official/certifications/pcb-2026-p2/q5/hasil-clarification-resolution.json";

function digest(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function rm(cents: number) {
  return `RM${(cents / 100).toFixed(2)}`;
}

async function fileSha(path: string) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

const fixtureSha256 = await fileSha(resolve(root, "tests/fixtures/hasil-2026-testing-question-fixtures.ts"));
const calculatorSourceSha256 = await fileSha(resolve(root, "src/lib/payroll/pcb-2026.ts"));
const verifierSourceSha256 = await fileSha(resolve(root, "tests/certification/pcb-2026-independent-verifier.ts"));
const hasilQ5ClarificationSha256 = await fileSha(resolve(root, hasilQ5ClarificationPath));
const q5Definition = pcb2026P2Questions.find((question) => question.question === "Q5");
if (!q5Definition) throw new Error("Q5 certification definition is missing");
const q5HousingAllocation = q5Definition.months.map((month) => ({
  month: `2026-${String(month.month).padStart(2, "0")}`,
  amountCents: month.housingLoanInterestReliefCents ?? 0,
}));
const q5HousingAllocationDigest = digest(q5HousingAllocation);
const allReconciliations: unknown[] = [];
const questionManifests: Array<{
  question: string;
  result: string;
  openAmbiguity: string | null;
  [key: string]: unknown;
}> = [];

await mkdir(outputRoot, { recursive: true });
await mkdir(resolve(outputRoot, "reconciliation"), { recursive: true });

for (const question of pcb2026P2Questions) {
  const questionDirectory = resolve(outputRoot, question.question.toLowerCase());
  await mkdir(questionDirectory, { recursive: true });

  if (question.openAmbiguity) {
    const blocked = {
      question: question.question,
      status: "BLOCKED_BY_OFFICIAL_INTERPRETATION",
      employee: question.employeeLabel,
      sourcePage: question.officialPage,
      sourceSha256: question.officialSourceSha256,
      fixtureSha256,
      requiredMonths: question.requiredMonths,
      monthsCertified: [],
      openAmbiguity: question.openAmbiguity,
      environment: "LOCAL_DISPOSABLE_CERTIFICATION",
      generatedAt,
    };
    await writeFile(resolve(questionDirectory, "reconciliation.json"), `${JSON.stringify(blocked, null, 2)}\n`);
    allReconciliations.push(blocked);
    questionManifests.push({
      question: question.question,
      result: "BLOCKED",
      monthsCertified: [],
      tetamuResultDigest: null,
      independentResultDigest: null,
      difference: null,
      openAmbiguity: question.openAmbiguity,
    });
    continue;
  }

  const ledger = openLedger(question);
  const records = [];
  for (const month of question.months) {
    const input = monthInput(question, month, ledger);
    const independent = independentlyVerifyPcb2026(input);
    const tetamu = calculatePcb2026(input as PCB2026CalculationInput);
    if (tetamu.status !== "CALCULATED") throw new Error(`${question.question}-${month.month} unexpectedly blocked`);

    const differenceCents = tetamu.amountCents - independent.amountCents;
    const intermediate = {
      normalRemunerationCents: { tetamu: tetamu.trace.currentNormalRemunerationCents, independent: input.currentNormalRemunerationCents },
      additionalRemunerationCents: { tetamu: tetamu.trace.currentAdditionalRemunerationCents, independent: input.currentAdditionalRemunerationCents },
      projectedEpfCents: { tetamu: tetamu.trace.normalProjectedEpfCents, independent: independent.trace.projectedEpfWithoutAdditionalCents },
      deductionsCents: { tetamu: tetamu.trace.accumulatedAllowableDeductionsCents + tetamu.trace.currentAllowableDeductionsCents, independent: input.accumulatedAllowableDeductionsCents + input.currentAllowableDeductionsCents },
      chargeableIncomeCents: { tetamu: tetamu.trace.normalBracket.chargeableIncomeCents, independent: independent.trace.normalChargeableIncomeCents },
      taxRatePercent: { tetamu: tetamu.trace.normalBracket.ratePercent, independent: independent.trace.normalRatePercent },
      annualTaxCents: { tetamu: tetamu.trace.normalBracket.annualTaxCents, independent: independent.trace.normalAnnualTaxCents },
      preRoundMtdCents: { tetamu: tetamu.trace.normalRounding.truncatedToSenCents, independent: independent.trace.normalRounding.truncatedToSenCents },
      roundedMtdCents: { tetamu: tetamu.trace.normalRounding.roundedUpToFiveSenCents, independent: independent.trace.normalRounding.roundedUpToFiveSenCents },
      finalPcbCents: { tetamu: tetamu.amountCents, independent: independent.amountCents },
    };
    const intermediatePass = Object.values(intermediate).every((pair) => pair.tetamu === pair.independent);
    const record = {
      question: question.question,
      month: `2026-${String(month.month).padStart(2, "0")}`,
      requiredDocumentMonth: question.requiredMonths.includes(month.month),
      tetamuPcbCents: tetamu.amountCents,
      tetamuPcb: rm(tetamu.amountCents),
      independentPcbCents: independent.amountCents,
      independentPcb: rm(independent.amountCents),
      differenceCents,
      difference: rm(differenceCents),
      result: differenceCents === 0 && intermediatePass ? "PASS" : "FAIL",
      inputDigest: certificationInputDigest(input),
      ruleVersion: PCB_2026_RULE_VERSION,
      calculatorVersion: PCB_2026_CALCULATOR_VERSION,
      independentVerifierVersion: PCB_2026_INDEPENDENT_VERIFIER_VERSION,
      profileRevision: question.profileRevision,
      tetamuTraceDigest: digest(tetamu.trace),
      independentTraceDigest: digest(independent.trace),
      tags: month.tags,
      housingLoanInterestReliefCents: month.housingLoanInterestReliefCents ?? 0,
      otherAllowableDeductionsCents: month.deductionsCents - (month.housingLoanInterestReliefCents ?? 0),
      intermediate,
      tetamuTrace: tetamu.trace,
      independentTrace: independent.trace,
    };
    records.push(record);
    allReconciliations.push(record);
    advanceLedger(ledger, month, independent.amountCents);
  }

  const result = records.every((record) => record.result === "PASS") ? "CERTIFIED" : "FAIL";
  const payload = {
    question: question.question,
    status: result,
    employee: question.employeeLabel,
    sourcePage: question.officialPage,
    sourceSha256: question.officialSourceSha256,
    fixtureSha256,
    requiredMonths: question.requiredMonths,
    monthsCertified: records.map((record) => record.month),
    finalDifference: records.every((record) => record.differenceCents === 0) ? "RM0.00" : "NON_ZERO",
    records,
    hasilClarification: question.question === "Q5" ? {
      status: "RESOLVED_BY_HASIL",
      receivedOn: "2026-08-28",
      referencePath: hasilQ5ClarificationPath,
      sha256: hasilQ5ClarificationSha256,
      annualAmountCents: 600_000,
      monthlyAmountCents: 50_000,
      allocationDigest: q5HousingAllocationDigest,
    } : null,
    environment: "LOCAL_DISPOSABLE_CERTIFICATION",
    generatedAt,
  };
  await writeFile(resolve(questionDirectory, "reconciliation.json"), `${JSON.stringify(payload, null, 2)}\n`);
  questionManifests.push({
    question: question.question,
    result,
    monthsCertified: payload.monthsCertified,
    tetamuResultDigest: digest(records.map((record) => record.tetamuPcbCents)),
    independentResultDigest: digest(records.map((record) => record.independentPcbCents)),
    difference: payload.finalDifference,
    inputDigest: digest(records.map((record) => record.inputDigest)),
    allocationDigest: question.question === "Q5" ? q5HousingAllocationDigest : null,
    openAmbiguity: null,
  });
}

await writeFile(
  resolve(outputRoot, "reconciliation/all.json"),
  `${JSON.stringify({ generatedAt, records: allReconciliations }, null, 2)}\n`,
);

const manifest = {
  certification: "TETAMU PCB 2026 P2 FORMULA & PROFILE CERTIFICATION",
  verdict: questionManifests.every((item) => item.result === "CERTIFIED") ? "READY" : "PARTIAL",
  claimOfHasilApproval: false,
  environment: "LOCAL_DISPOSABLE_CERTIFICATION",
  generatedAt,
  officialSources: {
    computerisedSpecification2026Sha256: officialSpecificationSha256,
    testingQuestions2026Sha256: pcb2026P2Questions[0]?.officialSourceSha256,
    hasilQ5ClarificationSha256,
  },
  fixtureSha256,
  tetamuCalculatorVersion: PCB_2026_CALCULATOR_VERSION,
  tetamuCalculatorSourceSha256: calculatorSourceSha256,
  independentVerifierVersion: PCB_2026_INDEPENDENT_VERIFIER_VERSION,
  independentVerifierSourceSha256: verifierSourceSha256,
  q5HousingLoanInterestAllocation: {
    annualAmountCents: 600_000,
    monthlyAmountCents: 50_000,
    months: q5HousingAllocation,
    allocationDigest: q5HousingAllocationDigest,
    clarificationReferencePath: hasilQ5ClarificationPath,
  },
  questions: questionManifests,
  openAmbiguities: questionManifests
    .filter((item) => item.openAmbiguity)
    .map((item) => ({ question: item.question, ambiguity: item.openAmbiguity })),
};

await writeFile(resolve(outputRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify({ outputRoot, verdict: manifest.verdict, questions: questionManifests }, null, 2));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
