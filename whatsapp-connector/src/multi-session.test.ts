import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import {
  getActiveSessionCount,
  getSessionAuthInfoPath,
  getStatus,
} from "./socket.js";

test("uses isolated auth directories for different businesses", () => {
  process.env.AUTH_INFO_PATH = path.join("C:", "tmp", "whatsapp-auth");
  process.env.WHATSAPP_DEFAULT_BUSINESS_ID = "business-a";

  assert.equal(
    getSessionAuthInfoPath("business-a"),
    path.resolve(process.env.AUTH_INFO_PATH),
  );
  assert.equal(
    getSessionAuthInfoPath("business-b"),
    path.join(path.resolve(process.env.AUTH_INFO_PATH), "sessions", "business-b"),
  );
});

test("keeps connector state isolated by business ID", () => {
  const first = getStatus("business-a");
  const second = getStatus("business-b");

  assert.equal(first.businessId, "business-a");
  assert.equal(second.businessId, "business-b");
  assert.notEqual(first, second);
  assert.equal(getActiveSessionCount(), 2);
});
