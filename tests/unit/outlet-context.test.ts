import assert from "node:assert/strict";
import test from "node:test";
import { importOutletContext } from "../helpers/outlet-server-import";
import type { OutletDatabase, OutletScopeResolver } from "../../src/lib/outlet-context";

function fixture(count = 1) {
  const events: string[] = [];
  const business = { id: "business", status: "active", industryType: "SALON_BEAUTY" };
  const branches = Array.from({ length: count }, (_, n) => ({ id: `branch-${n}`, name: `Store ${n}` }));
  const user = {
    id: "owner", businessId: business.id, branchId: null as string | null,
    role: "BUSINESS_OWNER", permissions: ["INVENTORY_VIEW"], status: "active", loginEnabled: true,
    business, branch: null as { id: string; businessId: string; status: string } | null,
  };
  const state = { enabled: true, user, branches };
  const database = {
    user: { findUnique: async () => { events.push("access"); return state.user; } },
    business: { findUnique: async () => business },
    businessGroupUser: { findFirst: async () => null },
    businessModuleEntitlement: { findMany: async () => {
      events.push("modules");
      return state.enabled ? ["POS", "INVENTORY"].map(moduleKey => ({ moduleKey, status: "ENABLED", enabledFrom: new Date(0), enabledUntil: null })) : [];
    } },
    branch: { findMany: async () => { events.push("topology"); return state.branches.map(b => ({ ...b })); } },
  } as unknown as OutletDatabase;
  const resolveScope: OutletScopeResolver = async ({ access }) => {
    events.push("scope");
    return access.effectiveBusinessRole === "BUSINESS_OWNER"
      ? { kind: "business" }
      : access.branchId ? { kind: "branches", branchIds: [access.branchId] } : { kind: "none" };
  };
  const input = { businessId: "business", actorUserId: "owner", capability: "VIEW_INVENTORY" as const, operation: "read" as const, resolveScope };
  return { state, database, input, events };
}

test("zero active branches returns no_location without a scope or writable ID", async () => {
  const { resolveCurrentOutletContext } = await importOutletContext();
  const f = fixture(0);
  assert.deepEqual(await resolveCurrentOutletContext(f.input, f.database), { kind: "no_location", businessId: "business" });
});

test("one authorized branch resolves only after fresh access, modules, topology and scope", async () => {
  const { resolveCurrentOutletContext } = await importOutletContext();
  const f = fixture();
  const result = await resolveCurrentOutletContext(f.input, f.database);
  assert.equal(result.kind, "single_outlet");
  if (result.kind !== "single_outlet") return;
  assert.equal(result.internalBranchId, "branch-0");
  assert.equal(result.branchNameSnapshot, "Store 0");
  assert.deepEqual(result.authorizedScope, { kind: "business" });
  assert.deepEqual(f.events, ["access", "modules", "topology", "scope"]);
});

for (const count of [2, 3]) {
  test(`${count} business branches stay legacy_multi_branch even with one visible branch`, async () => {
    const { resolveCurrentOutletContext } = await importOutletContext();
    const f = fixture(count);
    f.state.user.role = "STAFF";
    f.state.user.branch = { id: "branch-0", businessId: "business", status: "ACTIVE" };
    const result = await resolveCurrentOutletContext(f.input, f.database);
    assert.equal(result.kind, "legacy_multi_branch");
    if (result.kind === "legacy_multi_branch") assert.deepEqual(result.branches, [{ id: "branch-0", name: "Store 0" }]);
  });
}

test("Owner multi-branch resolution never chooses the first branch", async () => {
  const { resolveCurrentOutletContext } = await importOutletContext();
  const f = fixture(2);
  const result = await resolveCurrentOutletContext(f.input, f.database);
  assert.equal(result.kind, "legacy_multi_branch");
  assert.equal("internalBranchId" in result, false);
  if (result.kind === "legacy_multi_branch") assert.equal(result.branches.length, 2);
});

test("Staff with no branch scope is denied without leaking topology", async () => {
  const { resolveCurrentOutletContext } = await importOutletContext();
  const f = fixture(); f.state.user.role = "STAFF";
  assert.deepEqual(await resolveCurrentOutletContext(f.input, f.database), { kind: "denied" });
});

for (const explicitBranchInput of ["unknown", "foreign-business-branch", "", "   ", null]) {
  test(`explicit ${JSON.stringify(explicitBranchInput)} never falls back to the sole branch`, async () => {
    const { resolveCurrentOutletContext } = await importOutletContext();
    const f = fixture();
    assert.deepEqual(await resolveCurrentOutletContext({ ...f.input, explicitBranchInput }, f.database), { kind: "denied" });
  });
}

test("valid explicit branch is retained and distinguished from absent input", async () => {
  const { resolveCurrentOutletContext } = await importOutletContext();
  const f = fixture();
  const result = await resolveCurrentOutletContext({ ...f.input, explicitBranchInput: "branch-0" }, f.database);
  assert.equal(result.kind, "single_outlet");
  if (result.kind === "single_outlet") assert.deepEqual(result.branchInput, { kind: "explicit", branchId: "branch-0" });
  const absent = await resolveCurrentOutletContext(f.input, f.database);
  if (absent.kind === "single_outlet") assert.deepEqual(absent.branchInput, { kind: "absent" });
});

