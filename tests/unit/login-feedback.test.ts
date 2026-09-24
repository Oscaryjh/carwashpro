import assert from "node:assert/strict";
import test from "node:test";

test("login failures have specific public messages without exposing auth codes", async () => {
  const { messageForPasswordLoginFailure } = await import("../../src/app/login/login-feedback");
  assert.equal(messageForPasswordLoginFailure("INVALID_CREDENTIALS"), "Email or password is incorrect. Please try again.");
  assert.equal(messageForPasswordLoginFailure("ACCOUNT_UNAVAILABLE"), "This account is currently unavailable. Please contact your administrator.");
  assert.equal(messageForPasswordLoginFailure("SERVICE_LOGIN_DENIED"), "This account cannot be used to sign in here.");
  assert.equal(messageForPasswordLoginFailure("RATE_LIMITED"), "Too many sign-in attempts. Please wait a few minutes and try again.");
});

test("temporary infrastructure failures and unknown errors have separate safe messages", async () => {
  const { messageForLoginException } = await import("../../src/app/login/login-feedback");
  assert.equal(
    messageForLoginException({ code: "P1001" }),
    "We couldn’t sign you in right now. Please try again in a few minutes.",
  );
  assert.equal(
    messageForLoginException({ code: "P2024" }),
    "We couldn’t sign you in right now. Please try again in a few minutes.",
  );
  assert.equal(
    messageForLoginException({ name: "PrismaClientInitializationError" }),
    "We couldn’t sign you in right now. Please try again in a few minutes.",
  );
  assert.equal(
    messageForLoginException(new Error("SESSION_SECRET must be at least 32 characters.")),
    "We couldn’t sign you in right now. Please try again in a few minutes.",
  );
  assert.equal(
    messageForLoginException({ code: "P2002" }),
    "Something went wrong while signing you in. Please try again.",
  );
  assert.equal(
    messageForLoginException(new Error("AUTH_FAIL_CLOSED: private details")),
    "Something went wrong while signing you in. Please try again.",
  );
});
