import assert from "node:assert/strict";
import test from "node:test";
import * as pilotContract from "@/lib/release/pos-pilot-contract";

type SmokeScope = {
  actorId: string;
  businessId: string;
  branchId: string;
};

type SmokeModule = typeof pilotContract & {
  POS_PILOT_SMOKE_COOKIE: string;
  resolvePosPilotSmokeConfig: (
    env: Record<string, string | undefined>,
  ) => SmokeScope & { secret: string; ttlSeconds: number };
  maintenanceSecretMatches: (provided: string, expected: string) => Promise<boolean>;
  issuePosPilotSmokeCapability: (
    scope: SmokeScope & { secret: string; nowSeconds: number },
  ) => Promise<string>;
  verifyPosPilotSmokeCapability: (input: {
    token: string;
    secret: string;
    nowSeconds: number;
  }) => Promise<SmokeScope | null>;
  posPilotSmokeScopeMatches: (
    capability: SmokeScope,
    actual: SmokeScope,
  ) => boolean;
  authorizePosPilotSmoke: (input: {
    providedSecret: string;
    session: {
      userId: string;
      role: string;
      activeBusinessId: string | null;
      branchId: string | null;
    } | null;
    env: Record<string, string | undefined>;
    nowSeconds: number;
  }) => Promise<{ token: string; maxAge: number; scope: SmokeScope }>;
  buildPosPilotSmokeAuthorizationResult: (input: {
    providedSecret: string;
    session: {
      userId: string;
      role: string;
      activeBusinessId: string | null;
      branchId: string | null;
    } | null;
    env: Record<string, string | undefined>;
    nowSeconds: number;
  }) => Promise<
    | { status: 503; body: { code: "POS_PILOT_WRITE_FROZEN" } }
    | {
        status: 200;
        body: { authorized: true; expiresInSeconds: 600 };
        cookie: {
          name: string;
          value: string;
          httpOnly: true;
          secure: true;
          sameSite: "strict";
          path: "/";
          maxAge: 600;
        };
      }
  >;
  authorizePosPilotSmokeOperation: (input: {
    operation: string;
    capabilityToken?: string;
    env: Record<string, string | undefined>;
    nowSeconds: number;
  }) => Promise<SmokeScope | null>;
  assertPosPilotSmokeOperationScope: (
    capability: SmokeScope | null,
    actual: SmokeScope,
  ) => void;
};

const smoke = pilotContract as SmokeModule;
const secret = "s".repeat(64);
const scope = {
  actorId: "11111111-1111-4111-8111-111111111111",
  businessId: "22222222-2222-4222-8222-222222222222",
  branchId: "33333333-3333-4333-8333-333333333333",
};

test("operator-smoke configuration requires exact Production core-pilot scope and a high-entropy secret", () => {
  const config = smoke.resolvePosPilotSmokeConfig({
    APP_ENVIRONMENT: "production",
    POS_PILOT_RELEASE_MODE: "core-pilot",
    POS_PILOT_WRITE_FREEZE_MODE: "operator-smoke",
    POS_PILOT_SMOKE_SECRET: secret,
    POS_PILOT_SMOKE_OPERATOR_USER_ID: scope.actorId,
    POS_PILOT_SMOKE_BUSINESS_ID: scope.businessId,
    POS_PILOT_SMOKE_BRANCH_ID: scope.branchId,
  });
  assert.deepEqual(config, { ...scope, secret, ttlSeconds: 600 });

  const base = {
    APP_ENVIRONMENT: "production",
    POS_PILOT_RELEASE_MODE: "core-pilot",
    POS_PILOT_WRITE_FREEZE_MODE: "operator-smoke",
    POS_PILOT_SMOKE_SECRET: secret,
    POS_PILOT_SMOKE_OPERATOR_USER_ID: scope.actorId,
    POS_PILOT_SMOKE_BUSINESS_ID: scope.businessId,
    POS_PILOT_SMOKE_BRANCH_ID: scope.branchId,
  };
  for (const [key, value] of [
    ["APP_ENVIRONMENT", "testing"],
    ["POS_PILOT_RELEASE_MODE", "other"],
    ["POS_PILOT_WRITE_FREEZE_MODE", "full"],
    ["POS_PILOT_SMOKE_SECRET", "too-short"],
    ["POS_PILOT_SMOKE_OPERATOR_USER_ID", ""],
    ["POS_PILOT_SMOKE_BUSINESS_ID", ""],
    ["POS_PILOT_SMOKE_BRANCH_ID", ""],
  ] as const) {
    assert.throws(
      () => smoke.resolvePosPilotSmokeConfig({ ...base, [key]: value }),
      /operator-smoke|POS_PILOT_SMOKE/i,
      key,
    );
  }
});

