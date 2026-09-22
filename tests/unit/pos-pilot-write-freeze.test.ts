import assert from "node:assert/strict";
import test from "node:test";
import * as pilotContract from "@/lib/release/pos-pilot-contract";

type WriteFreezeModule = typeof pilotContract & {
  POS_PILOT_WRITE_FROZEN: "POS_PILOT_WRITE_FROZEN";
  resolvePosPilotWriteFreezeMode: (
    env: Record<string, string | undefined>,
  ) => "full" | "operator-smoke" | "off";
  writeFrozenResponse: () => Response;
  evaluatePosPilotWriteRequest: (input: {
    method: string;
    pathname: string;
    mode: "full" | "operator-smoke" | "off";
    smokeCapabilityValid?: boolean;
  }) => "ALLOW" | "DENY" | "REQUIRE_SMOKE_CAPABILITY";
  maintenanceAuditEvent: (input: {
    event: "MODE_OBSERVED" | "SMOKE_ACCEPTED" | "SMOKE_DENIED";
    mode: "full" | "operator-smoke" | "off";
    actorId?: string;
    businessId?: string;
    branchId?: string;
    operation?: string;
    reason?: string;
    maintenanceToken?: string;
  }) => Record<string, unknown>;
  shouldSuppressPosPilotNotificationQueue: (
    env: Record<string, string | undefined>,
  ) => boolean;
};

const contract = pilotContract as WriteFreezeModule;

const production = {
  APP_ENVIRONMENT: "production",
  RAILWAY_ENVIRONMENT_NAME: "production",
  POS_PILOT_RELEASE_MODE: "core-pilot",
};

test("Production core-pilot accepts only the three exact write-freeze modes", () => {
  for (const mode of ["full", "operator-smoke", "off"] as const) {
    assert.equal(
      contract.resolvePosPilotWriteFreezeMode({
        ...production,
        POS_PILOT_WRITE_FREEZE_MODE: mode,
      }),
      mode,
    );
  }

  for (const value of [undefined, "", "FULL", "true", "disabled", " off "]) {
    assert.throws(
      () =>
        contract.resolvePosPilotWriteFreezeMode({
          ...production,
          POS_PILOT_WRITE_FREEZE_MODE: value,
        }),
      /POS_PILOT_WRITE_FREEZE_MODE/,
    );
  }
});

test("non-Production defaults to off but still rejects an explicit invalid mode", () => {
  assert.equal(contract.resolvePosPilotWriteFreezeMode({ NODE_ENV: "development" }), "off");
  assert.equal(
    contract.resolvePosPilotWriteFreezeMode({
      NODE_ENV: "test",
      POS_PILOT_WRITE_FREEZE_MODE: "full",
    }),
    "full",
  );
  assert.throws(
    () =>
      contract.resolvePosPilotWriteFreezeMode({
        NODE_ENV: "test",
        POS_PILOT_WRITE_FREEZE_MODE: "yes",
      }),
    /POS_PILOT_WRITE_FREEZE_MODE/,
  );
});

test("write-freeze denial has stable 503 semantics distinct from frozen domains", async () => {
  assert.equal(contract.POS_PILOT_WRITE_FROZEN, "POS_PILOT_WRITE_FROZEN");
  const response = contract.writeFrozenResponse();
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("retry-after"), "60");
  assert.equal(await response.text(), "POS_PILOT_WRITE_FROZEN");
  assert.notEqual(await new Response("FROZEN_DOMAIN_DENIED").text(), contract.POS_PILOT_WRITE_FROZEN);
});

test("full mode blocks mutations while preserving reads, health, static and auth/session paths", () => {
  const denied = [
    ["POST", "/cashier"],
    ["POST", "/pos/invoices/1"],
    ["PATCH", "/api/appointments/1"],
    ["DELETE", "/api/customers/1"],
    ["POST", "/api/whatsapp/send"],
  ] as const;
  for (const [method, pathname] of denied) {
    assert.equal(
      contract.evaluatePosPilotWriteRequest({ method, pathname, mode: "full" }),
      "DENY",
    );
  }

  const allowed = [
    ["GET", "/api/health"],
    ["GET", "/crm/customers"],
    ["HEAD", "/invoices/1"],
    ["GET", "/_next/static/chunk.js"],
    ["POST", "/login"],
    ["POST", "/logout"],
    ["POST", "/api/employee-auth/verify-otp"],
  ] as const;
  for (const [method, pathname] of allowed) {
    assert.equal(
      contract.evaluatePosPilotWriteRequest({ method, pathname, mode: "full" }),
      "ALLOW",
    );
  }
});

test("operator-smoke requires a capability and never opens non-allowlisted mutation paths", () => {
  assert.equal(
    contract.evaluatePosPilotWriteRequest({
      method: "POST",
      pathname: "/cashier",
      mode: "operator-smoke",
    }),
    "REQUIRE_SMOKE_CAPABILITY",
  );
  assert.equal(
    contract.evaluatePosPilotWriteRequest({
      method: "POST",
      pathname: "/cashier",
      mode: "operator-smoke",
      smokeCapabilityValid: true,
    }),
    "ALLOW",
  );
  for (const pathname of [
    "/crm/customers",
    "/business/settings",
    "/team/payroll",
    "/api/whatsapp/send",
  ]) {
    assert.equal(
      contract.evaluatePosPilotWriteRequest({
        method: "POST",
        pathname,
        mode: "operator-smoke",
        smokeCapabilityValid: true,
      }),
      "DENY",
    );
  }
});

test("maintenance audit events contain reconstructable scope but discard secrets and PII", () => {
  const event = contract.maintenanceAuditEvent({
    event: "SMOKE_DENIED",
    mode: "operator-smoke",
    actorId: "user-1",
    businessId: "business-1",
    branchId: "branch-1",
    operation: "POS_CHECKOUT",
    reason: "WRONG_SCOPE",
    maintenanceToken: "must-never-appear",
  });
  assert.deepEqual(event, {
    event: "POS_PILOT_WRITE_FREEZE_SMOKE_DENIED",
    mode: "operator-smoke",
    actorId: "user-1",
    businessId: "business-1",
    branchId: "branch-1",
    operation: "POS_CHECKOUT",
    reason: "WRONG_SCOPE",
  });
  assert.doesNotMatch(JSON.stringify(event), /must-never-appear|phone|email|database_url/i);
});

test("full and operator-smoke suppress new notification queues without changing off mode", () => {
  for (const mode of ["full", "operator-smoke"] as const) {
    assert.equal(
      contract.shouldSuppressPosPilotNotificationQueue({
        ...production,
        POS_PILOT_WRITE_FREEZE_MODE: mode,
      }),
      true,
    );
  }
  assert.equal(
    contract.shouldSuppressPosPilotNotificationQueue({
      ...production,
      POS_PILOT_WRITE_FREEZE_MODE: "off",
    }),
    false,
  );
  assert.equal(contract.shouldSuppressPosPilotNotificationQueue({ NODE_ENV: "test" }), false);
  assert.equal(
    contract.shouldSuppressPosPilotNotificationQueue({
      ...production,
      POS_PILOT_WRITE_FREEZE_MODE: "invalid",
    }),
    true,
  );
});
