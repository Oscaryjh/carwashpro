import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { crmUiBoundaries } from "../helpers/crm-ui-fixture";
import { WalletTopUpIntent } from "../../src/lib/wallet/top-up-intent";

const require = createRequire(import.meta.url);
let directory: string;
let ui: { WalletTopUpModal: (props: unknown) => ReactElement };
const offer = { id: "offer", version: 7, name: "Summer credit", paidAmount: "1000.00", bonusAmount: "100.00", totalCredited: "1100.00" };
const options = { activity: {modeAtConfirmation:"OFF",branchId:"branch",shiftId:null}, branches:[{id:"branch",name:"Local"}], offers: [offer], paymentMethods: [{ code: "BUILTIN_CASH", label: "Cash" }, { code: "BUILTIN_CARD", label: "Card" }] };
const tasks: Promise<unknown>[] = [];
let actionForm: FormData | undefined;
let closes = 0;
after(async () => { if (directory) await rm(directory, { recursive: true, force: true }); });

async function render(state: { offers?: typeof offer[]; offerId?: string; method?: string; pending?: boolean; locked?: boolean; storageFailed?: boolean; intent?: WalletTopUpIntent; balance?: string; multiBranch?: boolean; modeChanged?: boolean } = {}) {
  if (!ui) {
    directory = await mkdtemp(join(process.cwd(), "node_modules/.cache/wallet-modal-ui-"));
    const outfile = join(directory, "modal.cjs");
    await build({ entryPoints: ["src/components/wallet/wallet-top-up-modal.tsx"], outfile, bundle: true, platform: "node", format: "cjs", packages: "external", loader: { ".css": "empty" }, plugins: [
      { name: "modal-render-boundaries", setup(builder) {
        // Control hook state only for this modal; child presentation is real React.
        // Effects and portal mounting require a browser and are exercised separately.
        builder.onResolve({ filter: /^react$/ }, args => args.importer.endsWith("wallet-top-up-modal.tsx") ? { path: "hooks", namespace: "modal-test" } : undefined);
        builder.onResolve({ filter: /^\.\/wallet-dialog$/ }, () => ({ path: "dialog", namespace: "modal-test" }));
        builder.onLoad({ filter: /.*/, namespace: "modal-test" }, args => ({ contents: args.path === "hooks"
          ? "export const useState=()=>globalThis.__walletModalHooks.next();export const useRef=()=>({current:globalThis.__walletModalHooks.intent});export const useEffect=()=>{};export const useTransition=()=>globalThis.__walletModalHooks.transition;"
          : "import {createElement} from 'react';export function WalletDialog({title,children}){return createElement('section',null,createElement('h2',null,title),children)}", resolveDir: process.cwd() }));
      } }, crmUiBoundaries(),
    ] });
    ui = require(outfile);
  }
  const values = [{ ...options, activity:state.multiBranch ? null : options.activity, branches:state.multiBranch ? [...options.branches,{id:"other",name:"Other"}] : options.branches, offers: state.offers ?? options.offers }, state.offerId ?? "offer", state.method ?? "BUILTIN_CASH", "ref-123", "", null, state.locked ?? false, state.intent?.confirmation ?? null, state.storageFailed ?? false,state.modeChanged ?? false];
  let index = 0;
  Object.assign(globalThis, {
    __walletModalHooks: { next: () => [values[index++], () => {}], intent: state.intent ?? null, transition: [state.pending ?? false, (callback: () => Promise<unknown>) => tasks.push(callback())] },
    __crmFixture: { actions: { walletTopUpAction: async (form: FormData) => { actionForm = form; return { ok: false, uncertain: true, message: "Unknown result" }; } } },
  });
  const tree = ui.WalletTopUpModal({ intentScope: "scope", customerId: "customer", customerName: "Isaac liew", balance: state.balance ?? "920.00", onClose: () => { closes++; }, onSuccess() { throw Error("unexpected success"); } });
  return { tree, html: renderToStaticMarkup(tree) };
}
function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const element = node as ReactElement<Record<string, unknown>>;
  return [element, ...elements(element.props.children as ReactNode)];
}
function button(tree: ReactElement, text: string) {
  const result = elements(tree).find(node => node.type === "button" && node.props.children === text);
  assert.ok(result, `Missing ${text} button`);
  return result.props;
}