test("explicit current-business but unauthorized branch fails closed", async () => {
  const { resolveCurrentOutletContext } = await importOutletContext();
  const f = fixture(2); f.state.user.role = "STAFF";
  f.state.user.branch = { id: "branch-0", businessId: "business", status: "ACTIVE" };
  assert.deepEqual(await resolveCurrentOutletContext({ ...f.input, explicitBranchInput: "branch-1" }, f.database), { kind: "denied" });
});

test("topology changes are resolved afresh, not cached", async () => {
  const { resolveCurrentOutletContext } = await importOutletContext();
  const f = fixture();
  assert.equal((await resolveCurrentOutletContext(f.input, f.database)).kind, "single_outlet");
  f.state.branches.push({ id: "branch-1", name: "New Store" });
  assert.equal((await resolveCurrentOutletContext(f.input, f.database)).kind, "legacy_multi_branch");
  f.state.branches.length = 0;
  assert.equal((await resolveCurrentOutletContext(f.input, f.database)).kind, "no_location");
});

test("revocation on replay is checked before any topology or scope data", async () => {
  const { resolveCurrentOutletContext } = await importOutletContext();
  const f = fixture(); await resolveCurrentOutletContext(f.input, f.database);
  f.state.user.status = "inactive"; f.events.length = 0;
  assert.deepEqual(await resolveCurrentOutletContext(f.input, f.database), { kind: "denied" });
  assert.deepEqual(f.events, ["access"]);
});

test("module disabled blocks topology reads", async () => {
  const { resolveCurrentOutletContext } = await importOutletContext();
  const f = fixture(); f.state.enabled = false;
  assert.deepEqual(await resolveCurrentOutletContext(f.input, f.database), { kind: "denied" });
  assert.deepEqual(f.events, ["access", "modules"]);
});

test("scope resolver is mandatory and unknown/foreign scope fails closed", async () => {
  const { resolveCurrentOutletContext } = await importOutletContext();
  const f = fixture();
  for (const scope of [{ kind: "branches", branchIds: ["foreign"] }, { kind: "branches", branchIds: [] }, { kind: "none" }]) {
    const resolveScope = async () => scope;
    assert.deepEqual(await resolveCurrentOutletContext({ ...f.input, resolveScope: resolveScope as OutletScopeResolver }, f.database), { kind: "denied" });
  }
  assert.deepEqual(await resolveCurrentOutletContext({ ...f.input, resolveScope: undefined } as unknown as typeof f.input, f.database), { kind: "denied" });
});

test("Expense-style business scope keeps explicit null instead of forcing a Branch write", async () => {
  const { resolveCurrentOutletContext } = await importOutletContext();
  const f = fixture();
  const result = await resolveCurrentOutletContext({ ...f.input, explicitBranchInput: null,
    resolveScope: async () => ({ kind: "business", allowExplicitBusinessWide: true }),
  }, f.database);
  assert.equal(result.kind, "single_outlet");
  if (result.kind === "single_outlet") {
    assert.deepEqual(result.branchInput, { kind: "business", value: null });
    assert.equal(result.authorizedScope.kind, "business");
  }
});

test("Group Manager cannot turn a read capability/scope into an outlet write", async () => {
  const { resolveCurrentOutletContext } = await importOutletContext();
  const f = fixture();
  f.state.user.businessId = "home";
  f.state.user.business = { ...f.state.user.business, id: "home" };
  f.database.businessGroupUser.findFirst = (async () => ({
    id: "grant", groupId: "group", role: "GROUP_MANAGER", status: "ACTIVE",
    accessScope: "SELECTED_BUSINESSES", businessAccesses: [{ businessId: "business" }],
  })) as unknown as typeof f.database.businessGroupUser.findFirst;
  const result = await resolveCurrentOutletContext({ ...f.input, operation: "write",
    resolveScope: async () => ({ kind: "business" }),
  }, f.database);
  assert.deepEqual(result, { kind: "denied" });
});

test("request identity is snapshotted across awaits and cannot change the authorized tenant", async () => {
  const { resolveCurrentOutletContext } = await importOutletContext();
  const f = fixture();
  f.database.businessModuleEntitlement.findMany = (async () => {
    f.input.businessId = "foreign";
    return ["POS", "INVENTORY"].map(moduleKey => ({ moduleKey, status: "ENABLED", enabledFrom: new Date(0), enabledUntil: null }));
  }) as unknown as typeof f.database.businessModuleEntitlement.findMany;
  let queriedBusiness = "";
  f.database.branch.findMany = (async (query: { where: { businessId: string } }) => {
    queriedBusiness = query.where.businessId;
    return f.state.branches;
  }) as unknown as typeof f.database.branch.findMany;
  const result = await resolveCurrentOutletContext(f.input, f.database);
  assert.equal(queriedBusiness, "business");
  assert.equal(result.kind, "single_outlet");
  if (result.kind === "single_outlet") assert.equal(result.businessId, "business");
});
