import assert from "node:assert/strict";
import test from "node:test";
import { detectContentType, optimizeImage } from "next/dist/server/image-optimizer";
import sharp from "sharp";
import { processEmployeeAvatarImage } from "../../src/lib/employee-avatar-image";

type SharpTestPipeline = {
  avif(options: { quality: number; effort: number }): SharpTestPipeline;
  metadata(): Promise<{
    compression?: string;
    format?: string;
    height?: number;
    width?: number;
  }>;
  toBuffer(): Promise<Buffer>;
};
const testSharp = sharp as unknown as (
  input: Buffer,
  options?: { raw?: { channels: 3; height: number; width: number } },
) => SharpTestPipeline;

test("direct employee avatar processing accepts a safe in-memory AVIF fixture", async () => {
  const fixture = await safeAvifFixture();
  assert.equal(await detectContentType(fixture), "image/avif");

  const output = await processEmployeeAvatarImage(fixture);
  const metadata = await testSharp(output).metadata();
  assert.equal(metadata.format, "webp");
  assert.equal(metadata.width, 512);
  assert.equal(metadata.height, 512);
});

test("Next Image Optimization processes the safe AVIF fixture through its runtime boundary", async () => {
  const fixture = await safeAvifFixture();
  const output = await optimizeImage({
    buffer: fixture,
    contentType: "image/avif",
    quality: 75,
    width: 16,
    operationCache: false,
    limitInputPixels: 40_000_000,
    sequentialRead: true,
    timeoutInSeconds: 7,
  });
  const metadata = await testSharp(output).metadata();
  assert.equal(metadata.format, "heif");
  assert.equal(metadata.compression, "av1");
  assert.equal(metadata.width, 16);
  assert.equal(metadata.height, 12);
});

async function safeAvifFixture() {
  const width = 32;
  const height = 24;
  const channels = 3;
  const pixels = Buffer.alloc(width * height * channels);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * channels;
      pixels[offset] = (x * 7) % 256;
      pixels[offset + 1] = (y * 11) % 256;
      pixels[offset + 2] = 128;
    }
  }
  return testSharp(pixels, { raw: { width, height, channels } })
    .avif({ quality: 60, effort: 2 })
    .toBuffer();
}