test("selected offer uses compact terminology, signed bonus and current-plus-credit preview", async () => {
  const { html, tree } = await render();
  assert.match(html, /Current wallet balance/);
  assert.match(html, /Top-up offer/);
  assert.match(html, /Summer credit · RM1,000 \+ RM100 bonus/);
  assert.match(html, /<dt>Top-up amount<\/dt><dd>RM 1,000\.00/);
  assert.match(html, /<dt>Bonus credit<\/dt><dd>\+RM 100\.00/);
  assert.match(html, /Total wallet credit<\/dt><dd><strong>RM 1,100\.00/);
  assert.match(html, /Balance after top-up<\/dt><dd[^>]*><strong>RM 2,020\.00/);
  assert.match(html, /Confirm after receiving payment\./);
  assert.match(html, /Tetamu POS records the top-up only; it does not charge the customer\./);
  assert.doesNotMatch(html, /Customer pays|Wallet receives|Pay RM|receive RM/);
  assert.equal(button(tree, "Confirm top-up").disabled, false);
});

test("unselected and empty-offer states show zero credit and unchanged current balance", async () => {
  for (const offers of [options.offers, []]) {
    const { html, tree } = await render({ offers, offerId: "" });
    assert.match(html, /Total wallet credit<\/dt><dd><strong>RM 0\.00/);
    assert.match(html, /Balance after top-up<\/dt><dd[^>]*><strong>RM 920\.00/);
    assert.doesNotMatch(html, /NaN|undefined|—/);
    assert.equal(button(tree, "Confirm top-up").disabled, true);
    if (!offers.length) assert.match(html, /No active top-up offers/);
  }
});

test("preview adds decimal amounts using the existing money helper without rounding drift", async () => {
  const { html } = await render({ balance: "0.60", offers: [{ ...offer, paidAmount: "0.60", bonusAmount: "0.60", totalCredited: "1.20" }] });
  assert.match(html, /Total wallet credit<\/dt><dd><strong>RM 1\.20/);
  assert.match(html, /Balance after top-up<\/dt><dd[^>]*><strong>RM 1\.80/);
});

test("confirm disabled conditions and payment/reference controls retain their original contract", async () => {
  for (const state of [{ method: "" }, { storageFailed: true }]) {
    assert.equal(button((await render(state)).tree, "Confirm top-up").disabled, true);
  }
  assert.equal(button((await render({ pending: true })).tree, "Confirming…").disabled, true);
  const { tree } = await render({ method: "BUILTIN_CARD" });
  const controls = elements(tree);
  assert.ok(controls.some(node => node.type === "select" && node.props.value === "BUILTIN_CARD" && node.props.disabled === false));
  const reference = controls.find(node => node.type === "input")!.props;
  assert.equal(reference.maxLength, 500);
  assert.equal(reference.value, "ref-123");
  assert.equal(reference.disabled, false);
  assert.equal(reference.required, undefined);
  const before = closes;
  (button(tree, "Cancel").onClick as () => void)();
  assert.equal(closes, before + 1);
});

test("pending presentation uses saved amounts and retry sends the original payload/key", async () => {
  let saved: string | null = null;
  const storage = { read: () => saved, write: (value: string) => { saved = value; }, remove: () => { saved = null; } };
  const original = new WalletTopUpIntent(storage);
  const request = original.confirm({ customerId: "customer", offerId: "old-offer", expectedOfferVersion: 4, paymentMethodCode: "BUILTIN_CARD", reference: "original-ref" }, { offerName: "Original offer", paymentMethodLabel: "Card", paidAmount: "200.00", bonusAmount: "20.00", totalCredited: "220.00" })!;
  original.uncertain();
  const restored = new WalletTopUpIntent(storage);
  const storedBefore = saved;
  const { html, tree } = await render({ locked: true, intent: restored });
  assert.match(html, /Original offer/); assert.match(html, /Card/); assert.match(html, /original-ref/);
  assert.match(html, /Top-up amount<\/dt><dd>RM 200\.00/);
  assert.match(html, /Bonus credit<\/dt><dd>\+RM 20\.00/);
  assert.match(html, /Total wallet credit<\/dt><dd>RM 220\.00/);
  assert.doesNotMatch(html, /Summer credit|Customer pays|Wallet receives|Balance after top-up/);
  assert.equal(saved, storedBefore);
  (button(tree, "Retry same confirmation").onClick as () => void)();
  await Promise.all(tasks.splice(0));
  assert.deepEqual(Object.fromEntries(actionForm!), Object.fromEntries(Object.entries(request).map(([key, value]) => [key, String(value)])));
  assert.equal(saved, storedBefore);
  assert.equal(restored.locked, true);
});

