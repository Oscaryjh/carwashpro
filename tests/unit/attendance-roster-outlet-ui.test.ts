import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { attendanceOutletPages } from "../helpers/attendance-outlet-pages";

test("P2 single location is hidden context, legacy keeps selector and zero gates current forms", async () => {
  const state = globalThis as typeof globalThis & Record<string, unknown>;
  state.attendanceOutletActor = { businessId: "business-a", user: { role: "BUSINESS_OWNER" }, access: {
    granted: true, identityRole: "BUSINESS_OWNER", businessId: "business-a", effectiveBusinessRole: "BUSINESS_OWNER", permissions: [], source: "DIRECT_BUSINESS",
  } };
  let branches = [{ id: "a", name: "Store A" }];
  state.attendanceOutletBranches = branches;
  state.attendanceOutletDb = { branch: { findMany: async (q: { where: { businessId?: string; status?: string; id?: string | { in: string[] } } }) => branches.filter(b => !q.where.id || (typeof q.where.id === "string" ? b.id === q.where.id : q.where.id.in.includes(b.id))) },
    employeeBusinessMembership: { findMany: async () => [] }, attendanceP2Exception: { findMany: async () => [] } };
  const pages = await attendanceOutletPages();
  try {
    let html = renderToStaticMarkup(await pages.P2({ searchParams: Promise.resolve({}) }));
    assert.doesNotMatch(html, /<select[^>]*name="branchId"/);
    assert.match(html, /name="branchId"[^>]*value="a"/);
    assert.match(html, /name="attendanceOutletMode"[^>]*value="single_outlet"/);
    branches.push({ id: "b", name: "Store B" });
    html = renderToStaticMarkup(await pages.P2({ searchParams: Promise.resolve({}) }));
    assert.match(html, /<select[^>]*name="branchId"/);
    assert.match(html, /value="b"/);
    branches = []; state.attendanceOutletBranches = branches;
    html = renderToStaticMarkup(await pages.P2({ searchParams: Promise.resolve({}) }));
    assert.match(html, /Set up an active clock-in location/);
    assert.doesNotMatch(html, /<form/);
  } finally { delete state.attendanceOutletActor; delete state.attendanceOutletBranches; delete state.attendanceOutletDb; }
});
