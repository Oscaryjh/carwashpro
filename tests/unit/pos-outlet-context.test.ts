import assert from "node:assert/strict";
import test from "node:test";
import { importPosOutletContext } from "../helpers/pos-outlet-server-import";
import type { OutletDatabase } from "../../src/lib/outlet-context";

function fixture(count = 1) {
  const business = { id: "business", status: "active", industryType: "SALON_BEAUTY" };
  const state = { user: { id: "owner", businessId: "business", branchId: null as string | null,
    role: "BUSINESS_OWNER", permissions: ["POS", "APPOINTMENTS"], status: "active", loginEnabled: true,
    business, branch: null as { id: string; businessId: string; status: string } | null },
    branches: Array.from({ length: count }, (_, i) => ({ id: `branch-${i}`, name: `Store ${i}` })) };
  const database = { user: { findUnique: async () => state.user }, business: { findUnique: async () => business },
    businessGroupUser: { findFirst: async () => null },
    businessModuleEntitlement: { findMany: async () => ["POS", "SALON"].map(moduleKey => ({ moduleKey, status: "ENABLED", enabledFrom: new Date(0), enabledUntil: null })) },
    branch: { findMany: async () => state.branches } } as unknown as OutletDatabase;
  return { state, database, input: { businessId: "business", actorUserId: "owner" } };
}

test("Cashier and Appointment consume the existing adapter and retain business topology", async () => {
  const { resolvePosOutletContext } = await importPosOutletContext();
  const f = fixture();
  for (const capability of ["PROCESS_CASHIER_PAYMENT", "MODIFY_APPOINTMENTS"] as const) {
    const context = await resolvePosOutletContext({ ...f.input, capability, operation: "write" }, f.database);
    assert.equal(context.kind, "single_outlet");
    if (context.kind === "single_outlet") assert.equal(context.internalBranchId, "branch-0");
  }
  f.state.branches.push({ id: "branch-1", name: "Store 1" });
  f.state.user.role = "STAFF"; f.state.user.branchId = "branch-0";
  f.state.user.branch = { id: "branch-0", businessId: "business", status: "ACTIVE" };
  const context = await resolvePosOutletContext({ ...f.input, capability: "PROCESS_CASHIER_PAYMENT", operation: "write" }, f.database);
  assert.equal(context.kind, "legacy_multi_branch");
  if (context.kind === "legacy_multi_branch") assert.deepEqual(context.branches.map(b => b.id), ["branch-0"]);
});

test("explicit invalid/cross-business/unauthorized branches never fall back", async () => {
  const { resolvePosOutletContext } = await importPosOutletContext(); const f = fixture(2);
  f.state.user.role = "STAFF"; f.state.user.branchId = "branch-0";
  f.state.user.branch = { id: "branch-0", businessId: "business", status: "ACTIVE" };
  for (const explicitBranchInput of ["branch-1", "foreign", "invalid", "", null]) {
    assert.equal((await resolvePosOutletContext({ ...f.input, capability: "MODIFY_APPOINTMENTS", operation: "write", explicitBranchInput }, f.database)).kind, "denied");
  }
});

test("fresh topology, revoked capability and no-scope are denied before submit", async () => {
  const { resolvePosOutletContext, guardPosOutletSubmission } = await importPosOutletContext(); const f = fixture();
  const input = { ...f.input, capability: "MODIFY_APPOINTMENTS" as const, operation: "write" as const };
  const rendered = await resolvePosOutletContext(input, f.database);
  const form = new FormData(); form.set("branchId", "branch-0");
  await guardPosOutletSubmission({ ...input, rendered, formData: form }, f.database);
  await assert.rejects(guardPosOutletSubmission({ ...input, businessId: "other-business", rendered, formData: form }, f.database), /Business access changed/);
  f.state.branches.push({ id: "branch-1", name: "Store 1" });
  await assert.rejects(guardPosOutletSubmission({ ...input, rendered, formData: form }, f.database), /changed|Reload/);
  f.state.branches.pop(); f.state.user.role = "STAFF"; f.state.user.permissions = [];
  f.state.user.branchId = "branch-0"; f.state.user.branch = { id: "branch-0", businessId: "business", status: "ACTIVE" };
  await assert.rejects(guardPosOutletSubmission({ ...input, rendered, formData: form }, f.database));
  f.state.user.branchId = null; f.state.user.branch = null;
  assert.equal((await resolvePosOutletContext(input, f.database)).kind, "denied");
});

test("zero location does not yield a sale or appointment branch", async () => {
  const { resolvePosOutletContext, selectCashierOutletBranch } = await importPosOutletContext(); const f = fixture(0);
  const context = await resolvePosOutletContext({ ...f.input, capability: "PROCESS_CASHIER_PAYMENT", operation: "write" }, f.database);
  assert.equal(context.kind, "no_location");
  assert.throws(() => selectCashierOutletBranch({ context }), /location/);
});

test("Appointment then Shift locks remain authoritative and never become current outlet", async () => {
  const { resolvePosOutletContext, selectCashierOutletBranch } = await importPosOutletContext(); const f = fixture();
  const context = await resolvePosOutletContext({ ...f.input, capability: "PROCESS_CASHIER_PAYMENT", operation: "write" }, f.database);
  assert.equal(selectCashierOutletBranch({ context, appointmentBranchId: "historical" }), "historical");
  assert.equal(selectCashierOutletBranch({ context, shiftBranchId: "historical" }), "historical");
  assert.throws(() => selectCashierOutletBranch({ context, appointmentBranchId: "historical", shiftBranchId: "branch-0" }), /match|branch/i);
  assert.throws(() => selectCashierOutletBranch({ context, appointmentBranchId: "historical", explicitBranchId: "branch-0" }), /match|branch/i);
  assert.equal(selectCashierOutletBranch({ context, explicitBranchId: "branch-0" }), "branch-0");
  assert.throws(() => selectCashierOutletBranch({ context, explicitBranchId: "foreign" }), /branch/i);
});
