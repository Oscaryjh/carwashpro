import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { mkdtemp, rm, access } from "node:fs/promises";
import { join } from "node:path";
import { crmUiBoundaries } from "../helpers/crm-ui-fixture";

let directory: string;
after(async () => { delete (globalThis as any).__crmHooks; delete (globalThis as any).__crmFixture; if (directory) await rm(directory, { recursive: true, force: true }); });
async function components() {
  assert.ok(await access("src/components/wallet/wallet-panel-context.tsx").then(() => true, () => false), "CRM needs a shared wallet read to render header and Overview from one result");
  directory ??= await mkdtemp(join(process.cwd(), "node_modules/.cache/crm-read-"));
  const file = join(directory, "ui.cjs");
  await build({ stdin: { contents: 'export * from "./src/components/wallet/wallet-panel-context";export * from "./src/components/wallet/member-wallet-summary";', resolveDir: process.cwd(), loader: "tsx" }, outfile: file, bundle: true, platform: "node", format: "cjs", packages: "external", jsx: "automatic", loader: { ".css": "empty" }, plugins: [crmUiBoundaries()] });
  return createRequire(import.meta.url)(file);
}
test("header and Overview render the same authorized read result and keep the original Owner actions", async () => {
  const { WalletPanelContext, CrmWalletMetric, MemberWalletSummary } = await components();
  const shared = { customerId: "a", enabled: true, panel: { totalBalance: "920.00", hasAccount: true, canTopUp: true, ownerDetails: { paidBalance: "900.00", bonusBalance: "20.00" }, intentScope: "business:owner" }, error: "", pending: false, refresh() {} };
  const html = renderToStaticMarkup(createElement(WalletPanelContext.Provider, { value: shared }, createElement(CrmWalletMetric), createElement(MemberWalletSummary, { customerId: "a", customerName: "Customer", enabled: true })));
  assert.equal(html.match(/RM 920\.00/g)?.length, 2);
  for (const text of ["Top up", "View transactions", "View details", "Paid credit", "Bonus credit"]) assert.ok(html.includes(text), text);
});

// Exercise the components' effects and event handlers at the authenticated-action boundary.
// The browser validation also runs these components with the real React DOM lifecycle.
function hookSession() {
  let index = 0;
  const state: any[] = [];
  const effects: { deps: unknown[]; cleanup?: () => void }[] = [];
  const jobs: (() => void)[] = [];
  return {
    shared: null as any,
    render<T>(render: () => T): T { index = 0; return render(); },
    useState(initial: unknown) { const slot = index++; if (!(slot in state)) state[slot] = initial; return [state[slot], (value: any) => { state[slot] = typeof value === "function" ? value(state[slot]) : value; }]; },
    useEffect(work: () => (() => void) | void, deps: unknown[]) { const slot = index++; if (!effects[slot] || deps.some((value, i) => value !== effects[slot].deps[i])) { effects[slot]?.cleanup?.(); effects[slot] = { deps }; jobs.push(() => { effects[slot].cleanup = work() || undefined; }); } },
    async flush() { jobs.splice(0).forEach(work => work()); await new Promise(resolve => setImmediate(resolve)); },
  };
}
async function interactive() {
  await components();
  const file = join(directory, "interactive.cjs");
  await build({ stdin: { contents: 'export * from "./src/components/wallet/wallet-panel-context";export * from "./src/components/wallet/member-wallet-summary";', resolveDir: process.cwd(), loader: "tsx" }, outfile: file, bundle: true, platform: "node", format: "cjs", packages: "external", jsx: "automatic", loader: { ".css": "empty" }, plugins: [crmUiBoundaries(), { name: "controlled-hooks", setup(builder) {
    builder.onResolve({ filter: /^react$/ }, args => args.namespace === "crm-hooks" ? { path: "react", external: true } : { path: "react", namespace: "crm-hooks" });
    builder.onLoad({ filter: /.*/, namespace: "crm-hooks" }, () => ({ contents: 'const React=require("react");export const createContext=React.createContext;export const useContext=()=>globalThis.__crmHooks.shared;export const useState=(v)=>globalThis.__crmHooks.useState(v);export const useEffect=(f,d)=>globalThis.__crmHooks.useEffect(f,d);export const useCallback=f=>f;export const useRef=v=>({current:v});export const useId=()=>"dialog";export const useTransition=()=>[false,f=>f()];', resolveDir: process.cwd() }));
  } }] });
  return createRequire(import.meta.url)(file);
}
function nodes(node: any): any[] { return !node || typeof node !== "object" ? [] : [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)]; }

