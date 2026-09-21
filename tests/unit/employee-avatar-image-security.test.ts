import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import {
  AvatarImageValidationError,
  processEmployeeAvatarImage,
} from "../../src/lib/employee-avatar-image";

const MAX_BYTES = 1024 * 1024;
const HEVC_HEIC_FIXTURE = Buffer.from(
  "AAAAHGZ0eXBoZWljAAAAAG1pZjFoZWljbWlhZgAAAXttZXRhAAAAAAAAACFoZGxyAAAAAAAAAABwaWN0AAAAAAAAAAAAAAAAAAAAACJpbG9jAAAAAERAAAEAAQAAAAABnwABAAAAAAAAAGwAAAAjaWluZgAAAAAAAQAAABVpbmZlAgAAAAABAABodmMxAAAAAA5waXRtAAAAAAABAAAA+2lwcnAAAADbaXBjbwAAAHZodmNDAQNwAAAAAAAAAAAAHvAA/P34+AAADwNgAAEAGEABDAH//wNwAAADAJAAAAMAAAMAHroCQGEAAQAqQgEBA3AAAAMAkAAAAwAAAwAeoCCBBZbq5Ka5uAhoMCAAAAMDIAAAAwAhYgABAAZEAcFzwIkAAAATY29scm5jbHgAAQANAAaAAAAAFGlzcGUAAAAAAAAAQAAAAEAAAAAoY2xhcAAAACAAAAABAAAAIAAAAAH////gAAAAAv///+AAAAACAAAADnBpeGkAAAAAAQgAAAAYaXBtYQAAAAAAAAABAAEFgQIDBYQAAAB0bWRhdAAAAGgoAa8TgPUrAhGDczL1mz4HCRRzxqbGjnnUrr1cLTO799zRz6nw0QjRMp+4I2Da10D3ghQEMvB53CWoI0S3qXIb99YsvLFaQ9ZLHxsJsZ9SxlvNJ5EgD4Y4miuaKu3bxPGXDHirp/9TzA==",
  "base64",
);

test("employee avatar processing accepts the supported raster formats and emits bounded WebP", async () => {
  const fixtures = await validImageFixtures();

  for (const fixture of fixtures) {
    const output = await processEmployeeAvatarImage({
      input: fixture.bytes,
      contentType: fixture.contentType,
      maxBytes: MAX_BYTES,
    });
    const metadata = await sharp(output).metadata();

    assert.equal(metadata.format, "webp", fixture.name);
    assert.equal(metadata.width, 512, fixture.name);
    assert.equal(metadata.height, 512, fixture.name);
  }
});

test("employee avatar processing rejects unsupported or path-like content types before decoding", async () => {
  const jpeg = await createFixture("jpeg");

  for (const contentType of [
    "text/plain",
    "application/octet-stream",
    "image/jpeg; filename=../../payload.js",
  ]) {
    await assert.rejects(
      processEmployeeAvatarImage({ input: jpeg, contentType, maxBytes: MAX_BYTES }),
      (error: unknown) => isAvatarError(error, "UNSUPPORTED_TYPE"),
      contentType,
    );
  }
});

test("employee avatar processing rejects corrupt image bytes without persisting output", async () => {
  await assert.rejects(
    processEmployeeAvatarImage({
      input: Buffer.from("not-an-image\0<script>alert(1)</script>"),
      contentType: "image/jpeg",
      maxBytes: MAX_BYTES,
    }),
    (error: unknown) => isAvatarError(error, "PROCESSING_FAILED"),
  );
});

test("employee avatar processing fails safely when HEIC decoding is unavailable", async () => {
  await assert.rejects(
    processEmployeeAvatarImage({
      input: HEVC_HEIC_FIXTURE,
      contentType: "image/heic",
      maxBytes: MAX_BYTES,
    }),
    (error: unknown) => isAvatarError(error, "PROCESSING_FAILED"),
  );
});

test("employee avatar processing rejects oversized input before image decoding", async () => {
  await assert.rejects(
    processEmployeeAvatarImage({
      input: Buffer.alloc(MAX_BYTES + 1),
      contentType: "image/png",
      maxBytes: MAX_BYTES,
    }),
    (error: unknown) => isAvatarError(error, "TOO_LARGE"),
  );
});

async function validImageFixtures() {
  const avif = await createFixture("avif");
  return [
    { name: "JPEG", contentType: "image/jpeg", bytes: await createFixture("jpeg") },
    { name: "PNG", contentType: "image/png", bytes: await createFixture("png") },
    { name: "WebP", contentType: "image/webp", bytes: await createFixture("webp") },
    { name: "AVIF", contentType: "image/avif", bytes: avif },
    { name: "HEIF", contentType: "image/heif", bytes: avif },
  ];
}

async function createFixture(format: "jpeg" | "png" | "webp" | "avif") {
  return sharp({
    create: {
      width: 8,
      height: 6,
      channels: 4,
      background: { r: 20, g: 80, b: 140, alpha: 1 },
    },
  })
    .toFormat(format)
    .toBuffer();
}

function isAvatarError(error: unknown, code: string) {
  return error instanceof AvatarImageValidationError && error.code === code;
}
