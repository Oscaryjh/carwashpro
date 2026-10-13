import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { startPwaUpdates, isChunkFailure, type UpdateState } from "../../src/lib/pwa/update-client";

const { JSDOM } = createRequire(import.meta.url)("jsdom");
const a = "a".repeat(40), b = "b".repeat(40);
const settle = () => new Promise(resolve => setImmediate(resolve));
function fixture(serverVersion = b, fetchOverride?: typeof fetch) {
  const dom = new JSDOM("<input aria-label='Unfinished product name'>", { url: "https://pos.test/products?modal=create" });
  const win = dom.window as Window;
  const states: UpdateState[] = [], registrations: string[] = [], messages: unknown[] = [];
  let reloads = 0, updates = 0;
  let timerId = 0;
  const timers = new Map<number, () => void>();
  win.setTimeout = ((callback: () => void) => { timers.set(++timerId, callback); return timerId; }) as typeof win.setTimeout;
  win.clearTimeout = (id?: number) => { if (id) timers.delete(id); };
  const workers = new EventTarget();
  const waiting = { postMessage: (data: unknown) => messages.push(data), scriptURL: "https://pos.test/sw.js?v=" + b };
  const registration = Object.assign(new EventTarget(), { waiting, installing: null, active: { scriptURL: "https://pos.test/sw.js?v=" + a }, update: async () => { updates++; } });
  Object.assign(workers, { controller: registration.active, getRegistration: async () => registration, register: async (url: string) => { registrations.push(url); return registration; } });
  Object.defineProperty(win.navigator, "serviceWorker", { value: workers });
  Object.assign(win, { fetch: fetchOverride ?? (async () => new Response(JSON.stringify({ version: serverVersion }))) });
  const runtime = startPwaUpdates(win, a, state => states.push(state), () => { reloads++; });
  return { win, dom, states, registrations, messages, registration, workers, runtime, fireTimeouts: () => { for (const fn of [...timers.values()]) fn(); }, reloads: () => reloads, updates: () => updates, close: () => { runtime.stop(); dom.window.close(); } };
}
test("new server SHA registers a versioned worker and prompts without reloading or stealing focus", async () => {
  const f = fixture(); try {
    const input = f.win.document.querySelector("input")!; input.focus(); await settle();
    assert.deepEqual(f.registrations, ["/sw.js?v=" + b]);
    assert.equal(f.states.at(-1), "updateAvailable");
    assert.equal(f.reloads(), 0); assert.equal(f.win.document.activeElement, input);
  } finally { f.close(); }
});
test("only user confirmation sends SKIP_WAITING; controllerchange reloads once", async () => {
  const f = fixture(); try {
    await settle(); f.workers.dispatchEvent(new Event("controllerchange"));
    assert.equal(f.reloads(), 0); assert.deepEqual(f.messages, []);
    f.runtime.refresh(); assert.deepEqual(f.messages, [{ type: "SKIP_WAITING" }]);
    f.workers.dispatchEvent(new Event("controllerchange")); f.workers.dispatchEvent(new Event("controllerchange"));
    assert.equal(f.reloads(), 1);
    assert.equal(f.win.sessionStorage.getItem("tetamu-pwa-reloaded-" + b), "1");
  } finally { f.close(); }
});
test("a repeated activation with session guard prompts recovery instead of looping", async () => {
  const f = fixture(); try {
    await settle(); f.win.sessionStorage.setItem("tetamu-pwa-reloaded-" + b, "1");
    f.runtime.refresh(); f.workers.dispatchEvent(new Event("controllerchange"));
    assert.equal(f.reloads(), 0); assert.equal(f.states.at(-1), "recoveryRequired");
    f.runtime.refresh(); assert.equal(f.reloads(), 1); // A further explicit user click, not an automatic retry.
  } finally { f.close(); }
});
test("narrow chunk failures prompt safe one-shot recovery; generic errors do nothing", async () => {
  const f = fixture(a); try {
    await settle(); const initial = f.states.length;
    f.win.dispatchEvent(new f.dom.window.ErrorEvent("error", { error: new Error("Cannot read properties of undefined") }));
    assert.equal(f.states.length, initial);
    f.win.dispatchEvent(new f.dom.window.ErrorEvent("error", { error: new Error("Loading chunk 123 failed.") }));
    assert.equal(f.states.at(-1), "recoveryRequired"); assert.equal(f.reloads(), 0);
    f.runtime.refresh(); assert.equal(f.win.sessionStorage.getItem("tetamu-runtime-recovery-attempted"), "1");
    f.workers.dispatchEvent(new Event("controllerchange")); assert.equal(f.reloads(), 1);
  } finally { f.close(); }
});
test("chunk signatures exclude renderer crashes and generic application failures", () => {
  for (const value of ["ChunkLoadError", "Loading chunk 42 failed", "Failed to fetch dynamically imported module: /_next/static/x.js", "Importing a module script failed.", "error loading dynamically imported module"]) assert.equal(isChunkFailure(new Error(value)), true, value);
  for (const value of ["STATUS_BREAKPOINT", "Invalid credentials", "Payment failed", "fetch failed", "TypeError"]) assert.equal(isChunkFailure(new Error(value)), false, value);
});
test("bad version responses never register a worker with untrusted version data", async () => {
  const f = fixture("../../private"); try { await settle(); assert.deepEqual(f.registrations, []); assert.equal(f.reloads(), 0); } finally { f.close(); }
});
test("stop removes listeners; focus events after teardown do not check updates", async () => {
  const f = fixture(); await settle(); f.runtime.stop(); const count = f.updates();
  f.win.dispatchEvent(new f.dom.window.Event("focus")); await settle();
  assert.equal(f.updates(), count); f.close();
});
test("an already waiting worker remains actionable when version metadata is offline", async () => {
  const f = fixture(b, async () => { throw Error("offline"); });
  try { await settle(); assert.equal(f.states.at(-1), "updateAvailable"); f.runtime.refresh(); assert.deepEqual(f.messages, [{ type: "SKIP_WAITING" }]); }
  finally { f.close(); }
});
test("a hanging metadata check times out so a later foreground check can recover", async () => {
  let requests = 0;
  const f = fixture(b, async () => { requests++; return new Promise<Response>(() => {}); });
  const originalNow = Date.now;
  try {
    await settle(); assert.equal(requests, 1); f.fireTimeouts(); await settle();
    Date.now = () => originalNow() + 61_000;
    Object.defineProperty(f.win.document, "visibilityState", { value: "visible", configurable: true });
    f.win.dispatchEvent(new f.dom.window.Event("focus")); await settle();
    assert.equal(requests, 2); assert.equal(f.reloads(), 0);
  } finally { Date.now = originalNow; f.fireTimeouts(); await settle(); f.close(); }
});
