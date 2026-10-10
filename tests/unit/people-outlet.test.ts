import assert from "node:assert/strict";
import test from "node:test";
import { importOutletContext } from "../helpers/outlet-server-import";
import { preparePeopleOutletForm, canSimplifyPeopleWorkplace } from "../../src/lib/team/people-outlet";

const topology = { kind: "single_outlet" as const, internalBranchId: "A", branchNameSnapshot: "Outlet A" };
const assignment = { branchId: "A", status: "ACTIVE" as const, isPrimary: true, canClockIn: true,
  effectiveFrom: new Date("2024-01-01"), effectiveUntil: null };

test("omitted workplace edit preserves exact assignment dates and primary, without normalizing history", () => {
  const form = new FormData();
  form.set("peopleOutletBranchId", "A");
  form.set("peopleOutletMode", "single_outlet");
  const result = preparePeopleOutletForm({ formData: form, topology, allowedBranchIds: ["A"],
    existing: { status: "ACTIVE", assignments: [assignment], posHomeBranchId: "A" } });
  assert.deepEqual(result.preservedAssignments, [assignment]);
  assert.equal(result.formData.get("primaryBranchId"), "A");
  assert.equal(form.has("branchIds"), false, "does not mutate caller FormData");
});

test("simplified create uses the fresh sole workplace, with explicit can-clock-in boolean", () => {
  const form = new FormData();
  form.set("peopleOutletMode", "single_outlet");
  form.set("peopleOutletBranchId", "A");
  form.set("peopleCanClockIn", "off");
  const result = preparePeopleOutletForm({ formData: form, topology, allowedBranchIds: ["A"] });
  assert.deepEqual(result.formData.getAll("branchIds"), ["A"]);
  assert.deepEqual(result.formData.getAll("canClockInBranchIds"), []);
});

test("stale topology, revoked scope and explicit malicious location payload never silently auto-assign", () => {
  for (const field of ["branchIds", "branchId", "primaryBranchId", "assignmentId", "userBranchId", "canClockInBranchIds"]) {
    const form = new FormData();
    form.set("peopleOutletMode", "single_outlet"); form.set("peopleOutletBranchId", "A"); form.set(field, "foreign");
    assert.throws(() => preparePeopleOutletForm({ formData: form, topology, allowedBranchIds: ["A"] }), /location|workplace/i);
  }
  const form = new FormData(); form.set("peopleOutletMode", "single_outlet"); form.set("peopleOutletBranchId", "A");
  assert.throws(() => preparePeopleOutletForm({ formData: form, topology: { kind: "legacy_multi_branch" }, allowedBranchIds: ["A"] }), /reload/i);
  assert.throws(() => preparePeopleOutletForm({ formData: form, topology, allowedBranchIds: [] }), /scope/i);
});

test("terminated, missing primary, foreign home and extra active assignments keep management UI", () => {
  assert.equal(canSimplifyPeopleWorkplace(topology, { status: "ACTIVE", assignments: [assignment], posHomeBranchId: "A" }), true);
  for (const existing of [
    { status: "TERMINATED", assignments: [] },
    { status: "ACTIVE", assignments: [] },
    { status: "ACTIVE", assignments: [{ ...assignment, isPrimary: false }] },
    { status: "ACTIVE", assignments: [assignment], posHomeBranchId: "B" },
    { status: "ACTIVE", assignments: [assignment, { ...assignment, branchId: "B" }] },
  ]) assert.equal(canSimplifyPeopleWorkplace(topology, existing), false);
  assert.equal(canSimplifyPeopleWorkplace({ kind: "legacy_multi_branch" }, { status: "ACTIVE", assignments: [assignment] }), false);
});

test("simplified ordinary edit rejects a stale employment revision before reconstructing omitted fields", () => {
  const form = new FormData(); form.set("peopleOutletMode", "single_outlet"); form.set("peopleOutletBranchId", "A");
  form.set("peopleOutletExpectedUpdatedAt", "2024-01-01T00:00:00.000Z");
  assert.throws(() => preparePeopleOutletForm({ formData: form, topology, allowedBranchIds: ["A"], existing: {
    status: "ACTIVE", assignments: [assignment], updatedAt: "2024-02-01T00:00:00.000Z",
  } as Parameters<typeof preparePeopleOutletForm>[0]["existing"] }), /changed|reload/i);
});

test("People topology counts the whole Business, not the actor's one visible workplace", async () => {
  const outletModule = await importOutletContext();
  const resolve = (outletModule as Record<string, unknown>).resolveBusinessOutletTopology;
  assert.equal(typeof resolve, "function", "canonical topology-only helper is required");
  const fn = resolve as (id: string, db: unknown) => Promise<unknown>;
  let query: unknown;
  const db = { branch: { findMany: async (args: unknown) => {
    query = args;
    return [{ id: "A", name: "A" }, { id: "B", name: "B" }];
  } } };
  assert.deepEqual(await fn("business", db), { kind: "legacy_multi_branch" });
  assert.deepEqual(query, { where: { businessId: "business", status: "ACTIVE" },
    select: { id: true, name: true }, orderBy: [{ name: "asc" }, { id: "asc" }] });
});
