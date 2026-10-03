import assert from "node:assert/strict";
import test from "node:test";
import {build} from "esbuild";
import {createRequire} from "node:module";

for(const mode of ["mixed","wallet","used","pending"] as const)test(`package ${mode} form preserves full-source payload and locked retry`,async()=>{
 const {JSDOM}=createRequire(import.meta.url)("jsdom");
 const options={kind:"invoice",releaseEnabled:true,businessId:"business",scope:"business:owner:invoice:invoice",sourceId:"invoice",canVoid:false,paidAmount:"",bonusAmount:"",method:"",reversed:false,legs:mode==="wallet"?[{paymentId:"wallet",method:"MEMBER_WALLET",availableCents:20000}]:[{paymentId:"wallet",method:"MEMBER_WALLET",availableCents:10000},{paymentId:"external",method:"CARD",availableCents:10000}],stockLines:[],packagePurchaseRefund:{refundableCents:20000,unavailableReason:mode==="used"||mode==="pending"?"All packages must be unused.":null}};
 const locked={operationKey:"original-key",fields:{kind:"refund",businessId:"business",sourceId:"invoice",reason:"Original reason",legs:JSON.stringify([{paymentId:"wallet",method:"MEMBER_WALLET",amountCents:10000,reference:""},{paymentId:"external",method:"CARD",amountCents:10000,reference:"original-ref"}]),stockLines:"[]",externalRefundReference:""}};
 const bundle=await build({stdin:{contents:`
  import React from 'react';import {createRoot} from 'react-dom/client';import {WalletRefundForm} from './src/components/wallet/wallet-refund-form';
  window.calls=[];window.confirm=()=>true;window.structuredClone=v=>JSON.parse(JSON.stringify(v));
  ${mode==="pending"?`sessionStorage.setItem('wallet-refund:${options.scope}',JSON.stringify({scope:${JSON.stringify(options.scope)},request:${JSON.stringify(locked)}}));`:""}
  createRoot(document.getElementById('root')).render(<WalletRefundForm sourceId="invoice" recoveryScope=${JSON.stringify(options.scope)} invoiceNumber="1001"/>);
 `,resolveDir:process.cwd(),loader:"tsx"},write:false,bundle:true,platform:"browser",format:"iife",jsx:"automatic",plugins:[{name:"server-boundaries",setup(b){
  b.onResolve({filter:/^next\/navigation$/},()=>({path:"router",namespace:"stub"}));
  b.onResolve({filter:/(crm\/wallet|invoices)\/actions$/},()=>({path:"actions",namespace:"stub"}));
  b.onLoad({filter:/.*/,namespace:"stub"},a=>({contents:a.path==="router"?"const r={refresh(){}};export const useRouter=()=>r;":`export async function walletRefundOptionsAction(){return {ok:true,data:${JSON.stringify(options)}}} export async function refundWalletSaleAction(state,data){window.calls.push(Object.fromEntries(data));throw Error('Unknown result');} export async function voidInvoiceAction(){throw Error('Wrong action');} export async function reverseWalletTopUpAction(){throw Error('Wrong action');}`}));
 }}]});
 const dom=new JSDOM(`<div id="root"></div><script>${bundle.outputFiles[0].text}</script>`,{runScripts:"dangerously",url:"http://disposable-ui.test"});
 const d=dom.window.document as Document;
 const wait=async(check:()=>boolean)=>{const end=Date.now()+5000;while(!check()){assert.ok(Date.now()<end,"form did not settle");await new Promise(r=>setTimeout(r,10));}};
 try{
  await wait(()=>!!d.querySelector('button[type="submit"]'));
  const submit=()=>d.querySelector<HTMLButtonElement>('button[type="submit"]')!;
  if(mode==="used"){assert.equal(submit().disabled,true);assert.match(d.body.textContent!,/unused/);assert.equal(dom.window.calls.length,0);return;}
  if(mode!=="pending"){
   assert.equal(submit().textContent,"Process full refund");assert.equal(d.querySelectorAll('input[type="number"],select').length,0);
   d.querySelector<HTMLTextAreaElement>('[name="reason"]')!.value="Approved full refund";
   const reference=d.querySelector<HTMLInputElement>('[name="reference_external"]');if(reference)reference.value="original-ref";
  }
  submit().click();await wait(()=>dom.window.calls.length===1&&d.querySelector('[role="status"]')?.textContent==="Unknown result"&&submit().textContent==="Retry confirmation"&&!submit().disabled);
  const first=dom.window.calls[0];const legs=JSON.parse(first.legs);
  assert.deepEqual(legs,mode==="wallet"?[{paymentId:"wallet",amountCents:20000,method:"MEMBER_WALLET",reference:""}]:[{paymentId:"wallet",amountCents:10000,method:"MEMBER_WALLET",reference:""},{paymentId:"external",amountCents:10000,method:"CARD",reference:"original-ref"}]);
  assert.equal(first.operationKey,first.operationId);assert.equal(first.invoiceId,"invoice");
  if(mode==="pending"){assert.equal(first.operationKey,"original-key");assert.equal(first.reason,"Original reason");}
  submit().click();await wait(()=>dom.window.calls.length===2);
  assert.deepEqual(dom.window.calls[1],first,"retry must reuse exact fields and operation key, not current options");
 }finally{dom.window.close();}
});
