import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { createElement, cloneElement, act, type ReactElement } from "react";
import type { AppShellFrame } from "../../src/components/app-shell-frame";
import { renderToStaticMarkup } from "react-dom/server";
import { appShellNavigationHarness } from "../helpers/app-shell-navigation-harness";
import { createRoot } from "react-dom/client";
import type { PwaRegister } from "../../src/components/pwa-register";
import { GET } from "../../src/app/api/app-version/route";

const require = createRequire(import.meta.url);
const { JSDOM } = require("jsdom");
test("production update prompt preserves focus, submits explicit refresh and displays the build SHA in settings", async () => {
  const sha = "a".repeat(40);
  const bundle = await build({ entryPoints: ["src/components/pwa-register.tsx"], bundle: true, write: false, platform: "node", format: "cjs", packages: "external", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"', "process.env.APP_BUILD_SHA": JSON.stringify(sha) }, plugins: [{ name: "pwa-ui-io", setup(b) {
    b.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: "navigation", namespace: "pwa-ui" }));
    b.onLoad({ filter: /.*/, namespace: "pwa-ui" }, () => ({ contents: "export const usePathname=()=>globalThis.__pwaTestPathname;" }));
    b.onLoad({ filter: /\.css$/ }, () => ({ contents: "export default {layoutActive:'pwa-layout-active',banner:'pwa-banner'};", loader: "js" }));
  } }] });
  const compiled = { exports: {} as { PwaRegister: typeof PwaRegister } };
  new Function("require", "module", "exports", bundle.outputFiles[0].text)(require, compiled, compiled.exports);
  const dom = new JSDOM("<input id='draft'><div id='root'></div>", { url: "https://pos.test/business/settings" });
  const saved = Object.getOwnPropertyDescriptors(globalThis);
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, navigator: dom.window.navigator, IS_REACT_ACT_ENVIRONMENT: true, __pwaTestPathname: '/business/settings' })) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const messages: unknown[] = [];
  let measuredHeight = 72;
  let resize: (() => void) | undefined;
  let disconnected = false;
  dom.window.HTMLElement.prototype.getBoundingClientRect = function () {
    return { height: measuredHeight } as DOMRect;
  };
  dom.window.ResizeObserver = class {
    constructor(callback: () => void) { resize = callback; }
    observe() {}
    disconnect() { disconnected = true; }
  };
  const reg = Object.assign(new EventTarget(), { waiting: { scriptURL: "https://pos.test/sw.js?v=" + "b".repeat(40), postMessage: (value: unknown) => messages.push(value) }, update: async () => {}, installing: null });
  Object.defineProperty(dom.window.navigator, "serviceWorker", { value: Object.assign(new EventTarget(), { controller: {}, getRegistration: async () => reg, register: async () => reg }) });
  dom.window.fetch = async () => new Response(JSON.stringify({ version: "b".repeat(40) }));
  const root = createRoot(dom.window.document.getElementById("root")!);
  try {
    const input = dom.window.document.getElementById("draft")!; input.focus();
    await act(async () => { root.render(createElement(compiled.exports.PwaRegister)); await new Promise(resolve => setImmediate(resolve)); });
    assert.match(dom.window.document.body.textContent!, /Version aaaaaaa/);
    assert.equal(dom.window.document.activeElement, input);
    const html = dom.window.document.documentElement;
    assert.equal(html.style.getPropertyValue("--pwa-banner-height"), "72px");
    assert.equal(html.classList.contains("pwa-layout-active"), true);
    measuredHeight = 96;
    await act(async () => { resize?.(); });
    assert.equal(html.style.getPropertyValue("--pwa-banner-height"), "96px");
    const later = [...dom.window.document.querySelectorAll("button")].find(b => b.textContent === "Later");
    assert.ok(later);
    await act(async () => { later.click(); });
    assert.equal(dom.window.document.querySelector('[aria-label="App update"]'), null);
    assert.equal(html.style.getPropertyValue("--pwa-banner-height"), "0px");
    assert.equal(html.classList.contains("pwa-layout-active"), false);
    assert.deepEqual(messages, []);
    assert.ok(reg.waiting);
    assert.equal(dom.window.localStorage.length, 0);
    assert.equal(dom.window.sessionStorage.length, 0);
    assert.equal(disconnected, true);
    for (const path of ['/products', '/business/settings']) {
      Reflect.set(globalThis, '__pwaTestPathname', path);
      await act(async () => root.render(createElement(compiled.exports.PwaRegister)));
      assert.ok(dom.window.document.querySelector('[aria-label="App update"]'), 'Later must not persist across route visits');
    }
    await act(async () => { reg.dispatchEvent(new Event("updatefound")); });
    assert.ok(dom.window.document.querySelector('[aria-label="App update"]'));
    assert.equal(html.style.getPropertyValue("--pwa-banner-height"), "96px");
    const button = dom.window.document.querySelector("button")!;
    assert.equal(button.textContent, "Refresh now");
    assert.equal(dom.window.document.querySelector('[role="status"]')?.getAttribute("aria-live"), "polite");
    await act(async () => { button.click(); });
    assert.deepEqual(messages, [{ type: "SKIP_WAITING" }]);
    assert.equal(button.disabled, true); assert.equal(button.textContent, "Refreshing…");
    assert.equal(html.classList.contains("pwa-layout-active"), true);
    await act(async () => root.unmount());
    assert.equal(html.style.getPropertyValue("--pwa-banner-height"), "0px");
    assert.equal(html.classList.contains("pwa-layout-active"), false);
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
    for (const key of ["window", "document", "navigator", "IS_REACT_ACT_ENVIRONMENT", "__pwaTestPathname"]) { if (saved[key]) Object.defineProperty(globalThis, key, saved[key]); else Reflect.deleteProperty(globalThis, key); }
  }
});
test("public version metadata exposes only version and never stores the response", async () => {
  const response = GET();
  assert.deepEqual(Object.keys(await response.json()), ["version"]);
  assert.match(response.headers.get("Cache-Control")!, /no-store/);
});

test("PWA layout boundary distinguishes vertical Business shell from legacy narrow-screen flow", async () => {
  const harness = await appShellNavigationHarness();
  try {
    const frame = await harness.api.AppShell({
      user: { role: 'PLATFORM_ADMIN', userId: 'admin', businessId: null, homeBusinessId: null, activeBusinessId: null, contextVersion: 1, permissions: [], name: 'Synthetic', email: 'synthetic@example.test', status: 'active' },
      children: null,
    });
    for (const [businessNavigation, expected] of [[true, 'business'], [false, 'legacy']] as const) {
      const dom = new JSDOM(renderToStaticMarkup(cloneElement(frame as ReactElement<Parameters<typeof AppShellFrame>[0]>, { businessNavigation })));
      assert.equal(dom.window.document.querySelector('.app-shell')?.getAttribute('data-pwa-layout'), expected);
      dom.window.close();
    }
  } finally { harness.close(); }
});
