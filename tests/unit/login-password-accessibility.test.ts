import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const loginFormSource = readFileSync(
  new URL("../../src/app/login/login-form.tsx", import.meta.url),
  "utf8",
);

test("login password label names only the password input", () => {
  assert.match(loginFormSource, /<label htmlFor="login-password">/);
  assert.match(loginFormSource, /id="login-password"[\s\S]*name="password"/);
  assert.doesNotMatch(
    loginFormSource,
    /<label[^>]*>[\s\S]*className="password-field"[\s\S]*<\/label>/,
  );
});
