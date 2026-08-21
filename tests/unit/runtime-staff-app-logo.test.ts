import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  readRuntimeStaffAppLogo,
  writeRuntimeStaffAppLogo,
} from "../../src/lib/runtime-staff-app-logo";

const BUSINESS_ID = "801b4fa7-4208-4a1d-b63e-c34e34ee5afb";

test("Staff App logos use an isolated upload directory and can be read immediately", async () => {
  const uploadRoot = await mkdtemp(path.join(os.tmpdir(), "tetamu-staff-logo-"));
  const expected = Buffer.from("webp-test-bytes");

  try {
    const saved = await writeRuntimeStaffAppLogo({
      businessId: BUSINESS_ID,
      bytes: expected,
      extension: "webp",
      uploadRoot,
    });

    assert.match(
      saved.logoUrl,
      /^\/uploads\/staff-app-logos\/801b4fa7-4208-4a1d-b63e-c34e34ee5afb-[0-9a-f-]+\.webp$/,
    );
    assert.deepEqual(
      await readFile(path.join(uploadRoot, "staff-app-logos", saved.filename)),
      expected,
    );

    const loaded = await readRuntimeStaffAppLogo(saved.filename, uploadRoot);
    assert.ok(loaded);
    assert.equal(loaded.contentType, "image/webp");
    assert.deepEqual(loaded.bytes, expected);
  } finally {
    await rm(uploadRoot, { force: true, recursive: true });
  }
});

test("Staff App logo reads reject unsafe filenames", async () => {
  const uploadRoot = await mkdtemp(path.join(os.tmpdir(), "tetamu-staff-logo-"));

  try {
    assert.equal(
      await readRuntimeStaffAppLogo("../../secret.txt", uploadRoot),
      null,
    );
    assert.equal(
      await readRuntimeStaffAppLogo(`${BUSINESS_ID}-not-a-uuid.webp`, uploadRoot),
      null,
    );
  } finally {
    await rm(uploadRoot, { force: true, recursive: true });
  }
});
