import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = process.cwd();

test("Profile overview keeps core details and attention summaries compact", async () => {
  const [profile, attendance, leave] = await Promise.all([
    readFile(
      path.join(root, "src/components/employee-profile-phase2a.tsx"),
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

  assert.match(profile, /<h3>Contact details<\/h3>/);
  assert.match(profile, /<h3>Employment details<\/h3>/);
  assert.match(profile, /<h3>Needs attention<\/h3>/);
  assert.match(profile, /<h3>Today<\/h3>/);
  assert.doesNotMatch(profile, /<h3>Work setup<\/h3>|<h4>Branch access<\/h4>/);
  assert.doesNotMatch(profile, /<h2>Overview<\/h2>/);
  assert.doesNotMatch(profile, /<h2>Personal<\/h2>/);
  assert.doesNotMatch(profile, /<h2>Employment<\/h2>/);
  assert.doesNotMatch(profile, /Operational status|Back-office login/);
  assert.match(attendance, /<h2>Attendance<\/h2>/);
  assert.match(leave, /<h2>Leave<\/h2>/);

  for (const source of [profile, attendance, leave]) {
    assert.doesNotMatch(source, /No editing in Phase 2/);
  }
});

test("Phase 2 profile navigation exposes every section in the top horizontal rail", async () => {
  const styles = await readFile(
    path.join(root, "src/components/employee-profile-shell.module.css"),
    "utf8",
  );

  assert.match(styles, /\.profileRail\s*\{[\s\S]*?overflow-x:\s*auto/);
  assert.match(
    styles,
    /\.tabs\s*\{[\s\S]*?grid-template-columns:\s*repeat\(5, minmax\(126px, 1fr\)\)/,
  );
  assert.match(styles, /\.tabGroupLabel\s*\{[\s\S]*?display:\s*none/);
  assert.match(styles, /\.tabs \.activeTab\s*\{[\s\S]*?background:/);
  assert.match(styles, /overflow-wrap:\s*anywhere/);
});

test("profile shell no longer exposes obsolete future tabs", async () => {
  const shell = await readFile(
    path.join(root, "src/components/employee-profile-shell.tsx"),
    "utf8",
  );

  assert.doesNotMatch(shell, /Payroll details are not available yet/);
  assert.doesNotMatch(shell, /Documents are not available yet/);
  assert.doesNotMatch(shell, /Activity is not available yet/);
  assert.match(shell, /EmployeeProfileSectionNav/);
  assert.doesNotMatch(shell, /shell is ready/);
});
