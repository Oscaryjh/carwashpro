import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import type { PrismaClient } from "@prisma/client";

import {
  assertAllowedMutation,
  assertCanonicalTestingContext,
  assertCanonicalTestingDatabase,
  assertNoExternalSideEffect,
  buildCanonicalFixturePlan,
  CanonicalTestingGuardError,
  executeCanonicalFixturePlan,
  fixtureMarker,
  parseCanonicalPrepareMode,
  redactSecrets,
  stableFixtureId,
} from "../../scripts/lib/canonical-testing-guard";

function testingEnv(): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "test",
    RAILWAY_ENVIRONMENT_NAME: "testing",
    APP_ENVIRONMENT: "testing",
    RAILWAY_PROJECT_ID: "ec8b25a7-4fb9-4959-8353-b4af000f4e80",
    RAILWAY_ENVIRONMENT_ID: "ac9ef980-6805-4bf2-99f2-72dc7579d99d",
    RAILWAY_SERVICE_ID: "e967b54d-dd06-4741-be99-e6e55e70af0e",
    RAILWAY_SERVICE_NAME: "tetamu-pos-web",
    DATABASE_URL: "postgresql://fixture:fixture@postgres-random.railway.internal:5432/railway",
  };
}

test("canonical Testing guard rejects Production", () => {
  assert.throws(
    () =>
      assertCanonicalTestingContext({
        ...testingEnv(),
        RAILWAY_ENVIRONMENT_NAME: "production",
        APP_ENVIRONMENT: "production",
      }),
    CanonicalTestingGuardError,
  );
});

test("canonical Testing guard rejects a missing environment", () => {
  const env = testingEnv();
  delete env.RAILWAY_ENVIRONMENT_NAME;
  assert.throws(() => assertCanonicalTestingContext(env), /Missing required Testing evidence/);
});

test("canonical Testing guard accepts the exact Testing context with a rotating host", () => {
  const evidence = assertCanonicalTestingContext(testingEnv());
  assert.equal(evidence.environmentName, "testing");
  assert.equal(evidence.databaseHostClass, "railway-internal");

  const proxyEvidence = assertCanonicalTestingContext({
    ...testingEnv(),
    DATABASE_URL: "postgresql://fixture:fixture@switchyard.proxy.rlwy.net:12345/railway",
  });
  assert.equal(proxyEvidence.databaseHostClass, "railway-proxy");
});

test("canonical Testing guard accepts only the exact Testing Railway SSH tunnel identity", () => {
  const tunnelEnv = {
    ...testingEnv(),
    DATABASE_URL: "postgresql://fixture:fixture@127.0.0.1:55432/railway",
    CANONICAL_UAT_TUNNEL_MODE: "railway-ssh",
    CANONICAL_UAT_DATABASE_SERVICE_ID: "49c45405-1634-4292-9df3-bc27fe9a62a1",
    CANONICAL_UAT_DATABASE_SERVICE_NAME: "Postgres-Canonical-Testing-SG",
  };
  assert.equal(
    assertCanonicalTestingContext(tunnelEnv).databaseHostClass,
    "railway-ssh-tunnel",
  );
  assert.throws(
    () =>
      assertCanonicalTestingContext({
        ...tunnelEnv,
        CANONICAL_UAT_DATABASE_SERVICE_ID: "wrong-database-service",
      }),
    /exact canonical Testing Railway SSH tunnel identity/,
  );
});

test("canonical Testing guard rejects incorrect project, service and non-Railway DB context", () => {
  assert.throws(
    () => assertCanonicalTestingContext({ ...testingEnv(), RAILWAY_PROJECT_ID: "wrong" }),
    /project identity/,
  );
  assert.throws(
    () => assertCanonicalTestingContext({ ...testingEnv(), RAILWAY_SERVICE_ID: "wrong" }),
    /service identity/,
  );
  assert.throws(
    () =>
      assertCanonicalTestingContext({
        ...testingEnv(),
        DATABASE_URL: "postgresql://fixture:fixture@example.com:5432/railway",
      }),
    /Railway internal or Railway TCP proxy/,
  );
});

