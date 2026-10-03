import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { createRequire } from "node:module";

for(const entry of ["safe", "pos-package"] as const) test(`${entry}: serialized mode rejection retains the request and requires explicit reviewed settings before retry`, async () => {
  const { JSDOM } = createRequire(import.meta.url)("jsdom");
  const bundle = await build({ stdin: { contents: `
    import React,{useState} from 'react'; import {createRoot} from 'react-dom/client';
    import {SafePaymentForm} from './src/components/performance/safe-payment-form';
    import {PosPaymentPanel} from './src/components/pos-payment-panel';
    window.calls=[]; HTMLElement.prototype.scrollIntoView=function(){};
    function App(){const [mode,setMode]=useState('ON');window.refreshMode=()=>setMode('OFF');
      ${entry === "pos-package" ? `return <PosPaymentPanel cashierShiftsEnabled={mode==='ON'} shiftId={mode==='ON'?'shift-a':null} workOrderId="original-job" balance={40} canPay={true} customerPackages={[{id:'original-package',packageName:'Choose package',remainingUses:2,totalUses:5}]} recordPaymentAction={async()=>{throw Error('wrong form')}} usePackagePaymentAction={async data=>{window.calls.push(Object.fromEntries(data));if(data.get('modeAtConfirmation')==='ON')return JSON.parse(JSON.stringify({code:'CASHIER_SHIFT_MODE_CHANGED',message:'Review current cashier settings'}));}}/>;` : ""}
      return <SafePaymentForm cashierActivity={{modeAtConfirmation:mode,shiftId:mode==='ON'?'shift-a':null}} action={async data=>{window.calls.push(Object.fromEntries(data));if(data.get('modeAtConfirmation')==='ON')return JSON.parse(JSON.stringify({code:'CASHIER_SHIFT_MODE_CHANGED',message:'Review current cashier settings'}));}}>
      <input type="hidden" name="operationId" value="original-operation"/>
      <input type="hidden" name="modeAtConfirmation" value={mode}/><input type="hidden" name="shiftId" value={mode==='ON'?'shift-a':''}/>
      <input name="amount" defaultValue="40"/><button type="submit">Pay</button></SafePaymentForm>}
    createRoot(document.getElementById('root')).render(<App/>);`, resolveDir: process.cwd(), loader: "tsx" }, write: false, bundle: true, platform: "browser", format: "iife", jsx: "automatic", loader:{".css":"empty"}, plugins: [{ name: "navigation", setup(b) {
      b.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: "router", namespace: "mock" }));
      b.onResolve({ filter: /^next\/link$/ }, () => ({ path: "link", namespace: "mock" }));
      b.onResolve({ filter: /^@\/components\/performance\/checkout-attribution$/ }, () => ({ path: "attribution", namespace: "mock" }));
      b.onLoad({ filter: /.*/, namespace: "mock" }, args => ({ contents: args.path === "link" ? "export default function Link(){return null}" : args.path === "attribution" ? "export function CheckoutAttribution(){return null}" : "export function useRouter(){return {refresh(){window.refreshMode()}}}" }));
    } }] });
  const dom = new JSDOM(`<div id="root"></div><script>${bundle.outputFiles[0].text}</script>`, { runScripts: "dangerously", url: "http://disposable-ui.test" });
  const d = dom.window.document;
  async function waitFor(predicate: () => boolean) { const end = Date.now() + 3000; while (!predicate()) { assert.ok(Date.now() < end, "client did not settle"); await new Promise(r => setTimeout(r, 10)); } }
  const button = (label: string) => [...d.querySelectorAll("button")].find((b: any) => b.textContent === label) as HTMLButtonElement | undefined;
  try {
    if(entry === "pos-package") {
      await waitFor(()=>!!d.querySelector('.pos-package-option'));
      (d.querySelector('.pos-package-option') as HTMLButtonElement).click();
    }
    const payLabel=entry === "safe"?"Pay":"Check out";
    await waitFor(() => !!button(payLabel) && !button(payLabel)!.disabled); button(payLabel)!.click();
    await waitFor(() => !!d.querySelector('[role="alert"]'));
    assert.ok(button("Review current cashier settings"), "mode error must offer a review without losing the form");
    button("Review current cashier settings")!.click();
    await waitFor(() => d.querySelector('[name="modeAtConfirmation"]')?.getAttribute("value") === "OFF");
    assert.equal(dom.window.calls.length, 1, "review must not submit");
    const originalKey=dom.window.calls[0].operationId;
    button(payLabel)!.click(); await new Promise(r => setTimeout(r, 30));
    assert.equal(dom.window.calls.length, 1, "unconfirmed new mode must not be sent");
    button("Use reviewed cashier settings")!.click(); button(payLabel)!.click();
    await waitFor(() => dom.window.calls.length === 2);
    assert.deepEqual(JSON.parse(JSON.stringify(dom.window.calls[1])), { preservePaymentForm: "1", operationId: originalKey, modeAtConfirmation: "OFF", shiftId: "", ...(entry === "safe" ? {amount:"40"} : {workOrderId:"original-job",customerPackageId:"original-package"}) });
  } finally { dom.window.close(); }
});
