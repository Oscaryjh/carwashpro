import test from "node:test";
import assert from "node:assert/strict";
import type { PrismaClient } from "@prisma/client";
import { readFile } from "node:fs/promises";
import { loadOwnPublishedPayslip } from "../../src/lib/payroll/payslip-publication";

test("Staff reads legacy immutable publication without querying current manual PCB inputs", async () => {
  const original = { payrollEntryId: "legacy", documentBytes: Buffer.from("frozen-original"), payrollEntry: { employeeCodeSnapshot: "synthetic" }, payrollRun: { periodStart: new Date("2026-01-01") } };
  const database = { payrollPayslipPublication: { findFirst: async ({ where }: { where: Record<string, string> }) => {
    assert.deepEqual(where, { id: "publication", businessId: "business", membershipId: "own" }); return original;
  } }, payrollPcbPublicationVersion: { findFirst: async () => null }, payrollEntry: { findFirst: async () => { throw new Error("LIVE_INPUT_QUERY_FORBIDDEN"); } } } as unknown as PrismaClient;
  assert.deepEqual(await loadOwnPublishedPayslip({ businessId: "business", membershipId: "own", publicationId: "publication" }, database), original);
});
test("frozen publication download records the selected version before returning bytes", async () => {
  const route = await readFile(new URL("../../src/app/(business)/team/payroll/payslips/[entryId]/route.ts", import.meta.url), "utf8");
  const frozenPath = route.slice(route.indexOf("if (publication)"), route.indexOf("const document ="));
  assert.match(frozenPath, /await tryWriteAuditLog/);
  assert.match(frozenPath, /publicationId: publication.id/);
  assert.match(frozenPath, /publicationVersion: version\?\.version/);
});
test("history derives pending state from current membership and open run, not the last event", async () => {
  const page = await readFile(new URL("../../src/app/(business)/team/payroll/payslips/[entryId]/history/page.tsx", import.meta.url), "utf8");
  assert.match(page, /activeEmployee: publication.membership.status === "ACTIVE"/);
  assert.match(page, /hasNextRun: nextRun\?\.status === "REVIEW"/);
  assert.doesNotMatch(page, /events.find/);
});
