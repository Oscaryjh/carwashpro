import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  deleteRuntimeEmployeeAvatarByUrl,
  readRuntimeEmployeeAvatar,
  writeRuntimeEmployeeAvatar,
} from "../../src/lib/runtime-employee-avatar";

const MEMBERSHIP_ID = "83466c71-1675-470b-acb1-9217e0aa7b19";

test("runtime employee avatars are written atomically and can be replaced safely", async () => {
  const uploadRoot = await mkdtemp(path.join(os.tmpdir(), "tetamu-avatar-"));
  const expected = Buffer.from("webp-avatar-test-bytes");

  try {
    const saved = await writeRuntimeEmployeeAvatar({
      membershipId: MEMBERSHIP_ID,
      bytes: expected,
      uploadRoot,
    });

    assert.match(
      saved.avatarUrl,
      /^\/uploads\/employee-avatars\/83466c71-1675-470b-acb1-9217e0aa7b19-[0-9a-f-]+\.webp$/,
    );
    assert.deepEqual(
      await readRuntimeEmployeeAvatar(saved.filename, uploadRoot),
      expected,
    );
    assert.deepEqual(
      await readFile(path.join(uploadRoot, "employee-avatars", saved.filename)),
      expected,
    );

    await deleteRuntimeEmployeeAvatarByUrl(saved.avatarUrl, uploadRoot);
    assert.equal(
      await readRuntimeEmployeeAvatar(saved.filename, uploadRoot),
      null,
    );
  } finally {
    await rm(uploadRoot, { force: true, recursive: true });
  }
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
