import type { ResolvedBusinessAccess } from "../../src/lib/business-groups/business-access";
import type { PrismaClient } from "@prisma/client";
import assert from "node:assert/strict";
import test from "node:test";
import * as presentation from "../../src/lib/attendance/outlet-presentation";
import { importAttendanceOutletServer } from "../helpers/attendance-server-import";

const scope = { businessId: "business-a", allowedBranchIds: ["a", "b"] };
const single = { kind: "single_outlet", internalBranchId: "a", branchNameSnapshot: "Store A" } as const;

test("Attendance current presentation consumes whole Business topology, not actor location count", () => {
  const context = presentation.attendanceOutletPresentation({ kind: "legacy_multi_branch" }, { ...scope, allowedBranchIds: ["a"] });
  assert.equal(context.topology.kind, "legacy_multi_branch");
  assert.deepEqual(context.currentScope.allowedBranchIds, ["a"]);
  assert.equal(context.currentBranchId, undefined);
});
test("single current scope excludes historical branches and never grants a missing branch", () => {
  assert.deepEqual(presentation.attendanceOutletPresentation(single, scope).currentScope.allowedBranchIds, ["a"]);
  assert.equal(presentation.attendanceOutletPresentation(single, scope).currentBranchId, "a");
  assert.deepEqual(presentation.attendanceOutletPresentation(single, { ...scope, allowedBranchIds: [] }).currentScope.allowedBranchIds, []);
  assert.deepEqual(presentation.attendanceOutletPresentation({ kind: "no_location" }, scope).currentScope.allowedBranchIds, []);
});
test("fresh single form validates explicit branch and rejects stale topology without rewriting input", () => {
  const data = new FormData();
  data.set("branchId", "a"); data.set("attendanceOutletMode", "single_outlet"); data.set("attendanceOutletBranchId", "a");
  presentation.assertAttendanceOutletInput(presentation.attendanceOutletPresentation(single, scope), data);
  assert.throws(() => presentation.assertAttendanceOutletInput(presentation.attendanceOutletPresentation({ kind: "legacy_multi_branch" }, scope), data));
  for (const branch of ["b", "foreign", "", "historical"]) {
    data.set("branchId", branch);
    assert.throws(() => presentation.assertAttendanceOutletInput(presentation.attendanceOutletPresentation(single, scope), data));
    assert.equal(data.get("branchId"), branch);
  }
});
test("legacy explicit branch validates without a single marker; malformed/duplicate inputs fail closed", () => {
  const context = presentation.attendanceOutletPresentation({ kind: "legacy_multi_branch" }, scope);
  const data = new FormData(); data.set("branchId", "b");
  presentation.assertAttendanceOutletInput(context, data);
  data.append("branchId", "a");
  assert.throws(() => presentation.assertAttendanceOutletInput(context, data));
  data.delete("branchId");
  assert.throws(() => presentation.assertAttendanceOutletInput(context, data));
  data.set("branchId", "a"); data.set("attendanceOutletMode", "forged");
  assert.throws(() => presentation.assertAttendanceOutletInput(context, data));
});
test("fresh no-scope or zero-location cannot save simplified current settings", () => {
  const data = new FormData(); data.set("branchId", "a");
  for (const context of [presentation.attendanceOutletPresentation(single, { ...scope, allowedBranchIds: [] }), presentation.attendanceOutletPresentation({ kind: "no_location" }, scope)]) {
    assert.throws(() => presentation.assertAttendanceOutletInput(context, data));
  }
});

test("single document form marker checks topology without injecting or changing document branch", () => {
  const data = new FormData(); data.set("assignmentId", "historical-record");
  data.set("attendanceOutletMode", "single_outlet"); data.set("attendanceOutletBranchId", "a");
  presentation.assertAttendanceOutletInput(presentation.attendanceOutletPresentation(single, scope), data);
  assert.equal(data.has("branchId"), false);
  assert.throws(() => presentation.assertAttendanceOutletInput(presentation.attendanceOutletPresentation({ kind: "legacy_multi_branch" }, scope), data));
});

test("server adapter uses fresh Attendance scope and canonical whole Business topology including GM capability scope", async () => {
  const { server } = await importAttendanceOutletServer();
  const owner = { granted: true, source: "DIRECT_BUSINESS", businessId: "business-a", effectiveBusinessRole: "BUSINESS_OWNER", permissions: [], branchId: null } as unknown as Extract<ResolvedBusinessAccess, { granted: true }>;
  let ids = ["a", "b"];
  const db = { branch: { findMany: async (q: { where: { businessId?: string; status?: string; id?: string | { in: string[] } } }) => {
    assert.equal(q.where.businessId, "business-a"); assert.equal(q.where.status, "ACTIVE");
    return ids.filter(id => !q.where.id || id === q.where.id).map(id => ({ id, name: id }));
  } } } as unknown as PrismaClient;
  const staff = { ...owner, effectiveBusinessRole: "STAFF", branchId: "a" } as Extract<ResolvedBusinessAccess, { granted: true }>;
  assert.equal((await server.resolveAttendanceOutletContext(staff, db)).topology.kind, "legacy_multi_branch");
  for (const identityRole of ["STAFF", "BUSINESS_OWNER"]) {
    const gm = { ...owner, identityRole: identityRole as "STAFF" | "BUSINESS_OWNER", effectiveBusinessRole: "GROUP_MANAGER_READ_ONLY", source: "GROUP_GRANT" } as unknown as Extract<ResolvedBusinessAccess, { granted: true }>;
    assert.deepEqual((await server.resolveAttendanceOutletContext(gm, db)).currentScope.allowedBranchIds, ["a", "b"]);
  }
  const form = new FormData(); form.set("branchId", "a"); form.set("attendanceOutletMode", "single_outlet"); form.set("attendanceOutletBranchId", "a");
  await assert.rejects(server.assertFreshAttendanceOutletInput(owner, form, db));
  ids = ["a"];
  await server.assertFreshAttendanceOutletInput(staff, form, db);
  await assert.rejects(server.assertFreshAttendanceOutletInput({ ...staff, branchId: null }, form, db));
  ids = [];
  await assert.rejects(server.assertFreshAttendanceOutletInput(owner, form, db));
});