test("maintenance secret comparison accepts only exact bytes", async () => {
  assert.equal(await smoke.maintenanceSecretMatches(secret, secret), true);
  assert.equal(await smoke.maintenanceSecretMatches(`${secret}x`, secret), false);
  assert.equal(await smoke.maintenanceSecretMatches("", secret), false);
});

test("signed capability is short-lived, tamper evident and contains scope but not the maintenance secret", async () => {
  const token = await smoke.issuePosPilotSmokeCapability({
    ...scope,
    secret,
    nowSeconds: 1_800_000_000,
  });
  assert.doesNotMatch(token, new RegExp(secret));
  assert.deepEqual(
    await smoke.verifyPosPilotSmokeCapability({
      token,
      secret,
      nowSeconds: 1_800_000_599,
    }),
    scope,
  );
  assert.equal(
    await smoke.verifyPosPilotSmokeCapability({
      token,
      secret,
      nowSeconds: 1_800_000_601,
    }),
    null,
  );
  assert.equal(
    await smoke.verifyPosPilotSmokeCapability({
      token: `${token.slice(0, -1)}${token.endsWith("a") ? "b" : "a"}`,
      secret,
      nowSeconds: 1_800_000_001,
    }),
    null,
  );
});

test("scope comparison rejects wrong user, business, branch and cross-tenant reuse", () => {
  assert.equal(smoke.posPilotSmokeScopeMatches(scope, scope), true);
  for (const mismatch of [
    { ...scope, actorId: "other-user" },
    { ...scope, businessId: "other-business" },
    { ...scope, branchId: "other-branch" },
  ]) {
    assert.equal(smoke.posPilotSmokeScopeMatches(scope, mismatch), false);
  }
});

test("maintenance capability cookie name is dedicated and cannot collide with user sessions", () => {
  assert.equal(smoke.POS_PILOT_SMOKE_COOKIE, "tetamu_pos_pilot_smoke");
  assert.notEqual(smoke.POS_PILOT_SMOKE_COOKIE, "car_wash_session");
});

test("authorization requires independent secret, exact operator identity, owner role and exact tenant scope", async () => {
  const env = {
    APP_ENVIRONMENT: "production",
    POS_PILOT_RELEASE_MODE: "core-pilot",
    POS_PILOT_WRITE_FREEZE_MODE: "operator-smoke",
    POS_PILOT_SMOKE_SECRET: secret,
    POS_PILOT_SMOKE_OPERATOR_USER_ID: scope.actorId,
    POS_PILOT_SMOKE_BUSINESS_ID: scope.businessId,
    POS_PILOT_SMOKE_BRANCH_ID: scope.branchId,
  };
  const session = {
    userId: scope.actorId,
    role: "BUSINESS_OWNER",
    activeBusinessId: scope.businessId,
    branchId: scope.branchId,
  };

  for (const attempt of [
    { providedSecret: "", session },
    { providedSecret: `${secret}x`, session },
    { providedSecret: secret, session: null },
    { providedSecret: secret, session: { ...session, role: "STAFF" } },
    { providedSecret: secret, session: { ...session, userId: "other-user" } },
    { providedSecret: secret, session: { ...session, activeBusinessId: "other-business" } },
    { providedSecret: secret, session: { ...session, branchId: "other-branch" } },
  ]) {
    await assert.rejects(
      () => smoke.authorizePosPilotSmoke({ ...attempt, env, nowSeconds: 1_800_000_000 }),
      (error: unknown) =>
        error instanceof Error &&
        error.message === "POS_PILOT_WRITE_FROZEN" &&
        !error.message.includes(secret),
    );
  }

  const authorized = await smoke.authorizePosPilotSmoke({
    providedSecret: secret,
    session,
    env,
    nowSeconds: 1_800_000_000,
  });
  assert.equal(authorized.maxAge, 600);
  assert.deepEqual(authorized.scope, scope);
  assert.deepEqual(
    await smoke.verifyPosPilotSmokeCapability({
      token: authorized.token,
      secret,
      nowSeconds: 1_800_000_001,
    }),
    scope,
  );
});

