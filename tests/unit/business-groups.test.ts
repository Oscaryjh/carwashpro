import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {
  businessGroupSchema,
  businessGroupUserSchema,
  uniqueIds,
} from "../../src/lib/validation/business-group";

test("business group validation accepts a stable group code", () => {
  const result = businessGroupSchema.safeParse({ name: "Oscar Group", code: "oscar-group" });
  assert.equal(result.success, true);
});

test("business group validation rejects unsafe group codes", () => {
  const result = businessGroupSchema.safeParse({ name: "Oscar Group", code: "Oscar Group!" });
  assert.equal(result.success, false);
});

test("group managers require at least one selected business", () => {
  const result = businessGroupUserSchema.safeParse({
    groupId: "0c5e9272-58dc-4c34-9665-1f5e88506772",
    userId: "e381b9f4-f42b-4d38-b631-28ab253c55e7",
    role: "GROUP_MANAGER",
    businessIds: [],
  });
  assert.equal(result.success, false);
});

test("group owners use all-business scope without selected businesses", () => {
  const result = businessGroupUserSchema.safeParse({
    groupId: "0c5e9272-58dc-4c34-9665-1f5e88506772",
    userId: "e381b9f4-f42b-4d38-b631-28ab253c55e7",
    role: "GROUP_OWNER",
    businessIds: [],
  });
  assert.equal(result.success, true);
});

test("group business selection removes duplicate IDs before persistence", () => {
  assert.deepEqual(uniqueIds(["business-a", "business-b", "business-a"]), ["business-a", "business-b"]);
});

test("group migration protects one active membership and preserves history", async () => {
  const migrationPath = path.join(
    process.cwd(),
    "prisma",
    "migrations",
    "20260727100000_add_business_groups",
    "migration.sql",
  );
  const migration = await readFile(migrationPath, "utf8");

  assert.match(migration, /business_group_members_one_active_business_key/);
  assert.match(migration, /WHERE "status" = 'ACTIVE'/);
  assert.match(migration, /"removed_at" TIMESTAMP/);
  assert.doesNotMatch(migration, /ALTER TABLE "(payments|invoices|appointments|work_orders)"/);
});