test("database identity guard requires schema and completed migration marker", async () => {
  let call = 0;
  const good = {
    $queryRaw: async () => {
      call += 1;
      return call === 1
        ? [{ database_name: "railway", schema_name: "public" }]
        : [
            {
              migration_name: "20260902120000_staff_otp_forward_hardening",
              finished_at: new Date(),
              rolled_back_at: null,
              logs: null,
            },
          ];
    },
  } as unknown as Pick<PrismaClient, "$queryRaw">;
  const evidence = await assertCanonicalTestingDatabase(good);
  assert.equal(evidence.requiredMigrationPresent, true);

  call = 0;
  const wrong = {
    $queryRaw: async () => {
      call += 1;
      return call === 1
        ? [{ database_name: "production", schema_name: "public" }]
        : [];
    },
  } as unknown as Pick<PrismaClient, "$queryRaw">;
  await assert.rejects(() => assertCanonicalTestingDatabase(wrong), /name\/schema/);
});

test("prepare defaults to dry-run and --apply is the only write opt-in", () => {
  assert.equal(parseCanonicalPrepareMode([]), "DRY_RUN");
  assert.equal(parseCanonicalPrepareMode(["--apply"]), "APPLY");
  assert.throws(() => parseCanonicalPrepareMode(["--unsafe"]), /Forbidden argument/);
  assert.throws(() => parseCanonicalPrepareMode(["--force-production"]), /Forbidden argument/);
  assert.throws(() => parseCanonicalPrepareMode(["--unknown"]), /Unknown argument/);
});

test("dry-run plan performs no writes", async () => {
  let writes = 0;
  const plan = buildCanonicalFixturePlan(["business.primary"], new Set());
  const result = await executeCanonicalFixturePlan("DRY_RUN", plan, async () => {
    writes += 1;
  });
  assert.equal(result.applied, 0);
  assert.equal(writes, 0);
});

test("second apply is idempotent", async () => {
  const existing = new Set<string>();
  const keys = ["business.primary", "branch.main"];
  const first = buildCanonicalFixturePlan(keys, existing);
  await executeCanonicalFixturePlan("APPLY", first, async ({ id }) => {
    existing.add(id);
  });
  const second = buildCanonicalFixturePlan(keys, existing);
  let secondWrites = 0;
  await executeCanonicalFixturePlan("APPLY", second, async () => {
    secondWrites += 1;
  });
  assert.equal(secondWrites, 0);
  assert.deepEqual(
    second.map((item) => item.status),
    ["ALREADY EXISTS", "ALREADY EXISTS"],
  );
});

test("stable fixture IDs and markers are deterministic and distinct", () => {
  assert.equal(stableFixtureId("business.primary"), stableFixtureId("business.primary"));
  assert.notEqual(stableFixtureId("business.primary"), stableFixtureId("branch.main"));
  assert.match(stableFixtureId("business.primary"), /^[0-9a-f-]{36}$/);
  assert.equal(
    fixtureMarker("business.primary"),
    "[TETAMU_CANONICAL_UAT_V1:business.primary]",
  );
});

test("external provider side effects cannot be approved by fixture tooling", () => {
  for (const operation of [
    "send SMS123 OTP",
    "Twilio send",
    "WhatsApp send",
    "email send",
    "charge payment provider",
    "Production webhook",
  ]) {
    assert.throws(() => assertNoExternalSideEffect(operation), /External side effect/);
  }
  assert.doesNotThrow(() => assertNoExternalSideEffect("database fixture upsert"));
});

test("arbitrary delete and destructive SQL are prohibited", () => {
  for (const operation of [
    "deleteMany customers",
    "TRUNCATE businesses",
    "DROP SCHEMA public",
    "prisma migrate reset",
    "executeRaw",
    "queryRawUnsafe",
  ]) {
    assert.throws(() => assertAllowedMutation(operation), /prohibited/);
  }
  assert.doesNotThrow(() => assertAllowedMutation("fixture-owned upsert"));
});

