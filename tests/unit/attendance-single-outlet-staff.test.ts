import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { act, createElement } from "react";

test("Staff Today retains actor-location choice and disables switch during original open session", async () => {
  const require = createRequire(import.meta.url);
  const { JSDOM } = require("jsdom");
  const dom = new JSDOM('<div id="root"></div>', { url: "http://localhost/staff/home" });
  const saved = new Map<string, PropertyDescriptor | undefined>();
  let today: Record<string, unknown> = {
    employee: { fullName: "Synthetic employee", employeeCode: "E1" }, business: { id: "biz", name: "Synthetic" },
    branch: { id: "a", name: "A" }, availableBranches: [{ id: "a", name: "A" }], attendanceEnabled: true,
    sessionCount: 0, completedSessionCount: 0, currentSession: null, status: null,
    clockInAt: null, breakStartedAt: null, lastBreakEndedAt: null, totalCompletedBreakMinutes: 0, currentWorkedMinutes: 0,
    geofenceRequirements: { requireGeofence: true, geofenceRadiusMeters: 100, maximumAcceptedGpsErrorMeters: 80, allowOutsideGeofenceRequest: true, timezone: "Asia/Kuala_Lumpur" },
    workPolicy: { breakPolicy: "MANUAL_PUNCH", expectedBreakMinutes: 60, expectedBreakSource: "BRANCH_POLICY", normalWorkMinutesPerDay: 480, normalWorkMinutesSource: "BRANCH_POLICY" },
    expectedAttendance: null, allowedActions: ["CLOCK_IN"], pendingExceptions: [], serverTime: "2026-10-10T02:00:00Z", branchLocalTime: "2026-10-10T10:00:00",
  };
  const requests: Array<{ url: string; method: string }> = [];
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true,
    fetch: async (url: string, init: RequestInit = {}) => { requests.push({ url, method: init.method ?? "GET" }); return new Response(JSON.stringify({ ok: true, data: today }), { status: 200 }); } })) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  const result = await build({ entryPoints: ["src/components/staff-pwa/staff-today.tsx"], bundle: true, write: false, packages: "external", platform: "node", format: "cjs", jsx: "automatic", logLevel: "silent", plugins: [{ name: "browser-boundary", setup(b) {
    b.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: "navigation", namespace: "boundary" }));
    b.onLoad({ filter: /.*/, namespace: "boundary" }, () => ({ contents: "const router={replace(){},push(){},refresh(){}};export const useRouter=()=>router;" }));
    b.onLoad({ filter: /\.css$/ }, () => ({ contents: 'export default new Proxy({}, {get:(_,k)=>k})', loader: "js" }));
  } }] });
  const compiled = { exports: {} as { StaffToday: typeof import("../../src/components/staff-pwa/staff-today").StaffToday } };
  new Function("require", "module", "exports", result.outputFiles[0].text)(require, compiled, compiled.exports);
  const { createRoot } = await import("react-dom/client");
  const root = createRoot(dom.window.document.getElementById("root"));
  try {
    async function render(key: string) { await act(async () => { root.render(createElement(compiled.exports.StaffToday, { key })); }); }
    await render("one");
    assert.equal(dom.window.document.querySelector("select"), null);
    today = { ...today, availableBranches: [{ id: "a", name: "A" }, { id: "b", name: "B" }] };
    await render("multi");
    assert.equal(dom.window.document.querySelector("select")?.disabled, false);
    today = { ...today, status: "OPEN", branch: { id: "b", name: "Original open record B" }, allowedActions: ["BREAK_START", "CLOCK_OUT"], currentSession: { id: "session-b", status: "OPEN", clockInAt: "2026-10-10T01:00:00Z", requiresApproval: false } };
    await render("open");
    assert.equal(dom.window.document.querySelector("select")?.disabled, true);
    assert.equal(dom.window.document.querySelector("select")?.value, "b");
    assert.match(dom.window.document.body.textContent, /Complete the active shift before switching branch/);
    assert.equal(requests.filter(r => r.method !== "GET").length, 0);
  } finally {
    await act(async () => root.unmount()); dom.window.close();
    for (const [key, descriptor] of saved) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  }
});
