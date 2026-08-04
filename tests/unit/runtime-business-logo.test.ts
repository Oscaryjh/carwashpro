import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  readRuntimeBusinessLogo,
  writeRuntimeBusinessLogo,
} from "../../src/lib/runtime-business-logo";

const BUSINESS_ID = "801b4fa7-4208-4a1d-b63e-c34e34ee5afb";

test("runtime business logos are written atomically and can be read immediately", async () => {
  const uploadRoot = await mkdtemp(path.join(os.tmpdir(), "tetamu-logo-"));
  const expected = Buffer.from("webp-test-bytes");

  try {
    const saved = await writeRuntimeBusinessLogo({
      businessId: BUSINESS_ID,
      bytes: expected,
      extension: "webp",
      uploadRoot,
    });

    assert.match(
      saved.logoUrl,
      /^\/uploads\/business-logos\/801b4fa7-4208-4a1d-b63e-c34e34ee5afb-[0-9a-f-]+\.webp$/,
    );

    const loaded = await readRuntimeBusinessLogo(saved.filename, uploadRoot);
    assert.ok(loaded);
    assert.equal(loaded.contentType, "image/webp");
    assert.deepEqual(loaded.bytes, expected);

    const stored = await readFile(
      path.join(uploadRoot, "business-logos", saved.filename),
    );
    assert.deepEqual(stored, expected);
  } finally {
    await rm(uploadRoot, { force: true, recursive: true });
  }
});

test("runtime business logo reads reject unsafe or unsupported filenames", async () => {
  const uploadRoot = await mkdtemp(path.join(os.tmpdir(), "tetamu-logo-"));

  try {
    assert.equal(
      await readRuntimeBusinessLogo("../../secret.txt", uploadRoot),
      null,
    );
    assert.equal(
      await readRuntimeBusinessLogo(`${BUSINESS_ID}-not-a-uuid.webp`, uploadRoot),
      null,
    );
    assert.equal(
      await readRuntimeBusinessLogo(
        `${BUSINESS_ID}-26a2fa1b-4bf0-4a70-9a43-2180171f5f07.svg`,
        uploadRoot,
      ),
      null,
    );
  } finally {
    await rm(uploadRoot, { force: true, recursive: true });
  }
});

test("runtime business logo reads return null when a valid file is missing", async () => {
  const uploadRoot = await mkdtemp(path.join(os.tmpdir(), "tetamu-logo-"));

  try {
    assert.equal(
      await readRuntimeBusinessLogo(
        `${BUSINESS_ID}-26a2fa1b-4bf0-4a70-9a43-2180171f5f07.webp`,
        uploadRoot,
      ),
      null,
    );
  } finally {
    await rm(uploadRoot, { force: true, recursive: true });
  }
});
