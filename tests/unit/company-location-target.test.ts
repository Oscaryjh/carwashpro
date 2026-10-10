import type { ResolvedBusinessAccess } from "../../src/lib/business-groups/business-access";
import type { PrismaClient } from "@prisma/client";
import assert from "node:assert/strict";
import test from "node:test";
import { importAttendanceOutletServer } from "../helpers/attendance-server-import";

const owner = { granted: true, source: "DIRECT", businessId: "business-a", effectiveBusinessRole: "BUSINESS_OWNER", permissions: [], branchId: null } as unknown as Extract<ResolvedBusinessAccess, { granted: true }>;
function database(ids: string[]) { return { branch: { findMany: async (q: { where: { businessId?: string; status?: string; id?: string | { in: string[] } } }) => { assert.equal(q.where.businessId, "business-a"); assert.equal(q.where.status, "ACTIVE"); return ids.filter(id => !q.where.id || q.where.id === id).map(id => ({ id, name: id, attendanceSetting: null })); } } } as unknown as PrismaClient; }
test("company location resolves one active outlet and fails closed without one", async () => {
  const { company: service } = await importAttendanceOutletServer();
  assert.equal((await service.resolveCompanyLocationTarget(owner, database(["a"]))).kind, "single");
  assert.equal((await service.resolveCompanyLocationTarget(owner, database([]))).kind, "zero");
});
test("staff with one visible branch must not collapse a legacy business", async () => {
  const { company: service } = await importAttendanceOutletServer();
  const staff = { ...owner, effectiveBusinessRole: "STAFF", branchId: "a" } as Extract<ResolvedBusinessAccess, { granted: true }>;
  assert.equal((await service.resolveCompanyLocationTarget(staff, database(["a", "b"]))).kind, "legacy");
  assert.equal((await service.resolveCompanyLocationTarget({ ...staff, branchId: "foreign" }, database(["a"]))).kind, "denied");
});
test("platform and unauthorised business contexts cannot resolve a location", async () => {
  const { company: service } = await importAttendanceOutletServer();
  await assert.rejects(service.resolveCompanyLocationTarget({ ...owner, source: "PLATFORM_ADMIN" }, database(["a"])));
  await assert.rejects(service.resolveCompanyLocationTarget({ ...owner, granted: false } as unknown as ResolvedBusinessAccess, database(["a"])));
});
