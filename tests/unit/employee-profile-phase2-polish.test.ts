import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = process.cwd();

test("Phase 2 profile sections use consistent daily-use headings and read-only labels", async () => {
  const [overview, personal, attendance, leave] = await Promise.all([
    readFile(
      path.join(root, "src/components/employee-profile-phase2a.tsx"),
      "utf8",
    ),
    readFile(
      path.join(root, "src/components/employee-profile-personal.tsx"),
      "utf8",
    ),
    readFile(
      path.join(root, "src/components/employee-profile-attendance.tsx"),
      "utf8",
    ),
    readFile(
      path.join(root, "src/components/employee-profile-leave.tsx"),
      "utf8",
    ),
  ]);

  assert.match(overview, /<h2>Team member overview<\/h2>/);
  assert.match(overview, /<h2>Employment details<\/h2>/);
  assert.match(personal, /<h2>Contact details<\/h2>/);
  assert.match(attendance, /<h2>Attendance<\/h2>/);
  assert.match(leave, /<h2>Leave<\/h2>/);

  for (const source of [overview, personal, attendance, leave]) {
    assert.doesNotMatch(source, /No editing in Phase 2/);
  }

  assert.equal(
    [overview, personal, attendance, leave]
      .map((source) => source.match(/>Read only<\/span>/g)?.length ?? 0)
      .reduce((total, count) => total + count, 0),
    6,
  );
});

test("Phase 2 mobile profile navigation exposes all tabs without horizontal discovery", async () => {
  const styles = await readFile(
    path.join(root, "src/components/employee-profile-shell.module.css"),
    "utf8",
  );

  assert.match(styles, /grid-template-columns:\s*repeat\(4, minmax\(0, 1fr\)\)/);
  assert.match(styles, /grid-auto-flow:\s*row/);
  assert.match(styles, /\.tabs \.activeTab\s*\{[\s\S]*?background:/);
  assert.match(styles, /overflow-wrap:\s*anywhere/);
});

test("remaining future profile tabs use user-facing availability states", async () => {
  const shell = await readFile(
    path.join(root, "src/components/employee-profile-shell.tsx"),
    "utf8",
  );

  assert.doesNotMatch(shell, /Payroll details are not available yet/);
  assert.match(shell, /Documents are not available yet/);
  assert.match(shell, /Activity is not available yet/);
  assert.doesNotMatch(shell, /shell is ready/);
});
