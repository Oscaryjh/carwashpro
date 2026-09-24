import assert from "node:assert/strict";
import test from "node:test";
import { HEIC_UNSUPPORTED_MESSAGE, staffAvatarFormatError } from "../../src/lib/staff-avatar-format";

test("Staff avatar format policy permits only formats the current upload path supports", () => {
  for (const type of ["image/jpeg", "image/jpg", "image/png", "image/webp", "image/avif", "image/heif"]) {
    assert.equal(staffAvatarFormatError(type), null, type);
  }
  assert.equal(staffAvatarFormatError("image/heic"), HEIC_UNSUPPORTED_MESSAGE);
  assert.equal(staffAvatarFormatError("image/heic-sequence"), HEIC_UNSUPPORTED_MESSAGE);
  assert.equal(staffAvatarFormatError("", "iphone-photo.HEIC"), HEIC_UNSUPPORTED_MESSAGE);
  assert.equal(staffAvatarFormatError("image/heif", "iphone-photo.heic"), HEIC_UNSUPPORTED_MESSAGE);
  assert.equal(staffAvatarFormatError("image/gif"), "Use a JPEG, PNG, WebP or AVIF photo.");
  assert.equal(staffAvatarFormatError(""), "Use a JPEG, PNG, WebP or AVIF photo.");
});
