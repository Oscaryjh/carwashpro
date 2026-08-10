import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { AppSession } from "../../src/lib/auth/session";
import {
  ModuleNotEnabledError,
  loadBusinessModuleContext,
  requireBusinessModule,
} from "../../src/lib/modules/entitlements";
import {
  CORE_MODULE_SYSTEM_REQUIRED,
  DEPENDENT_MODULE_ENABLED,
  MODULE_DEPENDENCY_REQUIRED,
  changeBusinessModuleEntitlement,
} from "../../src/lib/modules/service";
import { prisma } from "../../src/lib/prisma";

test("effective entitlement, dependency, audit and idempotency are canonical", async () => {
  assertLocalDatabase();
  const fixture = await createFixture();
  const future = new Date("2026-08-12T00:00:00.000Z");

  await assert.rejects(
    change(fixture, "PAYROLL", "ENABLED", future),
    new RegExp(MODULE_DEPENDENCY_REQUIRED),
  );
  const hr = await change(fixture, "HR", "ENABLED", new Date("2026-08-01T00:00:00.000Z"));
  await change(fixture, "PAYROLL", "ENABLED", future);

  const beforeFuture = await loadBusinessModuleContext(fixture.businessId, { now: new Date("2026-08-11T00:00:00.000Z") });
  const afterFuture = await loadBusinessModuleContext(fixture.businessId, { now: new Date("2026-08-13T00:00:00.000Z") });
  assert.equal(beforeFuture.enabledModules.has("PAYROLL"), false);
  assert.equal(afterFuture.enabledModules.has("PAYROLL"), true);
  assert.equal(afterFuture.enabledModules.has("HR"), true);

  const duplicate = await changeBusinessModuleEntitlement({
    actor: fixture.actor,
    rawInput: {
      businessId: fixture.businessId,
      moduleKey: "HR",
      status: "ENABLED",
      enabledFrom: "2026-08-01T00:00:00.000Z",
      enabledUntil: "",
      source: "MANUAL",
      reason: "Idempotent retry.",
      expectedRevision: hr.entitlement.revision,
    },
  });
  assert.equal(duplicate.changed, false);
  assert.equal(await prisma.businessModuleEntitlementEvent.count({ where: { entitlementId: hr.entitlement.id } }), 1);
  assert.equal(await prisma.auditLog.count({ where: { businessId: fixture.businessId, action: "BUSINESS_MODULE_ENTITLEMENT_CHANGED" } }), 2);

  await assert.rejects(
    change(fixture, "HR", "DISABLED", new Date("2026-08-13T00:00:00.000Z")),
    new RegExp(DEPENDENT_MODULE_ENABLED),
  );
  await assert.rejects(
    change(fixture, "CORE", "DISABLED", new Date()),
    new RegExp(CORE_MODULE_SYSTEM_REQUIRED),
  );
});

test("disable and re-enable preserves historical HR data", async () => {
  assertLocalDatabase();
  const fixture = await createFixture();
  await change(fixture, "HR", "ENABLED", new Date("2026-01-01T00:00:00.000Z"));
  const policy = await prisma.leavePolicy.create({ data: { businessId: fixture.businessId, code: "OTHER", name: "Preserved Leave" } });
  await change(fixture, "HR", "DISABLED", new Date("2026-08-10T00:00:00.000Z"));
  await assert.rejects(requireBusinessModule(fixture.businessId, "HR"), ModuleNotEnabledError);
  assert.equal(await prisma.leavePolicy.count({ where: { id: policy.id, businessId: fixture.businessId } }), 1);
  await change(fixture, "HR", "ENABLED", new Date("2026-08-10T00:01:00.000Z"));
  await requireBusinessModule(fixture.businessId, "HR", { now: new Date("2026-08-10T00:02:00.000Z") });
  assert.equal(await prisma.leavePolicy.count({ where: { id: policy.id, businessId: fixture.businessId } }), 1);
});