test("new top-up captures the displayed mode and branch without inventing a shift", async () => {
  const intent = new WalletTopUpIntent();
  const {tree} = await render({intent});
  (button(tree,"Confirm top-up").onClick as () => void)();
  await Promise.all(tasks.splice(0));
  assert.equal(actionForm?.get("modeAtConfirmation"),"OFF");
  assert.equal(actionForm?.get("branchId"),"branch");
  assert.equal(actionForm?.get("shiftId"),"");
  assert.equal(intent.existing?.shiftId,null);
});

test("multiple branches require explicit selection, not the first branch",async()=>{
  const {tree,html}=await render({multiBranch:true});
  assert.equal(button(tree,"Confirm top-up").disabled,true);
  assert.match(html,/Select collection branch/);
  const selector=elements(tree).find(node=>node.type==="select" && node.props["aria-label"]==="Collection branch");
  assert.ok(selector); assert.equal(selector.props.value,"");
});

test("mode change requires an explicit button and preserves the original key/amounts",async()=>{
  const intent=new WalletTopUpIntent();
  const original=intent.confirm({customerId:"customer",offerId:"old-offer",expectedOfferVersion:4,paymentMethodCode:"BUILTIN_CARD",reference:"original",modeAtConfirmation:"ON",branchId:"branch",shiftId:"old-shift"}, {offerName:"Original",paymentMethodLabel:"Card",paidAmount:"200.00",bonusAmount:"20.00",totalCredited:"220.00"})!;
  intent.modeChanged();
  const {tree,html}=await render({intent,locked:true,modeChanged:true});
  assert.deepEqual(intent.existing,original);
  assert.match(html,/Cashier shifts: OFF/);
  (button(tree,"Confirm with current cashier settings").onClick as () => void)();
  await Promise.all(tasks.splice(0));
  assert.equal(actionForm?.get("operationKey"),original.operationKey);
  assert.equal(actionForm?.get("offerId"),"old-offer");
  assert.equal(actionForm?.get("modeAtConfirmation"),"OFF");
  assert.equal(actionForm?.get("shiftId"),"");
});

test("legacy pending without a branch requires selection and explicit confirmation, never a new key",async()=>{
  const intent=new WalletTopUpIntent();
  const original=intent.confirm({customerId:"customer",offerId:"old-offer",expectedOfferVersion:4,paymentMethodCode:"BUILTIN_CARD",reference:"legacy"})!;
  intent.modeChanged();
  const multiple=await render({intent,locked:true,modeChanged:true,multiBranch:true});
  assert.equal(button(multiple.tree,"Confirm with current cashier settings").disabled,true);
  const selector=elements(multiple.tree).find(node=>node.type==="select"&&node.props["aria-label"]==="Review collection branch");
  assert.ok(selector);assert.equal(selector.props.value,"");assert.deepEqual(intent.existing,original);
  const reviewed=await render({intent,locked:true,modeChanged:true});
  assert.equal(button(reviewed.tree,"Confirm with current cashier settings").disabled,false);
  (button(reviewed.tree,"Confirm with current cashier settings").onClick as ()=>void)();
  await Promise.all(tasks.splice(0));
  assert.equal(actionForm?.get("operationKey"),original.operationKey);
  assert.equal(actionForm?.get("branchId"),"branch");assert.equal(actionForm?.get("reference"),"legacy");
});
