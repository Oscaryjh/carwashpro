import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { StaffApiError, staffApiFetch } from "../../src/lib/staff-pwa/client";

const claimsSource = readFileSync(
  new URL("../../src/components/staff-pwa/staff-claims.tsx", import.meta.url),
  "utf8",
);

test("Claims maps a rejected fetch to a Claims-specific network error", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new TypeError("Load failed");
  };

  try {
    await assert.rejects(
      staffApiFetch(
        "/api/employee-claims",
        { method: "POST", body: new FormData() },
        {
          networkErrorMessage:
            "Claims requires a network connection. Connect to the internet and try again.",
        },
      ),
      (error: unknown) => {
        assert.ok(error instanceof StaffApiError);
        assert.equal(error.code, "NETWORK_ERROR");
        assert.equal(error.status, 0);
        assert.equal(
          error.message,
          "Claims requires a network connection. Connect to the internet and try again.",
        );
        return true;
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Claims keeps the canonical same-origin multipart submission path", async () => {
  const originalFetch = globalThis.fetch;
  const body = new FormData();
  body.set("payload", JSON.stringify({ clientRequestId: "fixture" }));
  let capturedInput: RequestInfo | URL | undefined;
  let capturedInit: RequestInit | undefined;

  globalThis.fetch = async (input, init) => {
    capturedInput = input;
    capturedInit = init;
    return new Response(JSON.stringify({ ok: true }), {
      status: 201,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    await staffApiFetch<{ ok: true }>(
      "/api/employee-claims",
      { method: "POST", body },
      { networkErrorMessage: "Claims network error" },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(capturedInput, "/api/employee-claims");
  assert.equal(capturedInit?.method, "POST");
  assert.equal(capturedInit?.body, body);
  assert.equal(capturedInit?.cache, "no-store");
  assert.equal(capturedInit?.credentials, "same-origin");
  assert.equal(new Headers(capturedInit?.headers).has("content-type"), false);
  assert.match(claimsSource, /clientRequestId:\s*createBrowserUuid\(\)/);
  assert.match(claimsSource, /body\.set\("payload", JSON\.stringify\(payload\)\)/);
  assert.match(claimsSource, /body\.set\("receipt:1", receipt\)/);
  assert.match(claimsSource, /CLAIMS_API_OPTIONS/);
  assert.doesNotMatch(claimsSource, /Attendance requires a network connection/);
});
