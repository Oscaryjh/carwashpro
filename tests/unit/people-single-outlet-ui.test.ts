import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { createRequire } from "node:module";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { canGroupManager } from "../../src/lib/business-groups/capabilities";

test("Staff single workplace form omits location mutations but retains manageable clock-in; legacy keeps controls", async () => {
  const require = createRequire(import.meta.url);
  const { JSDOM } = require("jsdom");
  const dir = await mkdtemp("node_modules/.cache/people-ui-");
  try {
    const outfile = join(dir, "staff.cjs");
    await build({ entryPoints: ["src/components/staff-form.tsx"], outfile, bundle: true, packages: "external", platform: "node", format: "cjs", jsx: "automatic", logLevel: "silent" });
    const { StaffForm } = require(join(process.cwd(), outfile));
    const topology = { kind: "single_outlet", internalBranchId: "A", branchNameSnapshot: "Workplace A" };
    const props = { action: async () => {}, branches: [{ id: "A", name: "A" }], canManagePermissions: true, submitLabel: "Save", outletTopology: topology };
    const documentFor = (extra = {}) => new JSDOM(renderToStaticMarkup(createElement(StaffForm, { ...props, ...extra }))).window.document;
    const single = documentFor();
    assert.equal(single.querySelector('[name="branchIds"]'), null);
    assert.equal(single.querySelector('[name="primaryBranchId"]'), null);
    assert.equal(single.querySelector('[name="canClockInBranchIds"]'), null);
    assert.equal(single.querySelector('[name="peopleOutletBranchId"]')?.getAttribute("value"), "A");
    assert.match(single.body.textContent!, /Can clock in/);
    const legacy = documentFor({ outletTopology: { kind: "legacy_multi_branch" } });
    assert.ok(legacy.querySelector('[name="branchIds"]'), "one visible branch in a multi-outlet Business retains actor-choice UX");
    assert.ok(legacy.querySelector('[name="primaryBranchId"]'));
    assert.equal(legacy.querySelector('[name="peopleOutletMode"]'), null);
    const staff = { id: "user", name: "Staff", branchId: "A", permissions: [], role: "STAFF", appointmentBookable: false, loginEnabled: false, email: null, staffLevelId: null, staffRoleProfileId: null, status: "active", whatsappPhone: null };
    const normal = documentFor({ staff, workplaceProfile: { canSimplify: true, updatedAt: "2026-01-01T00:00:00.000Z" } });
    assert.equal(normal.querySelector('[name="branchIds"]'), null);
    assert.equal(normal.querySelector('[name="peopleOutletExpectedUpdatedAt"]')?.getAttribute("value"), "2026-01-01T00:00:00.000Z");
    const coreOnly = documentFor({ staff, allowHrFields: false, workplaceProfile: { canSimplify: true, updatedAt: "2026-01-01T00:00:00.000Z" } });
    assert.equal(coreOnly.querySelector('[name="peopleOutletMode"]'), null, "core-only edit uses its existing POS-home form contract");
    assert.ok(coreOnly.querySelector('[name="primaryBranchId"]'));
    const pos = documentFor({ staff: { ...staff, loginEnabled: true }, workplaceProfile: { canSimplify: true, updatedAt: "2026-01-01T00:00:00.000Z" } });
    assert.equal(pos.querySelector('[aria-label="A authorized for POS"]'), null, "single-outlet POS workplace picker is redundant");
    const exceptional = documentFor({ staff, workplaceProfile: { canSimplify: false, updatedAt: "2026-01-01T00:00:00.000Z" } });
    assert.ok(exceptional.querySelector('[name="primaryBranchId"]'));
    const zero = documentFor({ branches: [], outletTopology: { kind: "no_location" } });
    assert.ok(zero.querySelector("fieldset[disabled]"));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("GM HR whitelist remains modify-employee capable, without Staff or payroll capability", () => {
  assert.equal(canGroupManager("VIEW_TEAM_DIRECTORY"), true);
  assert.equal(canGroupManager("VIEW_ATTENDANCE_EMPLOYEES"), true);
  assert.equal(canGroupManager("MODIFY_ATTENDANCE_EMPLOYEES"), true);
  assert.equal(canGroupManager("MODIFY_ATTENDANCE_SETTINGS"), true);
  assert.equal(canGroupManager("MODIFY_TEAM"), false);
  assert.equal(canGroupManager("EDIT_COMPENSATION"), false);
});
