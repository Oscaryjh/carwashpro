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
  DEFAULT_MANUAL_ENTITLEMENT_REASON,
  DEPENDENT_MODULE_ENABLED,
  MODULE_DEPENDENCY_REQUIRED,
  changeBusinessModuleEntitlement,
  changeBusinessModuleEntitlements,
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
  assert.ok(hr.entitlement);
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

test("manual entitlement changes use a standard audit reason when the optional note is blank", async () => {
  assertLocalDatabase();
  const fixture = await createFixture();
  const changed = await changeBusinessModuleEntitlement({
    actor: fixture.actor,
    rawInput: {
      businessId: fixture.businessId,
      moduleKey: "HR",
      status: "ENABLED",
      enabledFrom: "2026-08-01T00:00:00.000Z",
      enabledUntil: "",
      source: "MANUAL",
      reason: "   ",
    },
  });
  assert.ok(changed.entitlement);

  const [event, audit] = await Promise.all([
    prisma.businessModuleEntitlementEvent.findFirstOrThrow({
      where: { entitlementId: changed.entitlement.id },
      orderBy: { createdAt: "desc" },
    }),
    prisma.auditLog.findFirstOrThrow({
      where: {
        businessId: fixture.businessId,
        action: "BUSINESS_MODULE_ENTITLEMENT_CHANGED",
      },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  assert.equal(event.reason, DEFAULT_MANUAL_ENTITLEMENT_REASON);
  assert.equal(
    (audit.metadata as { reason?: string } | null)?.reason,
    DEFAULT_MANUAL_ENTITLEMENT_REASON,
  );
});

test("one batch atomically enables dependent modules and skips untouched disabled modules", async () => {
  assertLocalDatabase();
  const fixture = await createFixture();
  const enabledFrom = "2026-08-01T00:00:00.000Z";
  const batch = await changeBusinessModuleEntitlements({
    actor: fixture.actor,
    rawInputs: [
      {
        businessId: fixture.businessId,
        moduleKey: "HR",
        status: "ENABLED",
        enabledFrom,
        source: "MANUAL",
        reason: "Batch HR setup.",
      },
      {
        businessId: fixture.businessId,
        moduleKey: "PAYROLL",
        status: "ENABLED",
        enabledFrom,
        source: "MANUAL",
        reason: "Batch HR setup.",
      },
      {
        businessId: fixture.businessId,
        moduleKey: "INVENTORY",
        status: "DISABLED",
        enabledFrom,
        source: "MANUAL",
        reason: "Batch HR setup.",
      },
    ],
  });

  assert.equal(batch.changedCount, 2);
  const context = await loadBusinessModuleContext(fixture.businessId, {
    now: new Date("2026-08-02T00:00:00.000Z"),
  });
  assert.equal(context.enabledModules.has("HR"), true);
  assert.equal(context.enabledModules.has("PAYROLL"), true);
  assert.equal(
    await prisma.businessModuleEntitlement.count({
      where: { businessId: fixture.businessId, moduleKey: "INVENTORY" },
    }),
    0,
  );
});

test("an invalid dependency rolls back every change in the entitlement batch", async () => {
  assertLocalDatabase();
  const fixture = await createFixture();
  const enabledFrom = "2026-08-01T00:00:00.000Z";

  await assert.rejects(
    changeBusinessModuleEntitlements({
      actor: fixture.actor,
      rawInputs: [
        {
          businessId: fixture.businessId,
          moduleKey: "HR",
          status: "ENABLED",
          enabledFrom,
          source: "MANUAL",
          reason: "Atomic batch test.",
        },
        {
          businessId: fixture.businessId,
          moduleKey: "STATUTORY",
          status: "ENABLED",
          enabledFrom,
          source: "MANUAL",
          reason: "Atomic batch test.",
        },
      ],
    }),
    new RegExp(MODULE_DEPENDENCY_REQUIRED),
  );

  assert.equal(
    await prisma.businessModuleEntitlement.count({
      where: { businessId: fixture.businessId },
    }),
    0,
  );
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
