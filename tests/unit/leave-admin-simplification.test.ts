import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("leave administration uses progressive disclosure and plain HR language", async () => {
  const [page, createForm, policyEditor, actions, service] = await Promise.all([
    readFile("src/app/(business)/team/leave/page.tsx", "utf8"),
    readFile("src/app/(business)/team/leave/leave-type-create-form.tsx", "utf8"),
    readFile("src/app/(business)/team/leave/leave-policy-editor.tsx", "utf8"),
    readFile("src/app/(business)/team/leave/actions.ts", "utf8"),
    readFile("src/lib/leave/service.ts", "utf8"),
  ]);

  assert.match(page, /Manage leave/);
  assert.match(page, /Employee balances/);
  assert.match(page, /Company policies/);
  assert.match(page, /Advanced compliance & maintenance/);
  assert.match(page, /Restricted maintenance/);
  assert.match(page, /Repair missing records/);
  assert.match(page, /Regular yearly allowance comes from Company policies/);
  assert.match(page, /Reason for correction/);
  assert.match(policyEditor, /Advanced policy settings/);
  assert.match(policyEditor, /Earlier requests, balances and payroll records keep their original policy/);
  assert.match(policyEditor, /Based on length of service/);
  assert.match(policyEditor, /Carry unused days into the next leave period/);

  assert.match(createForm, /Fixed yearly allowance/);
  assert.match(createForm, /No balance limit/);
  assert.match(createForm, /A similar leave type already exists/);
  assert.match(createForm, /annualVacation/);
  assert.match(createForm, /More options/);
  assert.doesNotMatch(createForm, /Revision|legalStatus|SHA-256/);

  assert.match(actions, /formData\.get\("allowanceMode"\) === "FIXED"/);
  assert.match(actions, /const adjustmentReason = String\(formData\.get\("reason"\)/);
  assert.doesNotMatch(actions, /Leave balance added by HR\./);
  assert.match(page, /Confirm deactivation/);
  assert.match(service, /LEAVE_POLICY_DEACTIVATED/);
  assert.match(service, /Historical Leave records remain unchanged/);
});
