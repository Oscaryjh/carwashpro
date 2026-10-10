import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { attendanceOutletPages } from "../helpers/attendance-outlet-pages";

test("Attendance settings single display is current-only, legacy preserves branch cards and zero guides setup", async () => {
  const state = globalThis as typeof globalThis & Record<string, unknown>;
  state.attendanceOutletActor = { businessId: "business-a", user: { role: "BUSINESS_OWNER" }, access: {
    granted: true, businessId: "business-a", identityRole: "BUSINESS_OWNER", effectiveBusinessRole: "BUSINESS_OWNER", permissions: [], source: "DIRECT_BUSINESS",
  } };
  let branches = [{ id: "a", name: "Store A", attendanceSetting: null }];
  state.attendanceOutletDb = {
    business: { findUnique: async () => ({ name: "Synthetic Salon" }) },
    branch: { findMany: async (q: { where: { businessId?: string; status?: string; id?: string | { in: string[] } } }) => branches.filter(b => !q.where.id || (typeof q.where.id === "string" ? b.id === q.where.id : q.where.id.in.includes(b.id))) },
  };
  const pages = await attendanceOutletPages();
  try {
    let html = renderToStaticMarkup(await pages.Settings());
    assert.doesNotMatch(html, />BRANCH</);
    assert.match(html, /Attendance rules/);
    assert.match(html, /Managed in Business details/);
    branches.push({ id: "b", name: "Store B", attendanceSetting: null });
    html = renderToStaticMarkup(await pages.Settings());
    assert.match(html, />BRANCH</);
    assert.match(html, /Store A/); assert.match(html, /Store B/);
    branches = [];
    html = renderToStaticMarkup(await pages.Settings());
    assert.match(html, /Set up a clock-in location/);
    assert.doesNotMatch(html, /GPS &amp; Attendance/);
  } finally { delete state.attendanceOutletActor; delete state.attendanceOutletDb; }
});