test("concurrent dependency mutations cannot leave Payroll enabled without HR", async () => {
  assertLocalDatabase();
  const fixture = await createFixture();
  await change(fixture, "HR", "ENABLED", new Date("2026-01-01T00:00:00.000Z"));
  const results = await Promise.allSettled([
    change(fixture, "PAYROLL", "ENABLED", new Date("2026-08-10T00:00:00.000Z")),
    change(fixture, "HR", "DISABLED", new Date("2026-08-10T00:00:00.000Z")),
  ]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  const context = await loadBusinessModuleContext(fixture.businessId, { now: new Date("2026-08-10T00:01:00.000Z") });
  assert.equal(context.enabledModules.has("PAYROLL") && !context.enabledModules.has("HR"), false);
});

test("entitlement lookup is business-scoped and CORE is always available", async () => {
  assertLocalDatabase();
  const a = await createFixture();
  const b = await createFixture();
  await change(a, "POS", "ENABLED", new Date("2026-01-01T00:00:00.000Z"));
  await requireBusinessModule(a.businessId, "POS", { now: new Date("2026-08-10T00:00:00.000Z") });
  await assert.rejects(
    requireBusinessModule(b.businessId, "POS", { now: new Date("2026-08-10T00:00:00.000Z") }),
    ModuleNotEnabledError,
  );
  await requireBusinessModule(b.businessId, "CORE");
});

test("canonical product profiles resolve independently", async () => {
  assertLocalDatabase();
  const cases = [
    { name: "POS_ONLY", enabled: ["POS", "SALON"] },
    { name: "HR_ONLY", enabled: ["HR"] },
    { name: "POS_HR", enabled: ["POS", "HR"] },
    { name: "POS_HR_PAYROLL", enabled: ["POS", "HR", "PAYROLL"] },
    {
      name: "FULL_BUSINESS",
      enabled: ["POS", "SALON", "AUTO", "WHATSAPP", "HR", "PAYROLL", "STATUTORY"],
    },
  ] as const;

  for (const profile of cases) {
    const fixture = await createFixture();
    for (const moduleKey of profile.enabled) {
      await change(fixture, moduleKey, "ENABLED", new Date("2026-01-01T00:00:00.000Z"));
    }
    const context = await loadBusinessModuleContext(fixture.businessId, {
      now: new Date("2026-08-10T00:00:00.000Z"),
    });
    assert.equal(context.enabledModules.has("CORE"), true, profile.name);
    for (const moduleKey of profile.enabled) {
      assert.equal(context.enabledModules.has(moduleKey), true, `${profile.name}:${moduleKey}`);
    }
    if (profile.name === "POS_ONLY") assert.equal(context.enabledModules.has("HR"), false);
    if (profile.name === "HR_ONLY") assert.equal(context.enabledModules.has("POS"), false);
    if (profile.name === "POS_HR") assert.equal(context.enabledModules.has("PAYROLL"), false);
  }
});

async function createFixture() {
  const token = randomUUID().slice(0, 8);
  const business = await prisma.business.create({ data: { name: `Module ${token}`, slug: `module-${token}` } });
  const actor = await prisma.user.create({
    data: { name: `Platform ${token}`, email: `module-${token}@test.local`, role: "PLATFORM_ADMIN", status: "active" },
  });
  return {
    businessId: business.id,
    actor: {
      userId: actor.id,
      name: actor.name,
      email: actor.email,
      role: actor.role,
      status: actor.status,
    } as AppSession,
  };
}

function change(
  fixture: Awaited<ReturnType<typeof createFixture>>,
  moduleKey: string,
  status: "ENABLED" | "DISABLED",
  enabledFrom: Date,
) {
  return changeBusinessModuleEntitlement({
    actor: fixture.actor,
    rawInput: {
      businessId: fixture.businessId,
      moduleKey,
      status,
      enabledFrom,
      enabledUntil: "",
      source: "MANUAL",
      reason: `Testing ${moduleKey} ${status}.`,
    },
  });
}

function assertLocalDatabase() {
  assert.match(process.env.DATABASE_URL ?? "", /localhost|127\.0\.0\.1/i);
}
