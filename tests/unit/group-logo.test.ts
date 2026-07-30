import assert from "node:assert/strict";
import test from "node:test";
import { detectGroupLogoExtension } from "../../src/lib/business-groups/group-logo";

test("group logo signature validation accepts supported image formats", () => {
  assert.equal(
    detectGroupLogoExtension(
      Uint8Array.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      ]),
      "image/png",
    ),
    "png",
  );
  assert.equal(
    detectGroupLogoExtension(
      Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]),
      "image/jpeg",
    ),
    "jpg",
  );
  assert.equal(
    detectGroupLogoExtension(
      Uint8Array.from([
        0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50,
      ]),
      "image/webp",
    ),
    "webp",
  );
});

test("group logo signature validation rejects spoofed and unsupported files", () => {
  assert.equal(
    detectGroupLogoExtension(
      Uint8Array.from([0x47, 0x49, 0x46, 0x38]),
      "image/png",
    ),
    null,
  );
  assert.equal(
    detectGroupLogoExtension(
      Uint8Array.from([0x89, 0x50, 0x4e, 0x47]),
      "image/gif",
    ),
    null,
  );
});
