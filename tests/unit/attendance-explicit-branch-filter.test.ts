import assert from "node:assert/strict";
import test from "node:test";
import { buildAttendanceSessionWhere } from "../../src/lib/attendance/scope";
import { attendanceOutletPages } from "../helpers/attendance-outlet-pages";

const scope = { businessId: "business-a", allowedBranchIds: ["branch-a", "branch-b"] };

test("session query keeps the allowed scope when no explicit branch is supplied", () => {
  assert.deepEqual(buildAttendanceSessionWhere(scope, { status: "OPEN" }), {
    businessId: "business-a", branchId: { in: ["branch-a", "branch-b"] }, status: "OPEN",
  });
});

for (const branchId of ["branch-a", "branch-b"]) {
  test(`session query intersects authorized explicit ${branchId} instead of widening`, () => {
    assert.deepEqual(buildAttendanceSessionWhere(scope, { branchId, status: "OPEN" }), {
      businessId: "business-a", branchId: { in: [branchId] }, status: "OPEN",
    });
  });
}

for (const branchId of ["branch-unauthorized", "not-a-uuid", "branch-foreign", "", null]) {
  test(`session query fails closed for explicit ${String(branchId)}`, () => {
    assert.deepEqual(buildAttendanceSessionWhere(scope, { branchId }).branchId, { in: [] });
  });
}

test("session query preserves structured branch constraints and other predicates", () => {
  const where = { branchId: { not: "branch-a" }, AND: [{ status: "OPEN" }], businessId: "foreign" };
  const result = buildAttendanceSessionWhere(scope, where);
  assert.deepEqual(result.branchId, { in: ["branch-a", "branch-b"] });
  assert.deepEqual(result.AND, [{ ...where, businessId: "business-a" }]);
  assert.equal(result.businessId, "business-a");
  assert.deepEqual(where, { branchId: { not: "branch-a" }, AND: [{ status: "OPEN" }], businessId: "foreign" });
});

test("session query cannot grant an explicit branch when authorized scope is empty", () => {
  assert.deepEqual(buildAttendanceSessionWhere({ ...scope, allowedBranchIds: [] }, { branchId: "branch-a" }).branchId, { in: [] });
});

test("list and export reject explicit invalid filters before reading attendance", async () => {
  const state = globalThis as typeof globalThis & Record<string, unknown>;
  const a = "00000000-0000-4000-8000-000000000001", b = "00000000-0000-4000-8000-000000000002";
  state.attendanceOutletActor = { businessId: "business-a", user: { role: "BUSINESS_OWNER" }, access: {
    granted: true, businessId: "business-a", effectiveBusinessRole: "BUSINESS_OWNER", permissions: [], source: "DIRECT_BUSINESS",
  } };
  state.attendanceOutletBranches = [{ id: a, name: "A" }, { id: b, name: "B" }];
  const reads: unknown[] = [];
  const reader = async (input: unknown) => { reads.push(input); throw Object.assign(Error("READER"), { input }); };
  state.attendanceOutletDb = { branch: { findMany: async () => state.attendanceOutletBranches },
    employeeAttendance: { count: reader, findMany: reader }, employeeBusinessMembership: { findMany: async () => [] } };
  const pages = await attendanceOutletPages();
  try {
    for (const bad of ["not-a-uuid", "00000000-0000-4000-8000-000000000003", "", [a, b]]) {
      reads.length = 0;
      await assert.rejects(pages.List({ searchParams: Promise.resolve({ branchId: bad }) }), /NOT_FOUND/);
      const query = new URLSearchParams();
      if (Array.isArray(bad)) for (const id of bad) query.append("branchId", id);
      else query.set("branchId", bad);
      const response = await pages.Export(new Request(`http://localhost/team/attendance/export?${query}`));
      assert.equal(response.status, 404);
      assert.equal(reads.length, 0, "invalid explicit filter must not call an attendance reader");
    }
    for (const id of [a, b, undefined]) {
      for (const run of [
        () => pages.List({ searchParams: Promise.resolve(id ? { branchId: id } : {}) }),
        () => pages.Export(new Request(`http://localhost/team/attendance/export${id ? '?branchId='+id : ''}`)),
      ]) {
        reads.length = 0;
        await assert.rejects(run, (e: unknown) => {
          const error = e as Error & { input: { where: { branchId: { in: string[] } } } };
          assert.equal(error.message, "READER");
          assert.deepEqual(error.input.where.branchId, { in: id ? [id] : [a,b] });
          return true;
        });
      }
    }
  } finally {
    delete state.attendanceOutletActor; delete state.attendanceOutletBranches; delete state.attendanceOutletDb;
  }
});
