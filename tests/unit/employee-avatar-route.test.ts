import assert from "node:assert/strict";
import test from "node:test";
import { GET } from "../../src/app/uploads/employee-avatars/[filename]/route";

const AVATAR = "267edffd-e401-4287-baf4-8875238bd0f5.webp";

test("public avatar GET rejects traversal without accessing storage", async () => {
  const response = await GET(new Request("http://localhost/uploads/employee-avatars/../secret"), {
    params: Promise.resolve({ filename: "..%2fsecret" }),
  });
  assert.equal(response.status, 404);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
});

test("avatar GET sanitizes missing private storage configuration", async () => {
  const prior = process.env.APP_ENVIRONMENT;
  process.env.APP_ENVIRONMENT = "testing";
  try {
    const response = await GET(new Request(`http://localhost/uploads/employee-avatars/${AVATAR}`), {
      params: Promise.resolve({ filename: AVATAR }),
    });
    assert.equal(response.status, 503);
    assert.equal(await response.text(), "Avatar temporarily unavailable.");
    assert.equal(response.headers.get("cache-control"), "no-store");
  } finally {
    if (prior === undefined) delete process.env.APP_ENVIRONMENT;
    else process.env.APP_ENVIRONMENT = prior;
  }
});
