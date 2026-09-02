import assert from "node:assert/strict";
import test from "node:test";
import {
  POS_CORE_FRESH_RUN_BRANCH_NAME,
  POS_CORE_UAT_FIXTURE_CONFIRMATION,
  assertPosCoreFreshRunSafe,
  assertPosCoreUatFixtureEnvironment,
  requireUatFixturePassword,
} from "../../scripts/lib/pos-core-uat-contract";

test("POS Core fresh run uses one stable isolated branch context", () => {
  assert.equal(POS_CORE_FRESH_RUN_BRANCH_NAME, "Final UAT Branch");
  assert.doesNotThrow(() =>
    assertPosCoreFreshRunSafe({
      cashierOpenShiftCount: 0,
      dailyClosingCount: 0,
      targetBranchOpenShiftCount: 0,
    }),
  );
});

test("POS Core fresh run refuses closed dates and OPEN shifts", () => {
  assert.throws(
    () => assertPosCoreFreshRunSafe({ cashierOpenShiftCount: 0, dailyClosingCount: 1, targetBranchOpenShiftCount: 0 }),
    /already closed/,
  );
  assert.throws(
    () => assertPosCoreFreshRunSafe({ cashierOpenShiftCount: 1, dailyClosingCount: 0, targetBranchOpenShiftCount: 0 }),
    /Cashier already has an OPEN Shift/,
  );
  assert.throws(
    () => assertPosCoreFreshRunSafe({ cashierOpenShiftCount: 0, dailyClosingCount: 0, targetBranchOpenShiftCount: 1 }),
    /Branch already has an OPEN Shift/,
  );
});

test("POS Core UAT fixture guard accepts explicit local-only execution", () => {
  assert.deepEqual(
    assertPosCoreUatFixtureEnvironment({
      databaseUrl: "postgresql://postgres:secret@127.0.0.1:5432/tetamu",
      nodeEnv: "development",
      appEnv: "local",
      fixtureConfirmation: POS_CORE_UAT_FIXTURE_CONFIRMATION,
    }),
    { environment: "LOCAL_UAT", databaseHost: "127.0.0.1" },
  );
});

test("POS Core UAT fixture guard refuses Production and remote databases", () => {
  assert.throws(
    () =>
      assertPosCoreUatFixtureEnvironment({
        databaseUrl: "postgresql://postgres:secret@127.0.0.1:5432/tetamu",
        nodeEnv: "production",
        fixtureConfirmation: POS_CORE_UAT_FIXTURE_CONFIRMATION,
      }),
    /refuse Production/,
  );
  assert.throws(
    () =>
      assertPosCoreUatFixtureEnvironment({
        databaseUrl: "postgresql://postgres:secret@testing.example.com:5432/tetamu",
        nodeEnv: "test",
        fixtureConfirmation: POS_CORE_UAT_FIXTURE_CONFIRMATION,
      }),
    /refuse non-local database host/,
  );
});

test("POS Core UAT fixture guard requires explicit opt-in and non-trivial password", () => {
  assert.throws(
    () =>
      assertPosCoreUatFixtureEnvironment({
        databaseUrl: "postgresql://postgres:secret@localhost:5432/tetamu",
        nodeEnv: "development",
      }),
    /LOCAL_ONLY_CONFIRMED/,
  );
  assert.throws(() => requireUatFixturePassword("short"), /at least 12/);
  assert.equal(requireUatFixturePassword("local-uat-passphrase"), "local-uat-passphrase");
});
