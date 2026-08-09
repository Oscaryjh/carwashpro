import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = process.cwd();

async function source(relativePath: string) {
  return readFile(path.join(root, relativePath), "utf8");
}

test("Phase 4C consolidates payroll navigation on canonical destinations", async () => {
  const [workspace, runs, detail, shell] = await Promise.all([
    source("src/app/(business)/team/payroll/workspace/page.tsx"),
    source("src/app/(business)/team/payroll/runs/page.tsx"),
    source("src/app/(business)/team/payroll/runs/[runId]/page.tsx"),
    source("src/components/app-shell.tsx"),
  ]);

  assert.match(shell, /href: "\/team\/payroll"/);
  assert.match(workspace, /href="\/team\/payroll\/runs"/);
  assert.match(workspace, /`\/team\/payroll\/runs\/\$\{finalizedRun\.id\}`/);
  assert.match(workspace, /`\/team\/payroll\/settings\?month=\$\{data\.currentMonth\}`/);
  assert.doesNotMatch(workspace, /`\/team\/payroll\?month=/);
  assert.doesNotMatch(runs, /Legacy monthly payroll/);
  assert.doesNotMatch(detail, /Open legacy monthly payroll/);
});

test("Phase 4C removes the unused statutory compatibility writer", async () => {
  const [actions, statutoryActions] = await Promise.all([
    source("src/app/(business)/team/payroll/actions.ts"),
    source("src/app/(business)/team/payroll/statutory/actions.ts"),
  ]);

  assert.doesNotMatch(actions, /saveEmployeeStatutoryProfileAction/);
  assert.doesNotMatch(actions, /updateEmployeeStatutoryProfile/);
  assert.doesNotMatch(actions, /legacy payroll compatibility form/);
  assert.doesNotMatch(statutoryActions, /saveEmployeeSubmissionProfileAction/);
  assert.doesNotMatch(statutoryActions, /updateEmployeeTaxProfile/);
});

test("settings actions return to the dedicated settings route", async () => {
  const actions = await source("src/app/(business)/team/payroll/actions.ts");

  assert.match(actions, /function settingsPath/);
  assert.match(actions, /`\/team\/payroll\/settings\?month=/);
  assert.match(actions, /revalidatePath\("\/team\/payroll\/settings"\)/);
  assert.doesNotMatch(actions, /returnPath \?\? `\/team\/payroll\?month=/);
});
