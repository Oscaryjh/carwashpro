import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

const packagePath = "statutory/official/certifications/tetamu-pcb-2026-engineering-closure.json";
const closure = JSON.parse(readFileSync(packagePath, "utf8"));

function sha256(path: string) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

test("PCB engineering closure binds the retained sources and calculator by digest", () => {
  assert.equal(
    closure.calculator.sourceSha256,
    sha256("src/lib/payroll/pcb-2026.ts"),
  );
  for (const source of closure.officialSources) {
    assert.equal(source.sha256, sha256(source.path), source.id);
  }
  assert.equal(
    closure.governance.ruleSetCandidateFileSha256,
    sha256("statutory/official/classifications/malaysia-pcb-2026-signoff-candidate-v1.json"),
  );
  assert.equal(
    closure.governance.requirementsSha256,
    sha256("statutory/official/pcb-2026-requirements.json"),
  );
});

test("PCB closure is ready only for external verification, never marked HASiL verified or production active", () => {
  assert.equal(closure.engineeringStatus, "READY_FOR_HASIL_VERIFICATION");
  assert.equal(closure.hasilExternalVerificationPerformed, false);
  assert.equal(closure.hasilApprovalEvidence, null);
  assert.equal(closure.productionActivated, false);
  assert.deepEqual(closure.environmentBoundary, ["LOCAL", "TESTING"]);
});

test("PCB closure retains distinct TP1 and TP3 categories plus byte-verified CP39 and instructed CP38", () => {
  assert.deepEqual(closure.tp1Support.structuredCategories.slice(0, 2), ["C1", "C2"]);
  assert.equal(closure.tp1Support.structuredCategories.at(-1), "D1");
  assert.deepEqual(closure.tp3Support.structuredDeductionCategories.slice(0, 2), ["D1", "D2"]);
  assert.equal(closure.tp3Support.structuredDeductionCategories.at(-1), "D17");
  assert.equal(closure.cp38.separateFromPcbFormula, true);
  assert.equal(closure.cp38.frozenSnapshot, true);
  assert.equal(closure.cp39.byteGoldenResult, "PASS");
  assert.equal(closure.cp39.headerCharacters, 57);
  assert.equal(closure.cp39.detailCharacters, 136);
});

test("runtime source freezes CP38 provenance and rejects direct statutory edits", () => {
  const statutory = readFileSync("src/lib/payroll/statutory-p2.ts", "utf8");
  const service = readFileSync("src/lib/payroll/service.ts", "utf8");
  assert.match(statutory, /cp38:\s*\{\s*status:\s*cp38Resolution\.status,/);
  assert.match(statutory, /instructions:\s*cp38Resolution\.status === "APPLICABLE"/);
  assert.match(service, /Direct statutory amount overrides are disabled/);
});

test("payroll entry explains PCB from its frozen snapshot without recalculation", () => {
  const page = readFileSync(
    "src/app/(business)/team/payroll/runs/[runId]/entries/[entryId]/page.tsx",
    "utf8",
  );
  assert.match(page, /View frozen PCB calculation/);
  assert.match(page, /Previous employer \/ TP3 pay/);
  assert.match(page, /YTD PCB already deducted/);
  assert.match(page, /Calculator binding/);
  assert.match(page, /Snapshot identity/);
  assert.match(page, /It is never recalculated when viewed/);
});
