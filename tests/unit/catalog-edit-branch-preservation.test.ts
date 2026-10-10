import assert from "node:assert/strict";
import test from "node:test";
import { catalogOutletActions } from "../helpers/catalog-outlet-actions";

function fixture(existingBranchId: string | null, count = 1) {
  const business = { id: "business", status: "active", industryType: "CAR_WASH" };
  const user = { id: "owner", userId: "owner", businessId: business.id, role: "BUSINESS_OWNER", status: "active", loginEnabled: true, permissions: ["SERVICES", "PACKAGES"], branchId: null, branch: null, business };
  const branches = Array.from({ length: count }, (_, i) => ({ id: `branch-${i}`, name: `Store ${i}` }));
  const record = { id: "record", businessId: business.id, branchId: existingBranchId };
  const writes: Record<string, unknown>[] = [];
  const model = { findFirst: async () => null, findFirstOrThrow: async () => record, update: async (q: {data: Record<string, unknown>}) => { writes.push(q.data); return record; } };
  const category = { findFirstOrThrow: async () => ({ id: "6d240e23-ef93-44e6-ad65-aaf0d7b0e977", name: "Category" }) };
  const db = { user: { findUnique: async () => user }, business: { findUnique: async () => business }, businessGroupUser: { findFirst: async () => null }, businessModuleEntitlement: { findMany: async () => [{ moduleKey: "POS", status: "ENABLED", enabledFrom: new Date(0), enabledUntil: null }] }, branch: { findMany: async () => branches }, service: model, package: model, serviceCategory: category, packageCategory: category, packageServiceBenefit: { deleteMany: async () => ({ count: 0 }) }, $transaction: async (fn: (tx: unknown) => unknown) => fn(db) };
  const form = new FormData();
  for (const [key, value] of Object.entries({ serviceId: "", packageId: record.id, name: "Edited name", description: "", price: "25", totalUses: "10", categoryId: "6d240e23-ef93-44e6-ad65-aaf0d7b0e977", status: "ACTIVE" })) form.set(key,value);
  return { db, branches, context: { user, businessId: business.id, industryType: "CAR_WASH" }, form, writes };
}

test("fresh catalog guard rejects stale topology, revoked resource permission and changed Business", async () => {
  const f = fixture(null); const api = await catalogOutletActions(f.db,f.context);
  const input = { businessId: "business", actorUserId: "owner", resource: "SERVICES" as const, operation: "write" as const };
  const snapshot = { kind: "single_outlet" as const, internalBranchId: "branch-0", businessId: "business" };
  await api.guardCatalogOutletSubmission({...input,snapshot,formData:f.form});
  f.branches.push({id:"branch-1",name:"Second"});
  await assert.rejects(api.guardCatalogOutletSubmission({...input,snapshot,formData:f.form}),/changed|Reload/);
  f.branches.pop(); f.context.user.role="STAFF"; f.context.user.permissions=["PACKAGES"];
  await assert.rejects(api.guardCatalogOutletSubmission({...input,snapshot,formData:f.form}),/changed|access/i);
  await assert.rejects(api.guardCatalogOutletSubmission({...input,businessId:"foreign",snapshot,formData:f.form}));
  assert.equal(f.writes.length,0);
});

test("zero location is a topology result, not a create branch fallback", async () => {
  const f=fixture(null,0); const api=await catalogOutletActions(f.db,f.context);
  const input={businessId:"business",actorUserId:"owner",resource:"PACKAGES" as const,operation:"write" as const};
  assert.equal((await api.resolveCatalogOutletContext(input)).kind,"no_location");
  await assert.rejects(api.guardCatalogOutletSubmission({...input,snapshot:{kind:"no_location",businessId:"business"},formData:f.form}),/operating location/);
  assert.equal(f.writes.length,0);
});

for (const action of ["updateServiceAction", "updatePackageAction"] as const) {
  for (const branch of [null, "historical-inactive", "branch-0"]) test(`${action}: absent input preserves ${branch} in single outlet`, async () => {
    const f = fixture(branch); if (action === "updateServiceAction") f.form.set("serviceId","record"); const actions = await catalogOutletActions(f.db, f.context);
    await assert.rejects(actions[action](f.form), /REDIRECT:/);
    assert.equal(f.writes.length, 1); assert.equal(f.writes[0].branchId, branch);
  });
  test(`${action}: explicit empty uses existing active branch semantics, not preservation`, async () => {
    const f = fixture(null); if (action === "updateServiceAction") f.form.set("serviceId","record"); f.form.set("branchId", ""); const actions = await catalogOutletActions(f.db, f.context);
    await assert.rejects(actions[action](f.form), /REDIRECT:/);
    assert.equal(f.writes[0].branchId,"branch-0");
  });
  for (const branch of ["invalid", "cross-business", "historical-inactive"]) test(`${action}: explicit ${branch} denied without writes`, async () => {
    const f = fixture(null); if (action === "updateServiceAction") f.form.set("serviceId","record"); f.form.set("branchId", branch); const actions = await catalogOutletActions(f.db, f.context);
    await assert.rejects(actions[action](f.form), /invalid|denied/i); assert.equal(f.writes.length, 0);
  });
  test(`${action}: legacy multi missing branch still rejects`, async () => {
    const f = fixture(null,2); if (action === "updateServiceAction") f.form.set("serviceId","record"); const actions = await catalogOutletActions(f.db, f.context);
    await assert.rejects(actions[action](f.form), /required/i); assert.equal(f.writes.length, 0);
  });
  test(`${action}: legacy explicit branch remains selectable`, async () => {
    const f = fixture(null,2); if (action === "updateServiceAction") f.form.set("serviceId","record"); f.form.set("branchId","branch-1"); const actions = await catalogOutletActions(f.db, f.context);
    await assert.rejects(actions[action](f.form), /REDIRECT:/); assert.equal(f.writes[0].branchId,"branch-1");
  });
}
