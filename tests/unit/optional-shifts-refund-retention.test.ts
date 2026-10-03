import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { createRequire } from "node:module";

for (const failure of ["mode", "unknown", "transport"] as const) test(`refund ${failure} rejection and review preserve partial amount, reference, reason, stock and operation key`, async () => {
  const { JSDOM } = createRequire(import.meta.url)("jsdom");
  const bundle = await build({ stdin: { contents: `
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import {RefundPaymentForm} from './src/components/refund-payment-form';
    window.calls=[]; window.confirm=()=>true;
    createRoot(document.getElementById('root')).render(<RefundPaymentForm cashierShiftsEnabled={true} shiftId="old-shift" invoiceId="invoice" invoiceNumber="1001" paymentId="payment" originalMethod="CARD" refundableAmount={300} stockLines={[{id:'item',name:'Product',remainingQuantity:3}]}/>);
  `, resolveDir: process.cwd(), loader: "tsx" }, write: false, bundle: true, platform: "browser", format: "iife", jsx: "automatic", plugins: [{ name: "boundaries", setup(b) {
    b.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: "router", namespace: "mock" }));
    b.onResolve({ filter: /invoices\/actions$/ }, () => ({ path: "actions", namespace: "mock" }));
    b.onLoad({ filter: /.*/, namespace: "mock" }, args => ({ contents: args.path === "router" ? "const router={refresh(){}};export function useRouter(){return router}" : `
      export async function refundPaymentAction(state,data){window.calls.push(Object.fromEntries(data));${failure === "transport" ? "throw Error('Server connection interrupted');" : `return {status:'error',message:${JSON.stringify(failure === "mode" ? "CASHIER_SHIFT_MODE_CHANGED: Review" : "Unable to confirm refund. Retry the same request.")}};`}}
      export async function refundCashierActivityAction(){return {ok:true,activity:{modeAtConfirmation:'OFF',shiftId:null}};}
    ` }));
  } }] });
  const dom = new JSDOM(`<div id="root"></div><script>${bundle.outputFiles[0].text}</script>`, { runScripts: "dangerously", url: "http://disposable-ui.test" });
  const d = dom.window.document;
  async function waitFor(predicate: () => boolean) { const end = Date.now() + 3000; while (!predicate()) { assert.ok(Date.now() < end, "client did not settle"); await new Promise(r => setTimeout(r, 10)); } }
  const button = (label: string) => [...d.querySelectorAll("button")].find((b: any) => b.textContent === label) as HTMLButtonElement | undefined;
  const values = { amount: "50.00", reference: "original-ref", reason: "Partial return", refundQuantity_item: "1", refundDisposition_item: "NO_RESTOCK", refundNoRestockReason_item: "Damaged item" };
  try {
    await waitFor(() => !!button("Process refund") && !button("Process refund")!.disabled && !!(d.querySelector('[name="operationId"]') as HTMLInputElement)?.value);
    for (const [name, value] of Object.entries(values)) (d.querySelector(`[name="${name}"]`) as HTMLInputElement).value = value;
    button("Process refund")!.click();
    await waitFor(() => !!d.querySelector('.form-message.error') && !button("Process refund")?.disabled);
    for (const [name, value] of Object.entries(values)) assert.equal((d.querySelector(`[name="${name}"]`) as HTMLInputElement).value, value, `${name} must survive React form reset`);
    const first = JSON.parse(JSON.stringify(dom.window.calls[0]));
    if (failure === "mode") {
      button("Review current cashier settings")!.click();
      await waitFor(() => d.querySelector('[name="modeAtConfirmation"]')?.getAttribute("value") === "OFF");
      assert.equal(dom.window.calls.length, 1, "review must not refund");
    }
    button("Process refund")!.click();
    await waitFor(() => dom.window.calls.length === 2);
    assert.deepEqual(JSON.parse(JSON.stringify(dom.window.calls[1])), { ...first, ...(failure === "mode" ? {modeAtConfirmation:"OFF",shiftId:""} : {}) });
  } finally { dom.window.close(); }
});
