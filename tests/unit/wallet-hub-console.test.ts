import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { walletHubHarness, fixture } from "../helpers/wallet-hub-ui-harness";

type TestWindow = Window & { close(): void; Event: typeof Event; MouseEvent: typeof MouseEvent; KeyboardEvent: typeof KeyboardEvent };
const { JSDOM } = createRequire(import.meta.url)("jsdom") as { JSDOM: new (html: string, options: object) => { window: TestWindow } };
async function mount(view: string, restricted = false) {
  const h = await walletHubHarness();
  h.state.invoiceAllowed = !restricted; h.state.customerAllowed = !restricted;
  const props = (await h.api.Page({ searchParams: Promise.resolve({ view }) })).props;
  h.close();
  const before = JSON.stringify(props);
  const built = await build({ stdin: { contents: `import React from 'react';import{createRoot}from'react-dom/client';import{flushSync}from'react-dom';import{WalletHub}from'./src/components/wallet/wallet-hub';HTMLDialogElement.prototype.showModal=function(){this.open=true};HTMLDialogElement.prototype.close=function(){this.open=false};flushSync(()=>createRoot(document.getElementById('root')).render(<WalletHub {...window.props}/>));`, resolveDir: process.cwd(), loader: "tsx" }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", plugins: [{ name: "ui-boundaries", setup(b) {
    b.onResolve({ filter: /^next\/link$/ }, () => ({ path: "link", namespace: "stub" }));
    b.onLoad({ filter: /.*/, namespace: "stub" }, () => ({ contents: "import React from 'react';export default({children,...props})=><a {...props}>{children}</a>", loader: "jsx", resolveDir: process.cwd() }));
    b.onLoad({ filter: /\.css$/ }, () => ({ contents: "export default new Proxy({}, {get:(_,key)=>key});", loader: "js" }));
  } }] });
  const dom = new JSDOM(`<div id="root"></div><script>${built.outputFiles[0].text}</script>`, { runScripts: "dangerously", url: "http://local-ui.test/wallet", beforeParse(w: { props: typeof props }) { w.props = props; } });
  return { dom, doc: dom.window.document, props, before };
}
async function until(check: () => boolean) {
  for (let i = 0; i < 100 && !check(); i++) await new Promise(resolve => setTimeout(resolve, 5));
  assert.ok(check(), "UI update should complete");
}
test("header Settings reveals the original Offers link and closes on Escape, outside press and focus leave", async () => {
  const { dom, doc, props, before } = await mount("top-ups");
  try {
    const menu = doc.querySelector<HTMLDetailsElement>('header details'); assert.ok(menu);
    const trigger = menu.querySelector('summary'); assert.ok(trigger);
    assert.equal(menu.open, false);
    trigger.click(); assert.equal(menu.open, true);
    const links = menu.querySelectorAll('a'); assert.equal(links.length, 1);
    assert.equal(links[0].textContent, 'Manage Top-up');
    assert.equal(links[0].getAttribute('href'), '/crm/wallet/offers');
    assert.equal(doc.querySelector('section.panel a[href="/crm/wallet/offers"]'), null);
    links[0].focus();
    links[0].dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert.equal(menu.open, false); assert.ok(doc.activeElement === trigger);
    trigger.click(); assert.equal(menu.open, true);
    doc.body.dispatchEvent(new dom.window.MouseEvent('pointerdown', { bubbles: true }));
    assert.equal(menu.open, false);
    trigger.focus(); trigger.click(); links[0].focus();
    doc.querySelector<HTMLAnchorElement>('nav a')!.focus();
    assert.equal(menu.open, false);
    assert.equal(JSON.stringify(props), before);
  } finally { dom.window.close(); }
});
for (const view of ["transactions", "top-ups"]) test(`${view}: View opens an out-of-table readonly drawer and Close restores focus without changing DTO`, async () => {
  const { dom, doc, props, before } = await mount(view);
  try {
    assert.equal(doc.querySelectorAll("tbody details").length, 0);
    const button = doc.querySelector<HTMLButtonElement>('tbody button[aria-haspopup="dialog"]'); assert.ok(button);
    const tableBefore = doc.querySelector("tbody")!.textContent;
    button.focus(); button.click(); await until(() => !!doc.querySelector("dialog[open]"));
    const drawer = doc.querySelector("dialog")!;
    assert.equal(drawer.closest("table"), null);
    for (const text of ["Alice", "RM100.00", "RM10.00", "Cash", "Owner", "Local branch", "TOP-1"]) assert.ok(drawer.textContent?.includes(text), text);
    assert.ok(drawer.querySelector('a[href^="/crm/customers/"]'));
    if (view === "transactions") { assert.ok(drawer.textContent?.includes("RM210.00")); assert.ok(drawer.querySelector('a[href="/invoices/invoice1"]')); }
    else assert.ok(drawer.textContent?.includes("Posted"));
    assert.equal(doc.querySelector("tbody")!.textContent, tableBefore);
    assert.equal(drawer.querySelectorAll("form,input,select").length, 0);
    drawer.querySelector<HTMLButtonElement>('button[aria-label="Close wallet details"]')!.click();
    await until(() => !doc.querySelector("dialog")); assert.ok(doc.activeElement === button, "focus returns to the row action");
    button.click(); await until(() => !!doc.querySelector("dialog[open]"));
    doc.querySelector("dialog")!.dispatchEvent(new dom.window.Event("cancel", { cancelable: true }));
    await until(() => !doc.querySelector("dialog"));
    assert.equal(JSON.stringify(props), before);
  } finally { dom.window.close(); }
});
test("drawer omits unauthorized drilldowns and missing context rather than fabricating placeholders", async () => {
  const row = fixture.transactions.rows[0];
  const saved = { ...row };
  Object.assign(row, { paymentMethod: null, reference: null, branchName: null, staffName: null });
  try {
    const { dom, doc } = await mount("transactions", true);
    try {
      const button = doc.querySelector<HTMLButtonElement>('tbody button[aria-haspopup="dialog"]'); assert.ok(button); button.click();
      await until(() => !!doc.querySelector("dialog[open]"));
      const drawer = doc.querySelector("dialog")!;
      assert.equal(drawer.querySelectorAll("a").length, 0);
      assert.doesNotMatch(drawer.textContent ?? "", /Payment method|Reference|Staff|Branch|—/);
    } finally { dom.window.close(); }
  } finally { Object.assign(row, saved); }
});
test("balances prioritize total; pagination exposes only real cursor navigation", async () => {
  const { dom, doc } = await mount("balances");
  try {
    assert.equal(doc.querySelectorAll("th")[1].textContent, "Total Wallet Balance");
    assert.equal(doc.querySelector("tbody tr td:nth-child(2) strong")?.textContent, "RM100.00");
    const compact = doc.querySelector("tbody .compactBalanceFacts");
    assert.ok(compact, "narrow balance view keeps Paid/Bonus and last activity available without CRM permission");
    for (const value of ["Paid RM80.00", "Bonus RM20.00", "2 Oct 2026"]) assert.ok(compact.textContent?.includes(value), value);
    const footer = doc.querySelector('nav[aria-label="Wallet pages"]')!;
    assert.match(footer.textContent ?? "", /Previous/); assert.match(footer.textContent ?? "", /Next/); assert.match(footer.textContent ?? "", /20 per page/);
    assert.doesNotMatch(footer.textContent ?? "", /Page \d|\d+ of \d+/);
    assert.ok(footer.querySelector('a[href*="cursor=next-cursor"]'));
  } finally { dom.window.close(); }
});
