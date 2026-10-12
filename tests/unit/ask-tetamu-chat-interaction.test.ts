import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { act, createElement } from "react";
import type { AiBusinessChat } from "../../src/components/ai-business-chat";
const require = createRequire(import.meta.url);
const { JSDOM } = require("jsdom");

async function setup(extra: Record<string, unknown> = {}, respond?: () => Promise<Response>) {
  const bundle = await build({ entryPoints: ["src/components/ai-business-chat.tsx"], bundle: true, write: false, platform: "node", format: "cjs", packages: "external", jsx: "automatic", plugins: [{ name: "chat-test-io", setup(b) {
    b.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: "navigation", namespace: "chat-io" }));
    b.onLoad({ filter: /.*/, namespace: "chat-io" }, () => ({ contents: "export const useRouter=()=>({replace: url=>window.__navigation.push(url),refresh:()=>window.__navigation.push('refresh')});" }));
    b.onLoad({ filter: /\.css$/ }, () => ({ contents: "export default {};", loader: "js" }));
  } }] });
  const compiled = { exports: {} as { AiBusinessChat: typeof AiBusinessChat } };
  new Function("require", "module", "exports", bundle.outputFiles[0].text)(require, compiled, compiled.exports);
  const dom = new JSDOM("<div id='root'></div>", { url: "http://localhost/ai" });
  const saved = Object.getOwnPropertyDescriptors(globalThis);
  const keys = ["window", "document", "navigator", "IS_REACT_ACT_ENVIRONMENT", "fetch"];
  const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
  const navigation: string[] = [];
  Object.assign(dom.window, { __navigation: navigation });
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, navigator: dom.window.navigator, IS_REACT_ACT_ENVIRONMENT: true, fetch: async (url: string, init: RequestInit) => {
    requests.push({ url, body: JSON.parse(String(init.body)) });
    if (respond) return respond();
    return new Response(JSON.stringify({ conversationId: "saved-chat" }));
  } })) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const { createRoot } = await import("react-dom/client");
  const root = createRoot(dom.window.document.getElementById("root")!);
  await act(async () => root.render(createElement(compiled.exports.AiBusinessChat, { scopeType: "BUSINESS", range: "custom", from: "2026-10-01", to: "2026-10-12", presentation: "conversation", showSuggestions: true, ...extra })));
  return { dom, requests, navigation, async rerender(props: Record<string, unknown>) { await act(async () => root.render(createElement(compiled.exports.AiBusinessChat, { scopeType: "BUSINESS", range: "month", presentation: "conversation", ...props }))); }, async close() { await act(async () => root.unmount()); dom.window.close(); for (const key of keys) { if(saved[key]) Object.defineProperty(globalThis,key,saved[key]); else Reflect.deleteProperty(globalThis,key); } } };
}

test("suggestions populate and focus the composer without sending; explicit send preserves API payload", async () => {
  const ui = await setup();
  try {
    const suggestions = Array.from(ui.dom.window.document.querySelectorAll('[aria-label="Suggested questions"] button')) as HTMLButtonElement[];
    assert.equal(suggestions.length, 4);
    assert.equal(suggestions.some(b => /supplier|purchase/i.test(b.textContent!)), false);
    await act(async () => suggestions[0].click());
    const input = ui.dom.window.document.querySelector("textarea")!;
    assert.equal(input.value, "How are sales this month?");
    assert.equal(ui.dom.window.document.activeElement, input); assert.equal(ui.requests.length, 0);
    await act(async () => ui.dom.window.document.querySelector("form")!.dispatchEvent(new ui.dom.window.Event("submit", { bubbles: true, cancelable: true })));
    assert.equal(ui.requests.length, 1); assert.equal(ui.requests[0].url, "/api/ai/analyze");
    assert.equal(ui.requests[0].body.range, "custom"); assert.equal(ui.requests[0].body.from, "2026-10-01");
    assert.equal(ui.requests[0].body.to, "2026-10-12"); assert.equal(ui.requests[0].body.scopeType, "BUSINESS");
    assert.match(String(ui.requests[0].body.clientRequestId), /^[0-9a-f-]{36}$/);
    assert.equal(input.value, ""); assert.deepEqual(ui.navigation, ["/ai?conversationId=saved-chat&range=custom&from=2026-10-01&to=2026-10-12", "refresh"]);
  } finally { await ui.close(); }
});