test("secrets are recursively redacted", () => {
  const redacted = redactSecrets({
    DATABASE_URL: "postgresql://user:password@host/database",
    nested: { otp: "123456", cookie: "session=abc", safe: "testing" },
    header: "Bearer secret-token",
  });
  assert.deepEqual(redacted, {
    DATABASE_URL: "[REDACTED]",
    nested: { otp: "[REDACTED]", cookie: "[REDACTED]", safe: "testing" },
    header: "[REDACTED]",
  });
});

test("audit and verify source are read-only", () => {
  for (const path of [
    "scripts/audit-testing-canonical-uat.ts",
    "scripts/verify-testing-canonical-uat.ts",
  ]) {
    const source = readFileSync(path, "utf8");
    assert.doesNotMatch(
      source,
      /prisma\.\w+\.(?:create|update|upsert|delete|deleteMany|createMany|updateMany)\s*\(/,
    );
    assert.doesNotMatch(source, /\$(?:executeRaw|executeRawUnsafe|queryRawUnsafe)/);
  }
});

test("prepare source has no destructive DB API or external provider dependency", () => {
  const source = readFileSync("scripts/prepare-testing-canonical-uat.ts", "utf8");
  assert.doesNotMatch(source, /\.(?:delete|deleteMany)\s*\(/);
  assert.doesNotMatch(source, /\$(?:executeRaw|executeRawUnsafe|queryRawUnsafe)/);
  assert.doesNotMatch(source, /from\s+["'][^"']*(?:sms123|twilio|whatsapp|email|webhook)[^"']*["']/i);
  assert.doesNotMatch(source, /fetch\s*\(/);
});

test("Phase 2 repair is guarded, transaction-wrapped and free of destructive or external operations", () => {
  const source = readFileSync("scripts/repair-testing-canonical-uat-phase2.ts", "utf8");
  assert.match(source, /assertCanonicalTestingContext\(process\.env\)/);
  assert.match(source, /assertCanonicalTestingDatabase\(prisma\)/);
  assert.match(source, /prisma\.\$transaction\(/);
  assert.match(source, /mode === "DRY_RUN"/);
  assert.doesNotMatch(source, /\.(?:delete|deleteMany)\s*\(/);
  assert.doesNotMatch(source, /\$(?:executeRawUnsafe|queryRawUnsafe)/);
  assert.match(source, /SELECT set_config\('tetamu\.payroll_reopen'/);
  assert.doesNotMatch(source, /from\s+["'][^"']*(?:sms123|twilio|whatsapp|email|webhook)[^"']*["']/i);
  assert.doesNotMatch(source, /fetch\s*\(/);
});

test("canonical fixture creates enabled stable Attendance settings for both UAT branches", () => {
  const source = readFileSync("scripts/prepare-testing-canonical-uat.ts", "utf8");
  const repair = readFileSync("scripts/repair-testing-canonical-uat-phase2.ts", "utf8");
  for (const key of ["attendance-setting.main", "attendance-setting.second"]) {
    assert.match(source, new RegExp(`stableFixtureId\\(\"${key}\\"\\)`));
    assert.match(repair, new RegExp(`stableFixtureId\\(\"${key}\\"\\)`));
  }
  assert.match(source, /requireGeofence:\s*false/);
  assert.match(source, /timezone:\s*"Asia\/Singapore"/);
  assert.match(source, /isEnabled:\s*true/);
});

test("canonical payroll fixture uses an exclusive period end and Phase 2 preserves the immutable payslip", () => {
  const source = readFileSync("scripts/prepare-testing-canonical-uat.ts", "utf8");
  const repair = readFileSync("scripts/repair-testing-canonical-uat-phase2.ts", "utf8");
  assert.match(
    source,
    /periodEnd = new Date\(Date\.UTC\(new Date\(\)\.getUTCFullYear\(\), new Date\(\)\.getUTCMonth\(\), 1\)\)/,
  );
  assert.match(repair, /data:\s*\{ periodEnd: period\.end \}/);
  assert.match(repair, /SELECT set_config\('tetamu\.payroll_reopen'/);
  assert.match(repair, /status:\s*"DRAFT"/);
  assert.match(repair, /status:\s*"FINALIZED"/);
  assert.doesNotMatch(repair, /payrollPayslipPublication\.update/);
  assert.match(repair, /id:\s*\{ not: PAYROLL_RUN_ID \}/);
});

test("Phase 2 preserves shared phone accounts and records the intentional Owner People contract", () => {
  const source = readFileSync("scripts/repair-testing-canonical-uat-phase2.ts", "utf8");
  assert.match(source, /phone account is shared and must not be renamed/);
  assert.match(source, /EXPECTED PRODUCT CONTRACT/);
  assert.match(source, /owner\.employeeBusinessMembershipId === null/);
  assert.doesNotMatch(source, /employeeAccount\.(?:update|upsert)\s*\(/);
});

test("canonical audit and verify enforce Phase 2 fixture invariants", () => {
  const audit = readFileSync("scripts/audit-testing-canonical-uat.ts", "utf8");
  const verify = readFileSync("scripts/verify-testing-canonical-uat.ts", "utf8");
  assert.match(audit, /attendance-setting:UAT MAIN BRANCH/);
  assert.match(audit, /attendance-setting:UAT SECOND BRANCH/);
  assert.match(audit, /payroll:exclusive-period-boundary/);
  assert.match(verify, /mainBranchAttendanceConfiguration/);
  assert.match(verify, /secondBranchAttendanceConfiguration/);
  assert.match(verify, /payrollExclusivePeriodBoundary/);
  assert.match(verify, /ownerPeopleContract/);
});

test("canonical UAT branches use the bounded Kuala Lumpur state code", () => {
  const source = readFileSync("scripts/prepare-testing-canonical-uat.ts", "utf8");
  assert.match(source, /stateCode:\s*"KUL"/);
  assert.doesNotMatch(source, /stateCode:\s*"W\.P\. KUALA LUMPUR"/);
});

test("canonical UAT treats CORE as implicit rather than an entitlement row", () => {
  const prepareSource = readFileSync("scripts/prepare-testing-canonical-uat.ts", "utf8");
  const auditSource = readFileSync("scripts/audit-testing-canonical-uat.ts", "utf8");
  assert.doesNotMatch(prepareSource, /moduleKey:\s*"CORE"/);
  assert.match(auditSource, /"CORE" as const/);
});

test("canonical UAT memberships persist both phone fields in E.164 form", () => {
  const source = readFileSync("scripts/prepare-testing-canonical-uat.ts", "utf8");
  const membershipSource = source.slice(source.indexOf("employeeBusinessMembership.upsert"));
  assert.match(membershipSource, /phoneNumber:\s*MANAGER_PHONE/);
  assert.match(membershipSource, /phoneNumber:\s*STAFF_PHONE/);
  assert.doesNotMatch(
    membershipSource,
    /phoneNumber:\s*"0(?:128793848|1112212259)"/,
  );
});

test("geofence-disabled fixture punches satisfy the canonical inside-status constraint", () => {
  const source = readFileSync("scripts/prepare-testing-canonical-uat.ts", "utf8");
  const disabledPunches = source.matchAll(
    /insideGeofence:\s*(true|false),\s*\n\s*geofenceStatus:\s*"GEOFENCE_DISABLED"/g,
  );
  const statuses = [...disabledPunches].map((match) => match[1]);
  assert.deepEqual(statuses, ["false", "false", "false"]);
});

test("basic salary fixture line references the payroll entry compensation version", () => {
  const source = readFileSync("scripts/prepare-testing-canonical-uat.ts", "utf8");
  assert.match(source, /const compensationVersionId = stableFixtureId\("compensation-version\.staff"\)/);
  assert.match(source, /compensationVersionId,\s*\n\s*compensationEffectiveFromMonthSnapshot:/);
  assert.match(
    source,
    /sourceType:\s*"BASIC_SALARY",\s*\n\s*sourceVersionId:\s*compensationVersionId/,
  );
  assert.match(source, /lineKey:\s*"SYSTEM:BASIC_SALARY"/);
  assert.doesNotMatch(
    source,
    /lineKey:\s*fixtureMarker\("payroll-component\.staff\.basic"\)/,
  );
});
