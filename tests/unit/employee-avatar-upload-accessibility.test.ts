import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const avatarUploadSource = readFileSync(
  new URL("../../src/components/employee-avatar-upload.tsx", import.meta.url),
  "utf8",
);

test("employee avatar file input has an explicit accessible name", () => {
  assert.match(
    avatarUploadSource,
    /aria-label=\{`Upload profile photo for \$\{fullName\}`\}[\s\S]*name="avatar"/,
  );
});
