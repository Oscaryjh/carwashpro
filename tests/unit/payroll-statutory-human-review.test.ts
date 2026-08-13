import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { loadStatutoryHumanReviewPackages } from "../../src/lib/payroll/statutory-evidence-pack";
import {
  assertStatutoryReviewChecklist,
  STATUTORY_REVIEW_CHECKLIST,
  STATUTORY_REVIEW_CHECKLIST_VERSION,
} from "../../src/lib/payroll/statutory-human-review";

test("human review packages expose the four complete evidence sets in required order", async () => {
  const packages = await loadStatutoryHumanReviewPackages();
  assert.deepEqual(packages.map((item) => item.scheme), ["EPF", "SOCSO", "EIS", "LINDUNG24"]);
  for (const pack of packages) {
    assert.equal(pack.engineering, "READY");
    assert.equal(pack.evidencePack, "COMPLETE");
    assert.equal(pack.humanReview, "NOT_EXECUTED");
    assert.equal(pack.humanSignOff, "NOT_EXECUTED");
    assert.equal(pack.activation, "BLOCKED_HUMAN_SIGNOFF");
    assert.ok(pack.artifacts.every((artifact) => artifact.verified));
    assert.equal(pack.dataset.expectedRowCount, pack.dataset.actualRowCount);
    assert.equal(pack.independentReview.mismatchCount, 0);
    assert.equal(pack.fixtureProvenance.MISSING, 0);
    assert.match(pack.evidenceDigest, /^[a-f0-9]{64}$/);
  }
});

test("review packages expose repository counts, classifications and schedule horizon", async () => {
  const packages = await loadStatutoryHumanReviewPackages();
  const epf = packages[0];
  assert.equal(epf.dataset.actualRowCount, 401);
  assert.equal(epf.independentReview.rowsChecked, 1203);
  assert.equal(epf.fixtures.length, 21);
  assert.equal(epf.unknownComponents.length, 10);

  const socso = packages[1];
  const eis = packages[2];
  const lindung24 = packages[3];
  assert.equal(socso.dataset.actualRowCount, 65);
  assert.equal(socso.fixtures.length, 20);
  assert.equal(eis.dataset.actualRowCount, 65);
  assert.equal(eis.fixtures.length, 11);
  assert.equal(lindung24.fixtures.length, 6);
  assert.equal(lindung24.effectiveTo, "2028-06-01");
  assert.ok(lindung24.knownLimitations.some((item) => item.includes("2028-06-01")));
});

test("all seventeen human checklist confirmations are required server-side", () => {
  assert.equal(STATUTORY_REVIEW_CHECKLIST.length, 17);
  const complete = new FormData();
  complete.set("reviewChecklistVersion", STATUTORY_REVIEW_CHECKLIST_VERSION);
  for (const item of STATUTORY_REVIEW_CHECKLIST) {
    complete.set(`reviewChecklist.${item.id}`, "confirmed");
  }
  assert.equal(assertStatutoryReviewChecklist(complete), STATUTORY_REVIEW_CHECKLIST_VERSION);

  const incomplete = new FormData();
  incomplete.set("reviewChecklistVersion", STATUTORY_REVIEW_CHECKLIST_VERSION);
  assert.throws(
    () => assertStatutoryReviewChecklist(incomplete),
    /STATUTORY_REVIEW_CHECKLIST_INCOMPLETE_OFFICIAL_PUBLISHER/,
  );

  const stale = new FormData();
  stale.set("reviewChecklistVersion", "statutory-human-review/1.0.0");
  assert.throws(() => assertStatutoryReviewChecklist(stale), /STATUTORY_REVIEW_CHECKLIST_STALE/);
});

test("admin review workspace stays authenticated, evidence-only and activation-free", async () => {
  const reviewPage = await readFile(
    "src/app/admin/statutory/review/[scheme]/page.tsx",
    "utf8",
  );
  const actions = await readFile("src/app/admin/statutory/rulesets/actions.ts", "utf8");
  const rulePage = await readFile(
    "src/app/admin/statutory/rulesets/[ruleSetId]/page.tsx",
    "utf8",
  );
  assert.match(reviewPage, /requireUser\(\)/);
  assert.match(reviewPage, /assertRole\(user, \["PLATFORM_ADMIN"\]\)/);
  assert.doesNotMatch(reviewPage, /activateStatutoryRuleAction/);
  assert.doesNotMatch(reviewPage, /signOffStatutoryRuleAction/);
  assert.match(reviewPage, /Sign-off unavailable on evidence-only package/);
  assert.match(actions, /assertStatutoryReviewChecklist\(formData\)/);
  assert.match(rulePage, /reviewChecklist\.\$\{item\.id\}/);
  assert.match(rulePage, /required/);
});
