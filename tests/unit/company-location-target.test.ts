import assert from "node:assert/strict";
import test from "node:test";
import * as service from "../../src/lib/attendance/company-location";

const owner: any = { granted: true, source: "DIRECT", businessId: "business-a", effectiveBusinessRole: "BUSINESS_OWNER", permissions: [], branchId: null };
function database(ids: string[]) { return { branch: { findMany: async (q: any) => { assert.equal(q.where.businessId, "business-a"); assert.equal(q.where.status, "ACTIVE"); return ids.filter(id => !q.where.id || q.where.id === id).map(id => ({ id, name: id, attendanceSetting: null })); } } } as any; }
test("company location resolves one active outlet and fails closed without one", async () => {
  assert.equal((await service.resolveCompanyLocationTarget(owner, database(["a"]))).kind, "single");
  assert.equal((await service.resolveCompanyLocationTarget(owner, database([]))).kind, "zero");
});
test("staff with one visible branch must not collapse a legacy business", async () => {
  const staff = { ...owner, effectiveBusinessRole: "STAFF", branchId: "a" };
  assert.equal((await service.resolveCompanyLocationTarget(staff, database(["a", "b"]))).kind, "legacy");
  assert.equal((await service.resolveCompanyLocationTarget({ ...staff, branchId: "foreign" }, database(["a"]))).kind, "denied");
});
test("platform and unauthorised business contexts cannot resolve a location", async () => {
  await assert.rejects(service.resolveCompanyLocationTarget({ ...owner, source: "PLATFORM_ADMIN" }, database(["a"])));
  await assert.rejects(service.resolveCompanyLocationTarget({ ...owner, granted: false }, database(["a"])));
});
