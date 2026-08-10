import assert from "node:assert/strict";
import test from "node:test";
import type { BusinessModuleEntitlement } from "@prisma/client";
import { loadBusinessModuleContext } from "../../src/lib/modules/entitlements";
import {
  MODULE_REGISTRY,
  defaultModulesForNewBusiness,
  modulesForCapability,
} from "../../src/lib/modules/registry";

test("module registry keeps CORE system-required and dependencies declarative", () => {
  assert.equal(MODULE_REGISTRY.CORE.isCore, true);
  assert.deepEqual(MODULE_REGISTRY.PAYROLL.dependencies, ["HR"]);
  assert.deepEqual(MODULE_REGISTRY.STATUTORY.dependencies, ["PAYROLL"]);
  assert.equal(MODULE_REGISTRY.CLAIMS.operational, true);
  assert.deepEqual(MODULE_REGISTRY.CLAIMS.dependencies, ["HR"]);
});

test("industry is only a default profile helper, not entitlement source of truth", () => {
  assert.deepEqual(defaultModulesForNewBusiness("SALON_BEAUTY"), ["POS", "SALON"]);
  assert.deepEqual(defaultModulesForNewBusiness("AUTO_DETAILING"), ["POS", "AUTO"]);
  assert.deepEqual(modulesForCapability("VIEW_APPOINTMENTS", "SALON_BEAUTY"), ["SALON"]);
  assert.deepEqual(modulesForCapability("VIEW_APPOINTMENTS", "AUTO_DETAILING"), ["AUTO"]);
});

test("capability mapping preserves commercial entitlement and RBAC separation", () => {
  assert.deepEqual(modulesForCapability("VIEW_TEAM_DIRECTORY", "SALON_BEAUTY"), []);
  assert.deepEqual(modulesForCapability("VIEW_LEAVE", "SALON_BEAUTY"), ["HR"]);
  assert.deepEqual(modulesForCapability("VIEW_PAYROLL_RUN", "SALON_BEAUTY"), ["PAYROLL"]);
  assert.deepEqual(modulesForCapability("EXPORT_STATUTORY", "SALON_BEAUTY"), ["STATUTORY"]);
  assert.deepEqual(modulesForCapability("PROCESS_CASHIER_PAYMENT", "SALON_BEAUTY"), ["POS"]);
});

test("resolver evaluates effective windows and fails closed on missing dependencies", async () => {
  const now = new Date("2026-08-10T00:00:00.000Z");
  const rows = [
    row("POS", "ENABLED", "2026-01-01", null),
    row("HR", "ENABLED", "2026-08-11", null),
    row("PAYROLL", "ENABLED", "2026-01-01", null),
    row("WHATSAPP", "ENABLED", "2026-01-01", "2026-08-10"),
  ];
  const context = await loadBusinessModuleContext("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", {
    now,
    database: {
      businessModuleEntitlement: {
        findMany: async () => rows,
      },
    } as never,
  });
  assert.equal(context.enabledModules.has("CORE"), true);
  assert.equal(context.enabledModules.has("POS"), true);
  assert.equal(context.enabledModules.has("HR"), false);
  assert.equal(context.enabledModules.has("PAYROLL"), false);
  assert.equal(context.enabledModules.has("WHATSAPP"), false);
});

function row(
  moduleKey: BusinessModuleEntitlement["moduleKey"],
  status: BusinessModuleEntitlement["status"],
  enabledFrom: string,
  enabledUntil: string | null,
): BusinessModuleEntitlement {
  return {
    id: crypto.randomUUID(),
    businessId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    moduleKey,
    status,
    enabledFrom: new Date(`${enabledFrom}T00:00:00.000Z`),
    enabledUntil: enabledUntil ? new Date(`${enabledUntil}T00:00:00.000Z`) : null,
    source: "MANUAL",
    planCode: null,
    revision: 1,
    createdById: null,
    updatedById: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  };
}
