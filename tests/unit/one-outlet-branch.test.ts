import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BranchSelect } from "../../src/components/branch-select";
import { resolveBranchId, resolveOperationalBranchId } from "../../src/lib/branches";
import { prisma } from "../../src/lib/prisma";
import { InventoryCommandForm } from "../../src/components/inventory-command-form";

const lintas = { id: "lintas", name: "A Salon Lintas" };
const damai = { id: "damai", name: "Legacy second branch" };

function stubBranch(t: TestContext, method: "findMany" | "findFirst", implementation: (query: any) => Promise<any>) {
  const original = prisma.branch[method];
  Object.assign(prisma.branch, { [method]: implementation });
  t.after(() => { Object.assign(prisma.branch, { [method]: original }); });
}

test("operational branch resolution fails closed for zero active stores", async (t) => {
  stubBranch(t, "findMany", async () => []);
  await assert.rejects(resolveBranchId("business-a", null), /No active/);
});

test("single store is resolved server-side without relying on a hidden input", async (t) => {
  stubBranch(t, "findMany", async (query: any) => {
    assert.deepEqual(query.where, { businessId: "business-a", status: "ACTIVE" });
    return [lintas];
  });
  assert.equal(await resolveBranchId("business-a", null), "lintas");
  await assert.rejects(resolveBranchId("business-a", "foreign-business-branch"), /invalid/);
});

test("legacy multi branch requires explicit valid selection", async (t) => {
  stubBranch(t, "findMany", async () => [lintas, damai]);
  await assert.rejects(resolveBranchId("business-a", null), /required/);
  await assert.rejects(resolveBranchId("business-a", "foreign"), /invalid/);
  assert.equal(await resolveBranchId("business-a", "damai"), "damai");
});

test("staff resolver continues to use authenticated active business assignment", async (t) => {
  stubBranch(t, "findFirst", async (query: any) => {
    assert.deepEqual(query.where, { id: "lintas", businessId: "business-a", status: "ACTIVE" });
    return lintas;
  });
  assert.equal(await resolveOperationalBranchId("business-a", { role: "STAFF", branchId: "lintas" }, "foreign"), "lintas");
  await assert.rejects(resolveOperationalBranchId("business-a", { role: "STAFF", branchId: null }, null));
});

test("single store has no selector; legacy multi branch has an explicit empty selection", () => {
  const single = renderToStaticMarkup(createElement(BranchSelect, { branches: [lintas] }));
  assert.doesNotMatch(single, /<select/);
  assert.match(single, /name="branchId" value="lintas"/);
  const multi = renderToStaticMarkup(createElement(BranchSelect, { branches: [lintas, damai] }));
  assert.match(multi, /<select[^>]*required/);
  assert.match(multi, /<option value="" disabled="" selected=""/);
});

test("branch selector supports the existing Performance branch query key without creating another branchId", () => {
  const html = renderToStaticMarkup(createElement(BranchSelect, { branches: [lintas], name: "branch" } as Parameters<typeof BranchSelect>[0]));
  assert.match(html, /name="branch" value="lintas"/);
  assert.doesNotMatch(html, /name="branchId"/);
});

test("zero store selection shows an actionable error rather than disappearing", () => {
  const html = renderToStaticMarkup(createElement(BranchSelect, { branches: [] }));
  assert.match(html, /role="alert"/);
  assert.match(html, /No active/);
});

test("single outlet inventory commands do not require branch selection; transfers need two locations", () => {
  const props = { action: async () => {}, branches: [lintas], products: [] };
  const html = renderToStaticMarkup(createElement(InventoryCommandForm, { ...props, mode: "STOCK_IN" }));
  assert.doesNotMatch(html, /<select[^>]*name="branchId"/);
  assert.match(html, /name="branchId" value="lintas"/);
  const transfer = renderToStaticMarkup(createElement(InventoryCommandForm, { ...props, mode: "TRANSFER" }));
  assert.match(transfer, /at least two/);
  assert.doesNotMatch(transfer, /<button[^>]*type="submit"/);
  const legacy = renderToStaticMarkup(createElement(InventoryCommandForm, { ...props, branches: [lintas, damai], mode: "STOCK_IN" }));
  assert.match(legacy, /<select[^>]*name="branchId"/);
});
