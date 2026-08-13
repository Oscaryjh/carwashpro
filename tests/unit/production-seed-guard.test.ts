import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("Production seed requires explicit one-time bootstrap and strong credentials", async () => {
  const source = await readFile("prisma/seed.ts", "utf8");
  assert.match(source, /isProductionRuntime/);
  assert.match(source, /ALLOW_PRODUCTION_PLATFORM_ADMIN_BOOTSTRAP/);
  assert.match(source, /password\.length < 16/);
  assert.match(source, /Platform Admin already exists/);
  assert.match(source, /bootstrap email already belongs to a user/);
  assert.match(source, /no QA\/templates\/commercial seed data was created/);
  assert.doesNotMatch(source, /production \? "admin@example\.com"/);
  assert.doesNotMatch(source, /ChangeMe123!/);
});
