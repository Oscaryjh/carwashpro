import assert from "node:assert/strict";
import test from "node:test";
import { importOutletUiContext } from "../helpers/outlet-ui-server-import";
import type { CurrentOutletContext } from "../../src/lib/outlet-context";
import type { OutletDatabase } from "../../src/lib/outlet-context";
import { prisma } from "../../src/lib/prisma";

test("module consumers use Business topology, fresh effective scope and fail closed on explicit input", async () => {
  const helper = await importOutletUiContext();
  const business = { id: "biz", status: "active", industryType: "SALON_BEAUTY" };
  const user = { id: "staff", businessId: "biz", role: "STAFF", status: "active", loginEnabled: true,
    permissions: ["PRODUCTS", "INVENTORY_VIEW", "INVENTORY_MANAGE"], branchId: "A",
    business, branch: { id: "A", businessId: "biz", status: "ACTIVE" } };
  const branches = [{ id: "A", name: "A" }, { id: "B", name: "B" }];
  const database = {
    user: { findUnique: async () => user }, business: { findUnique: async () => business },
    businessGroupUser: { findFirst: async () => null },
    businessModuleEntitlement: { findMany: async () => ["POS", "INVENTORY"].map(moduleKey => ({ moduleKey, status: "ENABLED", enabledFrom: new Date(0), enabledUntil: null })) },
    branch: { findMany: async () => branches },
  } as unknown as OutletDatabase;
  const previous = prisma.branch.findMany;
  prisma.branch.findMany = database.branch.findMany;
  const input = { businessId: "biz", actorUserId: "staff" };
  try {
    const legacy = await helper.resolveInventoryOutletReadContext(input, database);
    assert.equal(legacy.kind, "legacy_multi_branch");
    if (legacy.kind === "legacy_multi_branch") assert.deepEqual(legacy.branches.map(b => b.id), ["A"]);
    for (const explicitBranchInput of ["B", "foreign", "", null]) {
      assert.equal((await helper.resolveInventoryOutletWriteContext({ ...input, capability: "MANAGE_INVENTORY", explicitBranchInput }, database)).kind, "denied");
    }
    assert.equal((await helper.resolveInventoryOutletWriteContext({ ...input, capability: "MANAGE_INVENTORY", explicitBranchInput: "A" }, database)).kind, "legacy_multi_branch");
    user.role = "BUSINESS_OWNER";
    assert.equal((await helper.resolveInventoryOutletReadContext({ ...input, explicitBranchInput: "" }, database)).kind, "legacy_multi_branch");
    branches.pop();
    assert.equal((await helper.resolveInventoryOutletReadContext({ ...input, explicitBranchInput: "" }, database)).kind, "denied");
    assert.equal((await helper.resolveInventoryOutletReadContext(input, database)).kind, "single_outlet");
    user.status = "inactive";
    assert.equal((await helper.resolveInventoryOutletWriteContext({ ...input, capability: "MANAGE_INVENTORY", explicitBranchInput: "A" }, database)).kind, "denied");
    user.status = "active"; branches.length = 0;
    assert.equal((await helper.resolveProductsOutletContext(input, database)).kind, "no_location");
  } finally { prisma.branch.findMany = previous; }
});

test("submission snapshot rejects fresh denial, Business switch, topology change and replacement branch", async () => {
  const helper = await importOutletUiContext().catch(() => null);
  assert.ok(helper, "Fresh outlet submission guard must exist");
  const rendered = { kind: "single_outlet", businessId: "business", internalBranchId: "A" } as const;
  for (const current of [
    { kind: "denied" },
    { kind: "no_location", businessId: "business" },
    { kind: "legacy_multi_branch", businessId: "business", branches: [{ id: "A", name: "A" }, { id: "B", name: "B" }], authorizedScope: { kind: "business" }, branchInput: { kind: "absent" } },
    { ...rendered, businessId: "foreign", branchNameSnapshot: "A", authorizedScope: { kind: "business" }, branchInput: { kind: "absent" } },
    { ...rendered, internalBranchId: "replacement", branchNameSnapshot: "A", authorizedScope: { kind: "business" }, branchInput: { kind: "absent" } },
  ]) assert.throws(() => helper.assertOutletSubmissionSnapshot(rendered, current as CurrentOutletContext), /location|access|changed/i);
  helper.assertOutletSubmissionSnapshot(rendered, { ...rendered, branchNameSnapshot: "Renamed", authorizedScope: { kind: "business" }, branchInput: { kind: "explicit", branchId: "A" } });
});

test("Product stock field scope rejects foreign/inactive IDs without mutating FormData", async () => {
  const helper = await importOutletUiContext();
  const context = { kind: "single_outlet", businessId: "business", internalBranchId: "A", branchNameSnapshot: "A", authorizedScope: { kind: "business" }, branchInput: { kind: "absent" } } as const;
  const form = new FormData(); form.set("stock_A", "10"); form.set("reorder_A", "2");
  helper.assertProductStockFields(form, context);
  assert.deepEqual([...form], [["stock_A", "10"], ["reorder_A", "2"]]);
  form.set("stock_inactive", "99");
  assert.throws(() => helper.assertProductStockFields(form, context), /location|scope/i);
  const metadata = new FormData(); metadata.set("name", "Shampoo");
  helper.assertProductStockFields(metadata, { kind: "no_location", businessId: "business" });
  assert.throws(() => helper.assertProductStockFields(form, { kind: "no_location", businessId: "business" }), /location|scope/i);
});

test("raw branch-bearing submission rejects duplicate or non-string explicit branch", async () => {
  const helper = await importOutletUiContext();
  assert.equal(typeof helper.outletBranchInput, "function", "FormData must be validated before selecting an internal location");
  const data = new FormData();
  assert.deepEqual(helper.outletBranchInput(data), {});
  data.set("branchId", "");
  assert.deepEqual(helper.outletBranchInput(data), { explicitBranchInput: "" });
  data.set("branchId", "A");
  assert.deepEqual(helper.outletBranchInput(data), { explicitBranchInput: "A" });
  data.append("branchId", "B");
  assert.throws(() => helper.outletBranchInput(data), /location|branch/i);
  data.set("branchId", new Blob(["A"]));
  assert.throws(() => helper.outletBranchInput(data), /location|branch/i);
});