test("header plus Overview performs one read and Top up close refreshes the same shared balance", async () => {
  const { CrmWalletProvider, CrmWalletMetric, MemberWalletSummary } = await interactive();
  const calls: string[] = [];
  const panel = { totalBalance: "920.00", ownerDetails: { paidBalance: "920.00", bonusBalance: "0.00" }, canTopUp: true, intentScope: "b:o", hasAccount: true };
  (globalThis as any).__crmFixture = { actions: { walletPanelAction: async (id: string) => { calls.push(id); return { ok: true, data: panel }; } } };
  const provider = hookSession(), card = hookSession();
  const shared = () => { (globalThis as any).__crmHooks = provider; return provider.render(() => CrmWalletProvider({ customerId: "a", enabled: true })).props.value; };
  const readCard = () => { card.shared = shared(); (globalThis as any).__crmHooks = card; return card.render(() => MemberWalletSummary({ customerId: "a", customerName: "A", enabled: true })); };
  shared(); await provider.flush();
  let tree = readCard(); await card.flush();
  assert.deepEqual(calls, ["a"]);
  assert.equal(nodes(tree).find(node => node.props?.panel)?.props.panel.totalBalance, "920.00");
  card.shared = shared(); (globalThis as any).__crmHooks = card;
  assert.ok(nodes(CrmWalletMetric()).some(node => node.props?.children === "RM 920.00"));
  nodes(tree).find(node => node.props?.onTopUp)?.props.onTopUp();
  tree = readCard();
  const modal = nodes(tree).find(node => node.props?.customerName === "A" && node.props?.onClose);
  assert.ok(modal, "original Top up opens its modal");
  assert.equal(modal.props.balance, "920.00");
  panel.totalBalance = "1100.00";
  modal.props.onClose(); shared(); await provider.flush(); tree = readCard(); await card.flush();
  assert.deepEqual(calls, ["a", "a"]);
  assert.equal(nodes(tree).find(node => node.props?.panel)?.props.panel.totalBalance, "1100.00");
});

test("customer switching discards late previous reads; OFF performs no read and failures remain unavailable", async () => {
  const { CrmWalletProvider } = await interactive();
  let resolveOld!: (value: unknown) => void;
  const calls: string[] = [];
  (globalThis as any).__crmFixture = { actions: { walletPanelAction: async (id: string) => { calls.push(id); if (id === "a") return new Promise(resolve => { resolveOld = resolve; }); if (id === "bad") throw Error("offline"); return { ok: true, data: { totalBalance: "20.00" } }; } } };
  const hooks = hookSession();
  (globalThis as any).__crmHooks = hooks;
  const read = (customerId: string, enabled = true) => hooks.render(() => CrmWalletProvider({ customerId, enabled })).props.value;
  read("a"); await hooks.flush();
  assert.equal(read("b").panel, null); await hooks.flush();
  assert.equal(read("b").panel.totalBalance, "20.00");
  resolveOld({ ok: true, data: { totalBalance: "999.00" } }); await hooks.flush();
  assert.equal(read("b").panel.totalBalance, "20.00");
  read("bad"); await hooks.flush();
  assert.equal(read("bad").panel, null); assert.match(read("bad").error, /unavailable/);
  read("off", false); await hooks.flush();
  assert.deepEqual(calls, ["a", "b", "bad"]);
});
test("failed and loading reads never substitute a zero balance; Staff details remain absent", async () => {
  const { WalletPanelContext, CrmWalletMetric, MemberWalletSummary } = await components();
  const render = (state: object) => renderToStaticMarkup(createElement(WalletPanelContext.Provider, { value: { customerId: "a", enabled: true, panel: null, error: "", pending: true, refresh() {}, ...state } }, createElement(CrmWalletMetric), createElement(MemberWalletSummary, { customerId: "a", customerName: "Customer", enabled: true })));
  assert.match(render({}), /Loading/);
  const failed = render({ pending: false, error: "Wallet balance is unavailable. Try again." });
  assert.match(failed, /Unavailable/); assert.match(failed, /Refresh wallet/); assert.doesNotMatch(failed, /RM 0\.00/);
  const staff = render({ pending: false, panel: { totalBalance: "0.00", canTopUp: false, hasAccount: false, ownerDetails: null, intentScope: "business:staff" } });
  assert.match(staff, /RM 0\.00/); assert.doesNotMatch(staff, /View transactions|View details|Paid credit|Bonus credit|>Top up</);
});
