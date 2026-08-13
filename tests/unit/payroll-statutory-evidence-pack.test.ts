import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateStatutoryEvidencePack,
  loadStatutoryEvidencePackInputs,
  type StatutoryEvidencePackInput,
} from "../../src/lib/payroll/statutory-evidence-pack";

let loaded: Promise<StatutoryEvidencePackInput[]> | undefined;
function inputs() {
  loaded ??= loadStatutoryEvidencePackInputs();
  return loaded;
}

test("all four retained official evidence packs are complete independently of human status", async () => {
  const results = (await inputs()).map(evaluateStatutoryEvidencePack);
  assert.deepEqual(results.map((item) => item.scheme), ["EPF", "SOCSO", "EIS", "LINDUNG24"]);
  for (const result of results) {
    assert.equal(result.evidencePack, "COMPLETE");
    assert.equal(result.engineering, "READY");
    assert.equal(result.humanSignOff, "NOT_EXECUTED");
    assert.equal(result.activation, "BLOCKED_HUMAN_SIGNOFF");
    assert.deepEqual(result.blockers, []);
    assert.equal(result.fixtureProvenance.MISSING, 0);
  }
});

test("missing retained artifact makes the evidence pack incomplete", async () => {
  const input = clone((await inputs())[0]);
  input.artifacts[0].bytes = null;
  const result = evaluateStatutoryEvidencePack(input);
  assert.equal(result.evidencePack, "INCOMPLETE");
  assert.equal(result.activation, "BLOCKED_ENGINEERING");
  assert.ok(result.blockers.includes("OFFICIAL_ARTIFACT_NOT_RETAINED"));
});

test("artifact mutation is detected by the retained hash", async () => {
  const input = clone((await inputs())[0]);
  input.artifacts[0].bytes![16] ^= 1;
  const result = evaluateStatutoryEvidencePack(input);
  assert.ok(result.blockers.includes("ARTIFACT_HASH_MISMATCH"));
});

test("missing official metadata makes the evidence pack incomplete", async () => {
  const input = clone((await inputs())[0]);
  input.artifacts[0].manifest.title = "";
  const result = evaluateStatutoryEvidencePack(input);
  assert.ok(result.blockers.includes("ARTIFACT_METADATA_INCOMPLETE"));
});

test("dataset must trace to the retained official artifact", async () => {
  const input = clone((await inputs())[0]);
  input.dataset.artifactId = "wrong-official-artifact";
  const result = evaluateStatutoryEvidencePack(input);
  assert.ok(result.blockers.includes("DATASET_ARTIFACT_TRACE_MISMATCH"));
});

test("fixture without source provenance cannot count as official-backed", async () => {
  const input = clone((await inputs())[0]);
  input.fixtures.fixtures[0].sourceReference = "";
  const result = evaluateStatutoryEvidencePack(input);
  assert.ok(result.blockers.includes("FIXTURE_PROVENANCE_MISSING"));
  assert.equal(result.fixtureProvenance.MISSING, 1);
});

test("live network availability is not a deterministic evidence-pack dependency", async () => {
  const input = clone((await inputs())[2]);
  const result = evaluateStatutoryEvidencePack(input);
  assert.equal(result.scheme, "EIS");
  assert.equal(result.evidencePack, "COMPLETE");
  assert.equal(result.activation, "BLOCKED_HUMAN_SIGNOFF");
});

function clone(input: StatutoryEvidencePackInput): StatutoryEvidencePackInput {
  return structuredClone(input);
}
