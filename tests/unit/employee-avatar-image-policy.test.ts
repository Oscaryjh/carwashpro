import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";

async function sample(format: "jpeg" | "png" | "webp" | "avif") {
  return sharp({ create: { width: 8, height: 6, channels: 4, background: { r: 5, g: 20, b: 40, alpha: 1 } } })
    .toFormat(format).toBuffer();
}

test("avatar image policy normalizes verified JPEG, PNG, WebP, AVIF and HEIF-family AV1", async () => {
  const { normalizeEmployeeAvatarImage } = await import("../../src/lib/employee-avatar-image-policy");
  for (const [format, mime, name] of [
    ["jpeg", "image/jpeg", "test.jpg"],
    ["png", "image/png", "test.png"],
    ["webp", "image/webp", "test.webp"],
    ["avif", "image/avif", "test.avif"],
    ["avif", "image/heif", "test.heif"],
  ] as const) {
    const bytes = await normalizeEmployeeAvatarImage(await sample(format), mime, name);
    const metadata = await sharp(bytes).metadata();
    assert.equal(metadata.format, "webp", format);
    assert.equal(metadata.width, 512, format);
    assert.equal(metadata.height, 512, format);
  }
});

test("avatar image policy rejects disguised formats, corrupt payload and HEIC", async () => {
  const { normalizeEmployeeAvatarImage } = await import("../../src/lib/employee-avatar-image-policy");
  const sampleBytes = await sample("jpeg");
  await assert.rejects(() => normalizeEmployeeAvatarImage(sampleBytes, "image/png", "test.png"));
  await assert.rejects(() => normalizeEmployeeAvatarImage(Buffer.from("not an image"), "image/jpeg", "test.jpg"));
  await assert.rejects(() => normalizeEmployeeAvatarImage(Buffer.from("heic"), "image/heic", "test.heic"), /HEIC is not supported yet/);
  await assert.rejects(() => normalizeEmployeeAvatarImage(sampleBytes, "image/jpeg", "test.heic"), /HEIC is not supported yet/);
});