test("authorization response never exposes the maintenance secret and issues only a short-lived HttpOnly cookie", async () => {
  const env = {
    APP_ENVIRONMENT: "production",
    POS_PILOT_RELEASE_MODE: "core-pilot",
    POS_PILOT_WRITE_FREEZE_MODE: "operator-smoke",
    POS_PILOT_SMOKE_SECRET: secret,
    POS_PILOT_SMOKE_OPERATOR_USER_ID: scope.actorId,
    POS_PILOT_SMOKE_BUSINESS_ID: scope.businessId,
    POS_PILOT_SMOKE_BRANCH_ID: scope.branchId,
  };
  const session = {
    userId: scope.actorId,
    role: "BUSINESS_OWNER",
    activeBusinessId: scope.businessId,
    branchId: scope.branchId,
  };
  const denied = await smoke.buildPosPilotSmokeAuthorizationResult({
    providedSecret: "wrong",
    session,
    env,
    nowSeconds: 1_800_000_000,
  });
  assert.deepEqual(denied, {
    status: 503,
    body: { code: "POS_PILOT_WRITE_FROZEN" },
  });

  const allowed = await smoke.buildPosPilotSmokeAuthorizationResult({
    providedSecret: secret,
    session,
    env,
    nowSeconds: 1_800_000_000,
  });
  assert.equal(allowed.status, 200);
  if (allowed.status !== 200) assert.fail("expected authorization");
  assert.deepEqual(allowed.body, { authorized: true, expiresInSeconds: 600 });
  assert.deepEqual(
    { ...allowed.cookie, value: "<redacted>" },
    {
      name: "tetamu_pos_pilot_smoke",
      value: "<redacted>",
      httpOnly: true,
      secure: true,
      sameSite: "strict",
      path: "/",
      maxAge: 600,
    },
  );
  assert.doesNotMatch(JSON.stringify(allowed.body), new RegExp(secret));
  assert.doesNotMatch(allowed.cookie.value, new RegExp(secret));
});

test("operation preflight blocks full mode before capability work and permits off mode unchanged", async () => {
  await assert.rejects(
    () => smoke.authorizePosPilotSmokeOperation({
      operation: "POS_CHECKOUT",
      env: {
        APP_ENVIRONMENT: "production",
        POS_PILOT_RELEASE_MODE: "core-pilot",
        POS_PILOT_WRITE_FREEZE_MODE: "full",
      },
      nowSeconds: 1_800_000_000,
    }),
    /POS_PILOT_WRITE_FROZEN/,
  );
  assert.equal(
    await smoke.authorizePosPilotSmokeOperation({
      operation: "POS_CHECKOUT",
      env: {
        APP_ENVIRONMENT: "production",
        POS_PILOT_RELEASE_MODE: "core-pilot",
        POS_PILOT_WRITE_FREEZE_MODE: "off",
      },
      nowSeconds: 1_800_000_000,
    }),
    null,
  );
});

test("operator-smoke permits only the exact operation allowlist with a valid capability", async () => {
  const env = {
    APP_ENVIRONMENT: "production",
    POS_PILOT_RELEASE_MODE: "core-pilot",
    POS_PILOT_WRITE_FREEZE_MODE: "operator-smoke",
    POS_PILOT_SMOKE_SECRET: secret,
    POS_PILOT_SMOKE_OPERATOR_USER_ID: scope.actorId,
    POS_PILOT_SMOKE_BUSINESS_ID: scope.businessId,
    POS_PILOT_SMOKE_BRANCH_ID: scope.branchId,
  };
  const capabilityToken = await smoke.issuePosPilotSmokeCapability({
    ...scope,
    secret,
    nowSeconds: 1_800_000_000,
  });
  for (const operation of [
    "APPOINTMENT_CREATE",
    "APPOINTMENT_UPDATE",
    "APPOINTMENT_CANCEL",
    "WORK_ORDER_CREATE",
    "WORK_ORDER_UPDATE",
    "POS_CHECKOUT",
    "POS_PAYMENT",
    "POS_REFUND",
    "POS_PACKAGE_REDEMPTION",
    "POS_DAILY_CLOSING_START",
    "POS_DAILY_CLOSING_END",
    "POS_DAILY_CLOSING_FINALIZE",
  ]) {
    assert.deepEqual(
      await smoke.authorizePosPilotSmokeOperation({
        operation,
        capabilityToken,
        env,
        nowSeconds: 1_800_000_001,
      }),
      scope,
      operation,
    );
  }
  for (const operation of [
    "CRM_MUTATION",
    "BUSINESS_SETTINGS",
    "WHATSAPP_SEND",
    "PAYROLL_MUTATION",
    "PCB_CALCULATION",
    "GOVERNMENT_SUBMISSION",
  ]) {
    await assert.rejects(
      () => smoke.authorizePosPilotSmokeOperation({
        operation,
        capabilityToken,
        env,
        nowSeconds: 1_800_000_001,
      }),
      /POS_PILOT_WRITE_FROZEN/,
      operation,
    );
  }
});

test("operation scope assertion rejects every cross-user, cross-business and cross-branch attempt", () => {
  assert.doesNotThrow(() => smoke.assertPosPilotSmokeOperationScope(scope, scope));
  assert.doesNotThrow(() => smoke.assertPosPilotSmokeOperationScope(null, scope));
  for (const actual of [
    { ...scope, actorId: "other-user" },
    { ...scope, businessId: "other-business" },
    { ...scope, branchId: "other-branch" },
  ]) {
    assert.throws(
      () => smoke.assertPosPilotSmokeOperationScope(scope, actual),
      /POS_PILOT_WRITE_FROZEN/,
    );
  }
});
