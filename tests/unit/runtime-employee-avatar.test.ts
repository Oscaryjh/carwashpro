import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  deleteRuntimeEmployeeAvatarByUrl,
  readRuntimeEmployeeAvatar,
  writeRuntimeEmployeeAvatar,
} from "../../src/lib/runtime-employee-avatar";

const MEMBERSHIP_ID = "83466c71-1675-470b-acb1-9217e0aa7b19";

test("independent Staff and Web instances read the same new avatar from shared storage", async () => {
  const staffRoot = await mkdtemp(path.join(os.tmpdir(), "tetamu-staff-avatar-"));
  const webRoot = await mkdtemp(path.join(os.tmpdir(), "tetamu-web-avatar-"));
  const objects = new Map<string, Buffer>();
  const sharedStore = {
    put: async (filename: string, bytes: Buffer) => { objects.set(filename, Buffer.from(bytes)); },
    read: async (filename: string) => objects.get(filename) ?? null,
    delete: async (filename: string) => { objects.delete(filename); },
  };
  const write = writeRuntimeEmployeeAvatar as unknown as (input: {
    membershipId: string; bytes: Buffer; uploadRoot: string; objectStore: typeof sharedStore;
  }) => Promise<{ avatarUrl: string; filename: string }>;
  const read = readRuntimeEmployeeAvatar as unknown as (
    filename: string, uploadRoot: string, objectStore: typeof sharedStore,
  ) => Promise<Buffer | null>;

  try {
    for (const [writerRoot, readerRoot, label] of [
      [staffRoot, webRoot, "Staff to Web"],
      [webRoot, staffRoot, "Web to Staff"],
    ]) {
      const input = Buffer.from(`synthetic-webp-${label}`);
      const saved = await write({ membershipId: MEMBERSHIP_ID, bytes: input, uploadRoot: writerRoot, objectStore: sharedStore });
      const readBytes = await read(saved.filename, readerRoot, sharedStore);
      assert.ok(readBytes, label);
      assert.match(saved.avatarUrl, /^\/uploads\/employee-avatars\/[0-9a-f-]{36}\.webp$/);
      assert.equal(
        createHash("sha256").update(readBytes).digest("hex"),
        createHash("sha256").update(input).digest("hex"),
        label,
      );
      assert.deepEqual(await readdir(writerRoot), [], `${label}: no new avatar is written locally`);
    }
  } finally {
    await rm(staffRoot, { force: true, recursive: true });
    await rm(webRoot, { force: true, recursive: true });
  }
});

test("legacy local avatars remain readable but are not removed by cleanup", async () => {
  const uploadRoot = await mkdtemp(path.join(os.tmpdir(), "tetamu-avatar-"));
  const expected = Buffer.from("webp-avatar-test-bytes");
  const filename = `${MEMBERSHIP_ID}-267edffd-e401-4287-baf4-8875238bd0f5.webp`;
  const localPath = path.join(uploadRoot, "employee-avatars", filename);

  try {
    await mkdir(path.dirname(localPath));
    await writeFile(localPath, expected);
    assert.deepEqual(
      await readRuntimeEmployeeAvatar(filename, uploadRoot),
      expected,
    );
    await deleteRuntimeEmployeeAvatarByUrl(`/uploads/employee-avatars/${filename}`, uploadRoot);
    assert.deepEqual(await readFile(localPath), expected);
  } finally {
    await rm(uploadRoot, { force: true, recursive: true });
  }
});

test("legacy fallback is allowed only for object-not-found, never a store outage", async () => {
  const uploadRoot = await mkdtemp(path.join(os.tmpdir(), "tetamu-avatar-"));
  const filename = `${MEMBERSHIP_ID}-267edffd-e401-4287-baf4-8875238bd0f5.webp`;
  const localPath = path.join(uploadRoot, "employee-avatars", filename);
  try {
    await mkdir(path.dirname(localPath));
    await writeFile(localPath, Buffer.from("old-avatar"));
    const store = {
      put: async () => undefined,
      read: async () => null,
      delete: async () => undefined,
    };
    assert.deepEqual(await readRuntimeEmployeeAvatar(filename, uploadRoot, store), Buffer.from("old-avatar"));
    await assert.rejects(
      () => readRuntimeEmployeeAvatar(filename, uploadRoot, { ...store, read: async () => { throw new Error("provider outage"); } }),
      /provider outage/,
    );
  } finally {
    await rm(uploadRoot, { force: true, recursive: true });
  }
});

test("avatar write fails closed when the shared store cannot return identical bytes", async () => {
  const store = {
    put: async () => undefined,
    read: async () => null,
    delete: async () => undefined,
  };
  await assert.rejects(
    () => writeRuntimeEmployeeAvatar({ membershipId: MEMBERSHIP_ID, bytes: Buffer.from("normalized-webp"), objectStore: store }),
    /verify|integrity/i,
  );
});

test("runtime employee avatar reads and deletes reject unsafe filenames", async () => {
  const uploadRoot = await mkdtemp(path.join(os.tmpdir(), "tetamu-avatar-"));

  try {
    assert.equal(
      await readRuntimeEmployeeAvatar("../../secret.txt", uploadRoot),
      null,
    );
    assert.equal(
      await readRuntimeEmployeeAvatar(`${MEMBERSHIP_ID}-not-a-uuid.webp`, uploadRoot),
      null,
    );
    await deleteRuntimeEmployeeAvatarByUrl("/uploads/employee-avatars/../../secret.txt", uploadRoot);
  } finally {
    await rm(uploadRoot, { force: true, recursive: true });
  }
});
