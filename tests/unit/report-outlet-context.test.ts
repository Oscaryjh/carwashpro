import assert from "node:assert/strict";
import test from "node:test";
import { reportOutletModule } from "../helpers/report-outlet-import";
import type { OutletDatabase } from "../../src/lib/outlet-context";

function fixture(count = 1) {
  const business = { id: "business", status: "active", industryType: "SALON_BEAUTY" };
  const branches = Array.from({ length: count }, (_, i) => ({ id: `branch-${i}`, businessId: "business", name: `Store ${i}`, status: "ACTIVE" }));
  const user = { id: "owner", businessId: business.id, role: "BUSINESS_OWNER", permissions: ["DASHBOARD", "REPORTS", "PERFORMANCE_VIEW_TEAM"], status: "active", loginEnabled: true, branchId: "branch-0", business, branch: { id: "branch-0", businessId: business.id, status: "ACTIVE" } };
  const state = { user, branches, historical: { id: "historical", name: "Old store", businessId: business.id, status: "INACTIVE" } };
  const database = {
    user: { findUnique: async () => state.user }, business: { findUnique: async () => business },
    businessGroupUser: { findFirst: async () => null },
    businessModuleEntitlement: { findMany: async () => ["POS", "PERFORMANCE"].map(moduleKey => ({ moduleKey, status: "ENABLED", enabledFrom: new Date(0), enabledUntil: null })) },
    branch: { findMany: async (arg: { where: { status?: string } }) => arg.where.status ? state.branches : [...state.branches, state.historical] },
  } as unknown as OutletDatabase;
  return { state, database, input: { businessId: "business", actorUserId: "owner", surface: "dashboard" as const } };
}

test("current dashboard binds the sole operational branch without removing business-wide Expense scope", async () => {
  const { resolveReportOutletScope } = await reportOutletModule();
  assert.equal(typeof resolveReportOutletScope, "function", "report scope adapter is required");
  const f = fixture(); const scope = await resolveReportOutletScope(f.input, f.database);
  assert.equal(scope.kind, "ready"); if (scope.kind !== "ready") return;
  assert.equal(scope.topologyMode, "single_outlet");
  assert.deepEqual(scope.selection, { kind: "branch", branchId: "branch-0" });
  assert.deepEqual(scope.expenseScope, { allowedBranchIds: ["branch-0"], includeBusinessWide: true });
});

for (const surface of ["dashboard", "reports", "performance"] as const) {
  for (const explicitBranchInput of ["unknown", "foreign", "historical", ["branch-0", "foreign"]]) {
    if (surface === "performance" && explicitBranchInput === "historical") continue;
    test(`${surface} rejects explicit ${JSON.stringify(explicitBranchInput)} without fallback`, async () => {
      const { resolveReportOutletScope } = await reportOutletModule(); const f = fixture();
      assert.equal((await resolveReportOutletScope({ ...f.input, surface, explicitBranchInput }, f.database)).kind, "denied");
    });
  }
  test(`${surface} zero active branches never falls back business-wide`, async () => {
    const { resolveReportOutletScope } = await reportOutletModule(); const f = fixture(0);
    assert.equal((await resolveReportOutletScope({ ...f.input, surface }, f.database)).kind, "no_location");
  });
  test(`${surface} multi topology survives one visible Staff branch`, async () => {
    const { resolveReportOutletScope } = await reportOutletModule(); const f = fixture(2); f.state.user.role = "STAFF";
    const result = await resolveReportOutletScope({ ...f.input, surface }, f.database);
    assert.equal(result.kind, "ready"); if (result.kind !== "ready") return;
    assert.equal(result.topologyMode, "legacy_multi_branch"); assert.deepEqual(result.branches.map(b => b.id), ["branch-0"]);
  });
  test(`${surface} rechecks permissions and topology on the next request`, async () => {
    const { resolveReportOutletScope } = await reportOutletModule(); const f = fixture();
    assert.equal((await resolveReportOutletScope({ ...f.input, surface }, f.database)).kind, "ready");
    f.state.branches.push({ id: "branch-1", businessId: "business", name: "Second", status: "ACTIVE" });
    const changed = await resolveReportOutletScope({ ...f.input, surface }, f.database);
    assert.equal(changed.kind, "ready"); if (changed.kind === "ready") assert.equal(changed.topologyMode, "legacy_multi_branch");
    f.state.user.status = "inactive";
    assert.equal((await resolveReportOutletScope({ ...f.input, surface }, f.database)).kind, "denied");
  });
}

