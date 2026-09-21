import assert from "node:assert/strict";
import test from "node:test";
import { assertStagingFixtureIdentity, assertStagingFixtureState } from "../../scripts/lib/rc-staging-fixture-contract";
import { assertHrPayrollUatFixtureEnvironment } from "../../scripts/uat-preview-database-guard";
import { assertEightRoleUatEnvironment } from "../../scripts/hr-payroll-eight-role-uat-contract";
import { assertPosCoreUatFixtureEnvironment } from "../../scripts/lib/pos-core-uat-contract";

function evidence() {
  return {
    appEnvironment: "production", nodeEnvironment: "production", profile: "rc-staging",
    projectId: "ec8b25a7-4fb9-4959-8353-b4af000f4e80",
    environmentId: "f7702966-0249-4df3-bca3-186e4b4af726", environmentName: "Production-RC-Staging-20260920",
    serviceId: "4dcd57a4-fc65-4cf8-97f7-39d1d89f6bb9",
    databaseServiceId: "a6b0c406-3410-46a5-b53d-08b4bf340be9",
    volumeId: "ff14274e-4404-4602-aef6-151e617f2dfb",
    region: "asia-southeast1-eqsg3a", volumeRegion: "asia-southeast1-eqsg3a",
    databaseFingerprint: "53db29e798907e78e1dadc78fa126070a29207359b2ce349eddb024bc4987b5b",
    inventoryDigest: "37bcd028088fa7c513b5cd827f11a885e5de340c5310755e441cd5eda88afad2",
    inventoryComplete: true, protectedCollision: false, metadataComplete: true,
  };
}

test("fixture identity allows only pinned authorized Staging with production security", () => {
  assert.doesNotThrow(() => assertStagingFixtureIdentity(evidence()));
});
for (const key of Object.keys(evidence())) {
  test(`fixture identity rejects changed and missing ${key} before connection`, () => {
    for (const value of [undefined, "", "unknown", false, true]) {
      if (value === evidence()[key as keyof ReturnType<typeof evidence>]) continue;
      assert.throws(() => assertStagingFixtureIdentity({ ...evidence(), [key]: value }), /RC_STAGING_FIXTURE_IDENTITY_REJECTED/);
    }
  });
}
for (const environmentId of ["ac9ef980-6805-4bf2-99f2-72dc7579d99d", "29581a37-4291-497a-91aa-25a9432b3227", "bef43b86-32dc-486e-a1ef-bb9f9699e4f5"]) {
  test(`protected environment is denied even with Staging display name: ${environmentId.slice(0, 8)}`, () => {
    assert.throws(() => assertStagingFixtureIdentity({ ...evidence(), environmentId }), /RC_STAGING_FIXTURE_IDENTITY_REJECTED/);
  });
}
test("US, legacy Singapore and inconsistent volume region are rejected", () => {
  for (const region of ["us-west2", "us-east4", "asia-southeast1", ""]) for (const key of ["region", "volumeRegion"]) {
    assert.throws(() => assertStagingFixtureIdentity({ ...evidence(), [key]: region }), /RC_STAGING_FIXTURE_IDENTITY_REJECTED/);
  }
});
test("empty all-application-table inventory permits first install only", () => {
  assert.equal(assertStagingFixtureState({ rows: 0, marker: null, expectedVersion: "v1", expectedDefinitionDigest: "a".repeat(64), currentDigest: "b".repeat(64) }), "INSTALL");
});
test("matching complete marker permits verify-only replay", () => {
  assert.equal(assertStagingFixtureState({ rows: 10, marker: { status: "COMPLETE", version: "v1", definitionDigest: "a".repeat(64), dataDigest: "b".repeat(64) }, expectedVersion: "v1", expectedDefinitionDigest: "a".repeat(64), currentDigest: "b".repeat(64) }), "VERIFY_ONLY");
});
test("nonempty unmarked, incomplete, stale-version and changed data all reject", () => {
  const base = { rows: 10, marker: { status: "COMPLETE", version: "v1", definitionDigest: "a".repeat(64), dataDigest: "b".repeat(64) }, expectedVersion: "v1", expectedDefinitionDigest: "a".repeat(64), currentDigest: "b".repeat(64) };
  for (const marker of [null, {}, { ...base.marker, status: "INSTALLING" }, { ...base.marker, version: "v2" }, { ...base.marker, definitionDigest: "c".repeat(64) }, { ...base.marker, dataDigest: "c".repeat(64) }]) {
    assert.throws(() => assertStagingFixtureState({ ...base, marker }), /RC_STAGING_FIXTURE_STATE_REJECTED/);
  }
});
test("original local and Preview entrypoints continue rejecting Staging", () => {
  const env = { NODE_ENV: "production" as const, APP_ENVIRONMENT: "production", APP_DEPLOYMENT_PROFILE: "rc-staging", DATABASE_URL: "postgresql://synthetic:synthetic@fixture.invalid/synthetic" };
  assert.throws(() => assertHrPayrollUatFixtureEnvironment(env), /LOCAL_DATABASE_REQUIRED/);
  assert.throws(() => assertEightRoleUatEnvironment(env), /FORBIDDEN_IN_PRODUCTION/);
  assert.throws(() => assertPosCoreUatFixtureEnvironment({ nodeEnv: env.NODE_ENV, appEnv: env.APP_ENVIRONMENT, databaseUrl: env.DATABASE_URL }), /refuse Production/);
});