test("pending disables duplicate sends; errors retain the draft and allow retry", async () => {
  let release!: (response: Response) => void;
  const ui = await setup({}, () => new Promise(resolve => { release = resolve; }));
  try {
    await act(async () => (ui.dom.window.document.querySelector('[aria-label="Suggested questions"] button') as HTMLButtonElement).click());
    const form = ui.dom.window.document.querySelector("form")!;
    await act(async () => form.dispatchEvent(new ui.dom.window.Event("submit", { bubbles: true, cancelable: true })));
    assert.equal(ui.dom.window.document.querySelector("textarea")!.disabled, true);
    assert.match(ui.dom.window.document.body.textContent!, /Thinking/);
    await act(async () => form.dispatchEvent(new ui.dom.window.Event("submit", { bubbles: true, cancelable: true })));
    assert.equal(ui.requests.length, 1);
    await act(async () => release(new Response(JSON.stringify({message:"Temporarily unavailable"}), {status:503})));
    assert.match(ui.dom.window.document.querySelector('[role="alert"]')!.textContent!, /Temporarily unavailable/);
    assert.equal(ui.dom.window.document.querySelector("textarea")!.value, "How are sales this month?");
    assert.equal(ui.dom.window.document.querySelector("textarea")!.disabled, false);
    assert.deepEqual(ui.navigation, []);
  } finally { await ui.close(); }
});

test("lost response retry retains exact key/payload and double submit cannot race React state", async () => {
  let attempts = 0;
  const ui = await setup({}, async () => { if (++attempts === 1) throw new TypeError("Failed to fetch"); return new Response(JSON.stringify({ conversationId: "replayed-chat" })); });
  try {
    await act(async () => (ui.dom.window.document.querySelector('[aria-label="Suggested questions"] button') as HTMLButtonElement).click());
    const form = ui.dom.window.document.querySelector("form")!;
    await act(async () => { for (let i = 0; i < 2; i++) form.dispatchEvent(new ui.dom.window.Event("submit", { bubbles: true, cancelable: true })); });
    assert.equal(ui.requests.length, 1);
    assert.match(ui.dom.window.document.querySelector('[role="alert"]')!.textContent!, /response.*received|connection/i);
    const retry = (Array.from(ui.dom.window.document.querySelectorAll("button")) as HTMLButtonElement[]).find(b => b.textContent === "Retry");
    assert.ok(retry);
    await act(async () => retry.click());
    assert.equal(ui.requests.length, 2); assert.deepEqual(ui.requests[1].body, ui.requests[0].body);
    assert.equal(ui.requests[1].body.conversationId, undefined);
    assert.match(ui.navigation[0], /replayed-chat/);
  } finally { await ui.close(); }
});

test("transport retry survives composer remount with original new-conversation payload", async () => {
  let attempts = 0;
  const ui = await setup({ requestStorageKey: "synthetic-owner-business" }, async () => { if (++attempts === 1) throw new TypeError("Failed to fetch"); return new Response(JSON.stringify({ conversationId: "recovered" })); });
  try {
    await act(async () => (ui.dom.window.document.querySelector('[aria-label="Suggested questions"] button') as HTMLButtonElement).click());
    await act(async () => ui.dom.window.document.querySelector("form")!.dispatchEvent(new ui.dom.window.Event("submit", { bubbles: true, cancelable: true })));
    await ui.rerender({ key: "remounted", requestStorageKey: "synthetic-owner-business", conversationId: "server-created-after-lost-response" });
    const retry = (Array.from(ui.dom.window.document.querySelectorAll("button")) as HTMLButtonElement[]).find(b => b.textContent === "Retry");
    assert.ok(retry); await act(async () => retry.click());
    assert.deepEqual(ui.requests[1].body, ui.requests[0].body);
    assert.equal(ui.dom.window.sessionStorage.getItem("synthetic-owner-business"), null);
    assert.match(ui.navigation[0], /range=custom&from=2026-10-01&to=2026-10-12/);
  } finally { await ui.close(); }
});

test("editing a failed question creates a new logical request identity", async () => {
  const ui = await setup({}, async () => { throw new TypeError("Failed to fetch"); });
  try {
    const suggestions = ui.dom.window.document.querySelectorAll('[aria-label="Suggested questions"] button');
    const form = ui.dom.window.document.querySelector("form")!;
    await act(async () => (suggestions[0] as HTMLButtonElement).click());
    await act(async () => form.dispatchEvent(new ui.dom.window.Event("submit", { bubbles: true, cancelable: true })));
    await act(async () => (suggestions[1] as HTMLButtonElement).click());
    await act(async () => form.dispatchEvent(new ui.dom.window.Event("submit", { bubbles: true, cancelable: true })));
    assert.notEqual(ui.requests[1].body.clientRequestId, ui.requests[0].body.clientRequestId);
    assert.notEqual(ui.requests[1].body.question, ui.requests[0].body.question);
  } finally { await ui.close(); }
});

