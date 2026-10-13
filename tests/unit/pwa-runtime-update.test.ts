import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const sha = "a".repeat(40);
type WorkerEvent = { waitUntil: (promise: Promise<unknown>) => void; data?: { type: string }; request: Request; respondWith: (promise: Promise<Response>) => void };
function worker(version = sha) {
  const events: Record<string, (event: WorkerEvent) => void> = {};
  const names = new Set(["tetamu-pos-static-v3", "tetamu-pos-static-" + "b".repeat(40), "other-app-cache"]);
  const stored: string[] = [];
  let skipped = 0, claimed = 0;
  const self = { location: { origin: "https://pos.test", href: "https://pos.test/sw.js?v=" + version }, clients: { claim: async () => { claimed++; } }, skipWaiting: async () => { skipped++; }, addEventListener: (name: string, fn: (event: WorkerEvent) => void) => { events[name] = fn; } };
  const caches = { keys: async () => [...names], delete: async (key: string) => names.delete(key), open: async (key: string) => { names.add(key); return { addAll: async () => {}, match: async () => undefined, put: async (req: Request) => { stored.push(req.url); } }; }, match: async () => new Response("wrong release cache") };
  vm.runInNewContext(readFileSync("public/sw.js", "utf8"), { self, caches, URL, Request, fetch: async () => new Response("icon"), Response });
  async function lifecycle(name: string, extra = {}) { let done: Promise<unknown> = Promise.resolve(); events[name]({ waitUntil: (p: Promise<unknown>) => { done = p; }, ...extra } as WorkerEvent); await done; }
  return { events, names, stored, lifecycle, skipped: () => skipped, claimed: () => claimed };
}

test("SW installs into the release SHA namespace without skipping waiting", async () => {
  const w = worker(); await w.lifecycle("install");
  assert.ok(w.names.has("tetamu-pos-static-" + sha));
  assert.equal(w.skipped(), 0);
});
test("activate removes only old Tetamu caches and retains unrelated caches", async () => {
  const w = worker(); await w.lifecycle("install"); await w.lifecycle("activate");
  assert.deepEqual([...w.names].sort(), ["other-app-cache", "tetamu-pos-static-" + sha].sort());
  assert.equal(w.claimed(), 1);
});
test("SW only skips waiting after the explicit activation message", async () => {
  const w = worker(); await w.lifecycle("install");
  assert.equal(w.skipped(), 0);
  await w.lifecycle("message", { data: { type: "SKIP_WAITING" } });
  assert.equal(w.skipped(), 1);
});
test("navigation, RSC, chunks, CSS, API, auth and writes bypass SW cache", async () => {
  const w = worker();
  for (const [path, init] of [["/products", {}], ["/products?_rsc=abc", { headers: { RSC: "1" } }], ["/_next/static/chunks/a.js", {}], ["/_next/static/a.css", {}], ["/api/session", {}], ["/login", {}], ["/pwa/icon-192.png", { method: "POST" }], ["/pwa/private-data", {}]] as const) {
    let handled = false;
    w.events.fetch({ request: new Request("https://pos.test" + path, init), respondWith: () => { handled = true; }, waitUntil: () => {} });
    assert.equal(handled, false, path);
  }
});
test("allowed icons are read and stored only in this release cache", async () => {
  const w = worker(); let result: Promise<Response> | undefined;
  let pending: Promise<unknown> = Promise.resolve();
  w.events.fetch({ request: new Request("https://pos.test/pwa/icon-192.png"), respondWith: (p: Promise<Response>) => { result = p; }, waitUntil: (p: Promise<unknown>) => { pending = p; } });
  assert.equal(await (await result)?.text(), "icon"); await pending;
  assert.deepEqual(w.stored, ["https://pos.test/pwa/icon-192.png"]);
});
