import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("leave requests are separated into compact pending, approved and closed views", async () => {
  const [page, styles] = await Promise.all([
    readFile("src/app/(business)/team/leave/page.tsx", "utf8"),
    readFile("src/app/(business)/team/leave/leave.module.css", "utf8"),
  ]);

  assert.match(page, /queue\?: "pending" \| "approved" \| "closed"/);
  assert.match(page, /Pending approval/);
  assert.match(page, /Approved leave/);
  assert.match(page, /Rejected & cancelled/);
  assert.match(page, /Cancel approved leave/);
  assert.doesNotMatch(page, /requestQueue === "cancel"/);
  assert.match(page, /request\.status === "APPROVED"/);
  assert.match(page, /On leave today/);
  assert.match(page, /Upcoming leave/);
  assert.match(page, /request\.status === "APPROVED" && request\.startsOn/);
  assert.match(page, /<details className=\{styles\.requestDetails\}>/);
  assert.match(page, /Balance \{formatBalance\(request\.currentBalance\)\} → \{formatBalance\(request\.resultingBalance\)\}/);

  assert.match(styles, /\.requestQueues\s*\{/);
  assert.match(styles, /\.requestDetails\s*\{/);
  assert.match(styles, /\.requestDetailsBody\s*\{/);
  assert.match(styles, /overflow-x: auto/);
});
