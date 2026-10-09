import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { createRequire } from "node:module";

type TestWindow = Window & { close(): void; eval(code: string): void; advance(ms: number): void; timerReady(): boolean; loginCalls: number; refreshCalls: string[]; refreshFailure: boolean };
const { JSDOM } = createRequire(import.meta.url)("jsdom") as { JSDOM: new (html: string, options: object) => { window: TestWindow } };
async function mount(failRefresh = false, restore = true) {
  const bundle = await build({ stdin: { contents: `import React from 'react';import{createRoot}from'react-dom/client';import{flushSync}from'react-dom';import{LoginForm}from'./src/app/login/login-form';flushSync(()=>createRoot(document.getElementById('root')).render(<LoginForm/>));`, resolveDir: process.cwd(), loader: "tsx" }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", plugins: [{ name: "login-server-boundary", setup(b) {
    b.onResolve({ filter: /\/(actions|cooldown-actions)$|^\.\/(actions|cooldown-actions)$/ }, () => ({ path: "actions", namespace: "stub" }));
    b.onLoad({ filter: /.*/, namespace: "stub" }, () => ({ contents: `export async function loginAction(){window.loginCalls++;return {error:'Too many sign-in attempts.',cooldown:{serverNow:1000000,retryAt:1061000},cooldownEmail:'owner@example.test'}};export async function getLoginCooldown(email){window.refreshCalls.push(email);if(window.refreshFailure)throw Error('offline');return{serverNow:1000000,retryAt:1061000}};`, loader: "js" }));
  } }] });
  const dom = new JSDOM('<div id="root"></div>', { runScripts: "dangerously", url: "http://localhost/login" });
  const w = dom.window;
  w.loginCalls = 0; w.refreshCalls = []; w.refreshFailure = failRefresh;
  if (restore) w.sessionStorage.setItem("tetamu-login-cooldown-email", "owner@example.test");
  w.eval(`let elapsed=0;const ticks=new Map();let timer=0;performance.now=()=>elapsed;window.setInterval=(fn)=>{ticks.set(++timer,fn);return timer};window.clearInterval=id=>ticks.delete(id);window.timerReady=()=>ticks.size>0;window.advance=ms=>{elapsed+=ms;for(const fn of ticks.values())fn()};`);
  w.eval(bundle.outputFiles[0].text);
  return { dom, w, doc: w.document };
}
async function until(check: () => boolean) {
  for (let i = 0; i < 100 && !check(); i++) await new Promise(resolve => setTimeout(resolve, 5));
  assert.ok(check(), "UI update completes");
}
test("refresh obtains server cooldown, counts down, then enables manual sign-in without submitting", async () => {
  const { w, doc } = await mount();
  try {
    await until(() => (doc.body.textContent ?? "").includes("01:01"));
    assert.deepEqual([...w.refreshCalls], ["owner@example.test"]);
    const button = doc.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    assert.equal(button.disabled, true);
    await until(() => w.timerReady());
    w.advance(1000); await until(() => (doc.body.textContent ?? "").includes("01:00"));
    w.advance(60000); await until(() => !button.disabled);
    assert.match(doc.body.textContent ?? "", /You can try signing in again/);
    assert.equal(w.loginCalls, 0);
    assert.equal(w.sessionStorage.getItem("tetamu-login-cooldown-email"), null);
    assert.equal(doc.querySelector<HTMLInputElement>('input[name="password"]')!.value, "");
  } finally { w.close(); }
});
test("failed cooldown refresh shows a safe message, never fabricates a fresh 15-minute wait", async () => {
  const { w, doc } = await mount(true);
  try {
    await until(() => (doc.body.textContent ?? "").includes("Could not check"));
    assert.doesNotMatch(doc.body.textContent ?? "", /15:00|offline/);
    assert.equal(w.loginCalls, 0);
  } finally { w.close(); }
});

test("rate-limited login response immediately disables repeat submits and stores no password", async () => {
  const { w, doc } = await mount(false, false);
  try {
    const button = doc.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    await until(() => !button.disabled);
    doc.querySelector<HTMLInputElement>('input[name="email"]')!.value = "owner@example.test";
    doc.querySelector<HTMLInputElement>('input[name="password"]')!.value = "not-a-real-password";
    doc.querySelector("form")!.requestSubmit();
    await until(() => (doc.body.textContent ?? "").includes("01:01"));
    assert.equal(button.disabled, true);
    doc.querySelector("form")!.requestSubmit();
    assert.equal(w.loginCalls, 1);
    assert.equal(w.sessionStorage.length, 1);
    assert.equal(w.sessionStorage.getItem("tetamu-login-cooldown-email"), "owner@example.test");
  } finally { w.close(); }
});