test("explicit historical Performance retains its inactive branch, including zero active topology", async () => {
  const { resolveReportOutletScope } = await reportOutletModule(); const f = fixture(0);
  const result = await resolveReportOutletScope({ ...f.input, surface: "performance", explicitBranchInput: "historical" }, f.database);
  assert.equal(result.kind, "ready"); if (result.kind !== "ready") return;
  assert.deepEqual(result.selection, { kind: "branch", branchId: "historical" }); assert.equal(result.historical, true);
});

test("inactive-assigned Staff remains denied by existing tenant effective-access contract", async () => {
  const { resolveReportOutletScope } = await reportOutletModule(); const f = fixture();
  f.state.user.role = "STAFF";
  f.state.user.branchId = f.state.historical.id;
  f.state.user.branch = { id: f.state.historical.id, businessId: "business", status: "INACTIVE" };
  // The low-level historical reader accepts an own inactive branch, but the
  // existing tenant entrance already clears that Staff branch from effective access.
  const result = await resolveReportOutletScope({ ...f.input, surface: "performance", explicitBranchInput: f.state.historical.id }, f.database);
  assert.equal(result.kind, "denied");
});

test("legacy Reports all branches remains an explicit business scope, not current single scope", async () => {
  const { resolveReportOutletScope } = await reportOutletModule(); const f = fixture(2);
  const result = await resolveReportOutletScope({ ...f.input, surface: "reports" }, f.database);
  assert.equal(result.kind, "ready"); if (result.kind === "ready") assert.deepEqual(result.selection, { kind: "business" });
});

test("Staff without an operational branch cannot gain current report access", async () => {
  const { resolveReportOutletScope } = await reportOutletModule(); const f = fixture();
  f.state.user.role = "STAFF"; f.state.user.branch.status = "INACTIVE";
  for (const surface of ["dashboard", "reports", "performance"] as const) assert.equal((await resolveReportOutletScope({ ...f.input, surface }, f.database)).kind, "denied");
});

test("GM effective scope is identity independent, Performance denied, and requests do not cache actor scope", async () => {
  const { resolveReportOutletScope } = await reportOutletModule(); const f = fixture(2);
  f.state.user.businessId="home";
  f.database.businessGroupUser.findFirst = (async () => ({id:"grant",groupId:"group",role:"GROUP_MANAGER",status:"ACTIVE",accessScope:"SELECTED_BUSINESSES",businessAccesses:[{businessId:"business"}]})) as unknown as typeof f.database.businessGroupUser.findFirst;
  for(const surface of ["dashboard","reports"] as const){
    const selections=[];
    for(const role of ["STAFF","BUSINESS_OWNER"]){
      f.state.user.role=role;
      const result=await resolveReportOutletScope({...f.input,surface},f.database);
      assert.equal(result.kind,"ready");if(result.kind==="ready"){
        assert.equal(result.access.effectiveBusinessRole,"GROUP_MANAGER_READ_ONLY");
        selections.push(result.selection);
      }
    }
    assert.deepEqual(selections[0],selections[1]);
  }
  assert.equal((await resolveReportOutletScope({...f.input,surface:"performance"},f.database)).kind,"denied");
  f.state.user.businessId="business"; f.state.user.role="STAFF";
  const own=await resolveReportOutletScope(f.input,f.database);
  assert.equal(own.kind,"ready");if(own.kind==="ready")assert.deepEqual(own.selection,{kind:"authorized_branches",branchIds:["branch-0"]});
  assert.equal((await resolveReportOutletScope({...f.input,explicitBranchInput:"branch-1"},f.database)).kind,"denied");
});
