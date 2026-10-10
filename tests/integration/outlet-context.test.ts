import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { prisma } from "../../src/lib/prisma";
import { resolveInventoryReadScope } from "../../src/lib/inventory/authorization";
import { importOutletContext } from "../helpers/outlet-server-import";
import type { OutletScopeResolver } from "../../src/lib/outlet-context";

test("outlet adapter uses real fresh access and existing module scope in an isolated DB", async t => {
  const url = new URL(process.env.DATABASE_URL ?? "");
  assert.ok(["127.0.0.1", "localhost"].includes(url.hostname));
  assert.match(url.pathname, /^\/tetamu_outlet_adapter_disposable_\d+$/);
  assert.equal(url.port, "55439", "never connect to the original Local cluster");
  const db = new PrismaClient();
  const { resolveCurrentOutletContext } = await importOutletContext();
  try {
    const suffix = randomUUID();
    const businesses = await Promise.all(["zero", "one", "historical", "multi", "home"].map(name =>
      db.business.create({ data: { name: `Outlet adapter ${name}`, slug: `outlet-${name}-${suffix}` } })));
    const [zero, one, historical, multi, home] = businesses;
    await db.businessModuleEntitlement.createMany({ data: businesses.flatMap(business => ["POS", "INVENTORY"].map(moduleKey => ({
      businessId: business.id, moduleKey: moduleKey as "INVENTORY", status: "ENABLED" as const,
      source: "MANUAL" as const, enabledFrom: new Date(0),
    }))) });
    const makeBranch = (businessId: string, name: string, status: "ACTIVE" | "INACTIVE" = "ACTIVE") =>
      db.branch.create({ data: { businessId, name, status } });
    const [sole, current, old, a, b] = await Promise.all([
      makeBranch(one.id, "Sole"), makeBranch(historical.id, "Current"), makeBranch(historical.id, "Old", "INACTIVE"),
      makeBranch(multi.id, "A"), makeBranch(multi.id, "B"),
    ]);
    const owners = await Promise.all(businesses.map(business => db.user.create({ data: {
      businessId: business.id, name: "Synthetic Owner", role: "BUSINESS_OWNER",
    } })));
    const [staff, noScope] = await Promise.all([a.id, null].map(branchId => db.user.create({ data: {
      businessId: multi.id, branchId, name: "Synthetic Staff", role: "STAFF", permissions: ["INVENTORY_VIEW"],
    } })));
    const group = await db.businessGroup.create({ data: { name: "Adapter Group", code: `adapter-${suffix}` } });
    await db.businessGroupMember.createMany({ data: [one, multi].map(business => ({ groupId: group.id, businessId: business.id })) });
    const managers = await Promise.all((["STAFF", "BUSINESS_OWNER"] as const).map(role => db.user.create({ data: {
      businessId: home.id, name: "Synthetic Group Manager", role,
    } })));
    const grants = await Promise.all(managers.map(manager => db.businessGroupUser.create({ data: {
      groupId: group.id, userId: manager.id, role: "GROUP_MANAGER", accessScope: "SELECTED_BUSINESSES",
      businessAccesses: { create: [one, multi].map(business => ({ businessId: business.id })) },
    } })));
    const readScope: OutletScopeResolver = ({ businessId, access }) => resolveInventoryReadScope(businessId, access);
    const resolve = (businessId: string, actorUserId: string, extra: Partial<Parameters<typeof resolveCurrentOutletContext>[0]> = {}) =>
      resolveCurrentOutletContext({ businessId, actorUserId, capability: "VIEW_INVENTORY", operation: "read", resolveScope: readScope, ...extra }, db);

    await t.test("zero active branches cannot become a business-wide reader result", async () => {
      assert.deepEqual(await resolve(zero.id, owners[0].id), { kind: "no_location", businessId: zero.id });
    });
    await t.test("one active branch Owner obtains its internal branch", async () => {
      const result = await resolve(one.id, owners[1].id);
      assert.equal(result.kind, "single_outlet");
      if (result.kind === "single_outlet") assert.equal(result.internalBranchId, sole.id);
    });
    await t.test("active + historical inactive remains single without rewriting the document", async () => {
      const supplier = await db.supplier.create({ data: { businessId: historical.id, name: "Historical Supplier" } });
      const document = await db.purchaseOrder.create({ data: {
        businessId: historical.id, branchId: old.id, supplierId: supplier.id, poNumber: "HISTORICAL-1",
        orderDate: new Date(), createdById: owners[2].id,
      } });
      const before = await db.purchaseOrder.findUniqueOrThrow({ where: { id: document.id } });
      const result = await resolve(historical.id, owners[2].id);
      assert.equal(result.kind, "single_outlet");
      if (result.kind === "single_outlet") assert.equal(result.internalBranchId, current.id);
      assert.deepEqual(await db.purchaseOrder.findUniqueOrThrow({ where: { id: document.id } }), before);
    });
    await t.test("two branches Owner sees two without auto-selecting", async () => {
      const result = await resolve(multi.id, owners[3].id);
      assert.equal(result.kind, "legacy_multi_branch");
      if (result.kind === "legacy_multi_branch") assert.deepEqual(result.branches.map(row => row.id), [a.id, b.id]);
      assert.equal("internalBranchId" in result, false);
    });
    await t.test("two branches Staff with one scope remains legacy_multi_branch", async () => {
      const result = await resolve(multi.id, staff.id);
      assert.equal(result.kind, "legacy_multi_branch");
      if (result.kind === "legacy_multi_branch") assert.deepEqual(result.branches.map(row => row.id), [a.id]);
    });
    await t.test("no-scope Staff is denied, not business-wide", async () => {
      assert.deepEqual(await resolve(multi.id, noScope.id), { kind: "denied" });
    });
    await t.test("GM original STAFF and OWNER have equal read scope and no Inventory writes", async () => {
      for (const business of [one, multi]) {
        assert.deepEqual(await resolve(business.id, managers[0].id), await resolve(business.id, managers[1].id));
        for (const manager of managers) {
          for (const capability of ["MANAGE_INVENTORY", "VIEW_INVENTORY"] as const) {
            assert.deepEqual(await resolve(business.id, manager.id, { capability, operation: "write" }), { kind: "denied" });
          }
        }
      }
    });
    await t.test("explicit valid branch remains explicit", async () => {
      const result = await resolve(one.id, owners[1].id, { explicitBranchInput: sole.id });
      assert.equal(result.kind, "single_outlet");
      if (result.kind === "single_outlet") assert.deepEqual(result.branchInput, { kind: "explicit", branchId: sole.id });
    });
    for (const [name, explicitBranchInput] of [["invalid", randomUUID()], ["cross-business", a.id], ["null", null], ["empty", ""]] as const) {
      await t.test(`explicit ${name} fails closed`, async () => {
        assert.deepEqual(await resolve(one.id, owners[1].id, { explicitBranchInput }), { kind: "denied" });
      });
    }
    await t.test("explicit unauthorized current-business branch fails closed", async () => {
      assert.deepEqual(await resolve(multi.id, staff.id, { explicitBranchInput: b.id }), { kind: "denied" });
    });
    await t.test("cross-business actor is denied", async () => {
      assert.deepEqual(await resolve(one.id, staff.id), { kind: "denied" });
    });
    await t.test("Business switch never reuses old internal branch", async () => {
      assert.equal((await resolve(one.id, managers[1].id)).kind, "single_outlet");
      const result = await resolve(multi.id, managers[1].id);
      assert.equal(result.kind, "legacy_multi_branch");
      if (result.kind === "legacy_multi_branch") assert.ok(result.branches.every(row => row.id !== sole.id));
    });
    await t.test("topology refresh changes mode", async () => {
      const second = await makeBranch(one.id, "Second");
      assert.equal((await resolve(one.id, owners[1].id)).kind, "legacy_multi_branch");
      await db.branch.update({ where: { id: second.id }, data: { status: "INACTIVE" } });
      assert.equal((await resolve(one.id, owners[1].id)).kind, "single_outlet");
    });
    await t.test("revoked group grant rejects replay", async () => {
      assert.equal((await resolve(one.id, managers[0].id)).kind, "single_outlet");
      await db.businessGroupUser.update({ where: { id: grants[0].id }, data: { status: "REVOKED" } });
      assert.deepEqual(await resolve(one.id, managers[0].id), { kind: "denied" });
    });
    await t.test("revoked Staff permission rejects replay", async () => {
      await db.user.update({ where: { id: staff.id }, data: { permissions: [] } });
      assert.deepEqual(await resolve(multi.id, staff.id), { kind: "denied" });
    });
    await t.test("Expense-style null scope remains explicit business-wide intent", async () => {
      const result = await resolve(one.id, owners[1].id, { explicitBranchInput: null,
        resolveScope: async () => ({ kind: "business", allowExplicitBusinessWide: true }),
      });
      assert.equal(result.kind, "single_outlet");
      if (result.kind === "single_outlet") assert.deepEqual(result.branchInput, { kind: "business", value: null });
    });
  } finally {
    // Immutable fixture history is disposed with the entire isolated database.
    await db.$disconnect();
    await prisma.$disconnect();
  }
});
