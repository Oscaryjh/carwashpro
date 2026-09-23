import assert from "node:assert/strict";
import test from "node:test";
import {
  selectIntegrationFiles,
  selectIsolatedIntegrationFiles,
} from "../../scripts/lib/disposable-integration-files.mjs";

const available = [
  "tests/integration/attendance-employee-auth.test.ts",
  "tests/integration/attendance-phase1c-route-flow.test.ts",
];

test("disposable integration runner selects only known requested test files", () => {
  assert.deepEqual(selectIntegrationFiles(available, [available[0]]), [available[0]]);
  assert.deepEqual(selectIntegrationFiles(available, []), available);
});

test("disposable integration runner rejects unknown or non-test paths", () => {
  assert.throws(() => selectIntegrationFiles(available, ["../prisma/schema.prisma"]), /unknown integration test/);
  assert.throws(() => selectIntegrationFiles(available, ["tests/integration/missing.test.ts"]), /unknown integration test/);
});

test("disposable runner does not append an isolated test that was not selected", () => {
  assert.deepEqual(selectIsolatedIntegrationFiles([available[0]], [available[1]]), []);
  assert.deepEqual(selectIsolatedIntegrationFiles(available, [available[1]]), [available[1]]);
});
