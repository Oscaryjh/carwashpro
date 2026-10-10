import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { build } from "esbuild";
import { PrismaClient } from "@prisma/client";
import { reportFixture } from "../helpers/report-outlet-fixture";
import { createBusinessExpense, updateDraftBusinessExpense } from "../../src/lib/expense/service";
import { getBusinessPerformanceReadModel } from "../../src/lib/business-performance/read-model";
import { createClosingActionsFixture, closingForm, actionRedirect } from "../helpers/closing-actions-fixture";

const url = new URL(process.env.DATABASE_URL!);
if (url.hostname !== "127.0.0.1" || url.port !== "55446" || !url.pathname.startsWith("/tetamu_phase1c2_disposable_")) throw Error("Phase 1C2 disposable DB required");
const db = new PrismaClient();
const state = globalThis as typeof globalThis & { phase1c2Db?: PrismaClient };
let api: typeof import("../../src/lib/phase1c2-outlet-context") & typeof import("../../src/lib/expense/create-branch");
before(async () => {
  state.phase1c2Db = db;
  const stubs: Record<string, string> = { "server-only": "export {};", "@/lib/prisma": "export const prisma=globalThis.phase1c2Db;" };
  const result = await build({ stdin: { contents: 'export * from "./src/lib/phase1c2-outlet-context";export * from "./src/lib/expense/create-branch";', resolveDir: process.cwd() }, bundle: true, write: false, platform: "node", format: "cjs", packages: "external", plugins: [{ name: "real-disposable-db", setup(b) {
    b.onResolve({ filter: /.*/ }, a => stubs[a.path] ? { path: a.path, namespace: "boundary" } : undefined);
    b.onLoad({ filter: /.*/, namespace: "boundary" }, a => ({ contents: stubs[a.path] }));
  } }] });
  const compiled = { exports: {} };
  new Function("require", "module", "exports", result.outputFiles[0].text)(createRequire(import.meta.url), compiled, compiled.exports);
  api = compiled.exports as typeof api;
});
after(async () => { delete state.phase1c2Db; await db.$disconnect(); });
const actor = (user: { id: string; name: string; email: string | null }) => {
  assert.ok(user.email, "Synthetic actor requires an email");
  return { userId: user.id, name: user.name, email: user.email };
};
const key = () => `PHASE1C2:${randomUUID()}`;
async function expenseBranch(f: Awaited<ReturnType<typeof reportFixture>>, scope: "THIS_OUTLET" | "BUSINESS_WIDE", user = f.owner, explicit?: string) {
  return api.resolveExpenseCreateBranch({ businessId: f.business.id, user: { userId: user.id, role: user.role, branchId: user.branchId }, access: { granted: true, effectiveBusinessRole: user.role } as never, expenseScope: scope, ...(explicit === undefined ? {} : { requestedBranchId: explicit }) });
}
test("real single/zero Expense scope persists outlet or null and ordinary edits preserve both", async () => {
  for (const count of [1, 0]) {
    const f = await reportFixture(db, count), category = await db.expenseCategory.findFirstOrThrow({ where: { businessId: f.business.id } });
    for (const scope of ["THIS_OUTLET", "BUSINESS_WIDE"] as const) {
      if (count === 0 && scope === "THIS_OUTLET") { await assert.rejects(expenseBranch(f, scope)); continue; }
      const branchId = await expenseBranch(f, scope);
      assert.equal(branchId, scope === "THIS_OUTLET" ? f.branches[0].id : null);
      const facts = { actor: actor(f.owner), businessId: f.business.id, branchId, categoryId: category.id, amount: "13", description: `Disposable ${scope}`, expenseDate: "2026-10-10" };
      const created = await createBusinessExpense({ ...facts, operationKey: key() }, db);
      const edited = await updateDraftBusinessExpense({ ...facts, description: "Edited ordinary field", expenseId: created.id, expectedRevision: created.revision, operationKey: key() }, db);
      assert.equal(edited.branchId, branchId);
    }
  }
});
test("real Staff Business-wide, explicit cross-Business, stale topology and revoked capability deny before writes", async () => {
  const f = await reportFixture(db), other = await reportFixture(db);
  await db.user.update({ where: { id: f.staff.id }, data: { permissions: ["EXPENSE_VIEW", "EXPENSE_CREATE"] } });
  const staff = await db.user.findUniqueOrThrow({ where: { id: f.staff.id } });
  const before = await db.businessExpense.count({ where: { businessId: f.business.id } });
  await assert.rejects(expenseBranch(f, "BUSINESS_WIDE", staff));
  await assert.rejects(expenseBranch(f, "THIS_OUTLET", f.owner, other.branches[0].id));
  const input = { businessId: f.business.id, actorUserId: f.owner.id, capability: "RUN_CLOSING" as const, operation: "write" as const };
  const rendered = await api.resolvePhase1c2OutletContext(input);
  await db.branch.create({ data: { businessId: f.business.id, name: "Topology changed" } });
  await assert.rejects(api.guardPhase1c2Create({ ...input, rendered, formData: new FormData() }));
  await assert.rejects(expenseBranch(f, "THIS_OUTLET"));
  await db.user.update({ where: { id: f.owner.id }, data: { loginEnabled: false } });
  await assert.rejects(expenseBranch(f, "BUSINESS_WIDE"));
  assert.equal(await db.businessExpense.count({ where: { businessId: f.business.id } }), before);
});
test("real Dashboard mixed Expense remains 950 and refund 10 reduces it to 940", async () => {
  const f = await reportFixture(db);
  const result = await getBusinessPerformanceReadModel({ businessId: f.business.id, allowedBranchIds: [f.branches[0].id], selectedBranchId: f.branches[0].id, includeBusinessWide: true, expenseScope: { allowedBranchIds: [f.branches[0].id], includeBusinessWide: true }, range: "custom", from: "2026-10-10", to: "2026-10-10" });
  assert.equal(result.businessSpending?.recorded, "50.00");
  assert.equal(result.businessSpending?.incomeVsRecordedSpending, "950.00");
  const payment = await db.payment.findFirstOrThrow({ where: { businessId: f.business.id, branchId: f.branches[0].id } });
  await db.paymentRefund.create({ data: { businessId: f.business.id, branchId: payment.branchId, paymentId: payment.id, invoiceId: payment.invoiceId, amount: 10, method: "CASH", reason: "Disposable reporting regression", refundedAt: payment.paidAt } });
  const refunded = await getBusinessPerformanceReadModel({ businessId: f.business.id, allowedBranchIds: [f.branches[0].id], selectedBranchId: f.branches[0].id, includeBusinessWide: true, expenseScope: { allowedBranchIds: [f.branches[0].id], includeBusinessWide: true }, range: "custom", from: "2026-10-10", to: "2026-10-10" });
  assert.equal(refunded.businessSpending?.recorded, "50.00");
  assert.equal(refunded.businessSpending?.incomeVsRecordedSpending, "940.00");
});

test("ending an existing historical Shift preserves its document branch and cash formula", async () => {
  const f = await reportFixture(db);
  await db.business.update({ where: { id: f.business.id }, data: { cashierShiftsEnabled: true } });
  const shift = await db.cashierShift.create({ data: { businessId: f.business.id, branchId: f.historical.id, cashierId: f.owner.id, openingFloat: 50, startedAt: new Date(), status: "OPEN" } });
  const h = await createClosingActionsFixture(db);
  try {
    await h.login(f.owner.id);
    const redirect = await actionRedirect(h.actions.endShiftAction(closingForm({ shiftId: shift.id, closingCash: "50" })));
    assert.match(redirect, /type=success/);
    const closed = await db.cashierShift.findUniqueOrThrow({ where: { id: shift.id } });
    assert.equal(closed.status, "CLOSED"); assert.equal(closed.branchId, f.historical.id);
    assert.equal(closed.expectedCash?.toFixed(2), "50.00"); assert.equal(closed.cashDifference?.toFixed(2), "0.00");
  } finally { await h.close(); }
});
