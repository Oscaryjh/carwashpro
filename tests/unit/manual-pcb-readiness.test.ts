import test from "node:test";
import assert from "node:assert/strict";
import { createPayrollReadinessIssue, summarizePayrollReadiness } from "../../src/lib/payroll/readiness";
import { requiresManualPcb } from "../../src/lib/payroll/manual-pcb-service";

test("manual PCB blocker is counted and gives an actionable confirmation instruction", () => {
  const issue = createPayrollReadinessIssue({ code: "PCB_MANUAL_CONFIRMATION_REQUIRED", severity: "BLOCKING", membershipId: "synthetic", employeeCode: "SYNTHETIC", employeeName: "Synthetic employee", message: "Manual confirmation required" });
  const result = summarizePayrollReadiness({ businessId: "synthetic", month: "2026-09", runId: "synthetic", memberships: [{ id: "synthetic", employeeCode: "SYNTHETIC", fullName: "Synthetic employee" }], issues: [issue] });
  assert.equal(result.counts.PCB_MANUAL_CONFIRMATION_REQUIRED, 1);
  assert.equal(result.canProceed, false);
  assert.match(issue.resolutionHint, /MFA/);
});

test("only the PCB snapshot can establish the explicit nonofficial synthetic PCB exemption", () => {
  assert.equal(requiresManualPcb([
    { scheme: "EPF", evidenceNature: "REAL", evidenceEnvironment: null, officialExportEligible: true },
    { scheme: "PCB", evidenceNature: "SYNTHETIC_TESTING", evidenceEnvironment: "LOCAL", officialExportEligible: false },
  ]), false);
  assert.equal(requiresManualPcb([{ scheme: "PCB", evidenceNature: "REAL", evidenceEnvironment: "LOCAL", officialExportEligible: false }]), true);
  assert.equal(requiresManualPcb([]), true);
});
