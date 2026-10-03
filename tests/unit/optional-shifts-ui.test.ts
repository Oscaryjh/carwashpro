import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { createRequire } from "node:module";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

test("Cashier operations renders explicit ON/OFF without profile fields",async()=>{
  const dir=await mkdtemp(join(process.cwd(),'node_modules/.cache/optional-shifts-ui-'));
  try{
    await build({entryPoints:['src/components/cashier-operations-settings.tsx'],outfile:join(dir,'ui.cjs'),bundle:true,packages:'external',platform:'node',format:'cjs',jsx:'automatic',plugins:[{name:'action',setup(b){b.onResolve({filter:/^@\/app\/.*cashier-operations-actions$/},a=>({path:a.path,namespace:'action'}));b.onLoad({filter:/.*/,namespace:'action'},()=>({contents:'export async function saveCashierOperationsAction(){throw Error("Unexpected save")}' }));}}]});
    const {CashierOperationsSettings}=createRequire(import.meta.url)(join(dir,'ui.cjs'));
    for(const enabled of [true,false]){
      const html=renderToStaticMarkup(createElement(CashierOperationsSettings,{enabled}));
      assert.match(html,/Cashier shifts/);
      assert.match(html,enabled ? /Requires staff to start a shift/ : /Use Cashier directly without starting or ending a shift\./);
      assert.match(html,new RegExp(`aria-checked="${enabled}"`));assert.match(html,/name="cashierShiftsEnabled"/);assert.doesNotMatch(html,/name="businessId"|name="slug"|name="openingFloat"/);
      assert.equal((html.match(/<form/g)||[]).length,1);
    }
  }finally{await rm(dir,{recursive:true,force:true});}
});

test("rejected OFF save preserves the user's selection in a real client form", async () => {
  // Only the remote server action is substituted. React, client DOM events,
  // form submission/reset and the production component are real. No DB used.
  const require = createRequire(import.meta.url);
  const { JSDOM } = require('jsdom');
  const bundle = await build({stdin:{contents:`import React from 'react'; import {createRoot} from 'react-dom/client'; import {CashierOperationsSettings} from './src/components/cashier-operations-settings'; createRoot(document.getElementById('root')).render(<CashierOperationsSettings enabled={true}/>);`,resolveDir:process.cwd(),loader:'tsx'},write:false,bundle:true,platform:'browser',format:'iife',jsx:'automatic',plugins:[{name:'action',setup(b){b.onResolve({filter:/^@\/app\/.*cashier-operations-actions$/},a=>({path:a.path,namespace:'action'}));b.onLoad({filter:/.*/,namespace:'action'},()=>({contents:`export async function saveCashierOperationsAction(previous,data){ if(data.get('cashierShiftsEnabled')!=='false') throw Error('Wrong submitted selection'); return {status:'error',message:'Close all open cashier shifts before disabling cashier shifts.'}; }`}));}}]});
  const dom=new JSDOM(`<div id="root"></div><script>${bundle.outputFiles[0].text}</script>`,{runScripts:'dangerously',url:'http://disposable-ui.test'});
  const document=dom.window.document;
  async function waitFor(predicate:()=>boolean){const deadline=Date.now()+5000;while(!predicate()){assert.ok(Date.now()<deadline,'React client did not settle');await new Promise(ok=>setTimeout(ok,10));}}
  try {
    await waitFor(()=>!!document.querySelector('[role="switch"]'));
    const select=document.querySelector('[role="switch"]') as HTMLButtonElement;
    assert.equal(select.getAttribute('aria-checked'),'true');
    select.click();await waitFor(()=>select.getAttribute('aria-checked')==='false');
    (document.querySelector('button[type="submit"]') as HTMLButtonElement).click();
    await waitFor(()=>!!document.querySelector('[role="alert"]') && !select.disabled);
    assert.equal(select.getAttribute('aria-checked'),'false','failed save must not reset OFF to original ON');
    assert.match(document.querySelector('[role="alert"]')!.textContent!,/End all open/);
    assert.equal(select.disabled,false);
  } finally {dom.window.close();}
});