test("monthly limit API response disables new questions and retains history", async () => {
  const ui = await setup({ history: createElement("p", null, "Existing safe answer") }, async () => new Response(JSON.stringify({ error: "AI_QUOTA_EXCEEDED", message: "Monthly AI limit reached. Resets on 1 Nov." }), { status: 429 }));
  try {
    // History suppresses suggestions; fill using the real native input setter.
    const input = ui.dom.window.document.querySelector("textarea")!;
    const setter = Object.getOwnPropertyDescriptor(ui.dom.window.HTMLTextAreaElement.prototype, "value")!.set!;
    await act(async () => { setter.call(input, "Sales"); input.dispatchEvent(new ui.dom.window.Event("input", { bubbles: true })); });
    await act(async () => ui.dom.window.document.querySelector("form")!.dispatchEvent(new ui.dom.window.Event("submit", { bubbles: true, cancelable: true })));
    assert.match(ui.dom.window.document.body.textContent!, /Monthly AI limit reached/);
    assert.match(ui.dom.window.document.body.textContent!, /Existing safe answer/);
    assert.equal(ui.dom.window.document.querySelector("textarea"), null);
  } finally { await ui.close(); }
});

test("Shift Enter does not send, Enter uses the normal guarded submit", async () => {
  const ui = await setup();
  try {
    await act(async () => (ui.dom.window.document.querySelector('[aria-label="Suggested questions"] button') as HTMLButtonElement).click());
    const input = ui.dom.window.document.querySelector("textarea")!;
    await act(async () => input.dispatchEvent(new ui.dom.window.KeyboardEvent("keydown", {key:"Enter",shiftKey:true,bubbles:true,cancelable:true})));
    assert.equal(ui.requests.length, 0);
    await act(async () => input.dispatchEvent(new ui.dom.window.KeyboardEvent("keydown", {key:"Enter",bubbles:true,cancelable:true})));
    assert.equal(ui.requests.length, 1);
  } finally { await ui.close(); }
});

test("conversation presentation hides active composer and suggestions when blocked", async () => {
  const ui = await setup({ quotaBlocked: true, disabledReason: "You can view previous conversations, but new questions are disabled." });
  try { assert.equal(ui.dom.window.document.querySelector("textarea"), null); assert.match(ui.dom.window.document.body.textContent!, /previous conversations/); assert.equal(ui.dom.window.document.querySelector('[aria-label="Suggested questions"]'), null); }
  finally { await ui.close(); }
});

test("legacy Group presentation retains its existing disabled composer", async () => {
  const ui = await setup({ presentation: undefined, scopeType: "GROUP", quotaBlocked: true });
  try { assert.equal(ui.dom.window.document.querySelector("textarea")!.disabled, true); }
  finally { await ui.close(); }
});

test("unconfigured empty chat presents one usage explanation rather than a second disabled composer notice", async () => {
  const reason = "AI usage allowance hasn't been configured for this business. Contact your Tetamu account administrator to configure AI usage.";
  const ui = await setup({ quotaBlocked: true, emptyStateNotice: true, emptyTitle: "Usage not configured", emptyDescription: reason, disabledTitle: "Usage not configured", disabledReason: reason });
  try {
    const doc = ui.dom.window.document;
    assert.equal(doc.querySelectorAll('[role="status"]').length, 1);
    assert.equal(doc.querySelector('[role="status"]')?.closest('[aria-label="Conversation messages"]') !== null, true);
    assert.equal(doc.body.textContent!.split(reason).length - 1, 1);
    assert.equal(doc.querySelector("textarea"), null);
    assert.equal(doc.querySelector('[aria-label="Suggested questions"]'), null);
    await ui.rerender({ quotaBlocked: true, emptyStateNotice: true, history: createElement("p", null, "Previous conversation remains readable"), disabledTitle: "Usage not configured", disabledReason: reason });
    assert.match(doc.body.textContent!, /Previous conversation remains readable/);
    assert.equal(doc.querySelectorAll('[role="status"]').length, 1);
    assert.match(doc.querySelector('[role="status"]')!.textContent!, /usage allowance/);
  } finally { await ui.close(); }
});

test("new messages scroll only the inner history, not the page", async () => {
  const ui = await setup({ history: createElement("p", null, "Existing answer"), messageCount: 1 });
  try {
    const history = ui.dom.window.document.querySelector('[aria-label="Conversation messages"]')!;
    Object.defineProperty(history, "scrollHeight", {value:900,configurable:true});
    await ui.rerender({history:createElement("p",null,"Latest answer"),messageCount:2});
    assert.equal(history.scrollTop,900);
    assert.equal(ui.dom.window.document.documentElement.scrollTop,0);
    assert.match(history.textContent!,/Latest answer/);
  } finally { await ui.close(); }
});
