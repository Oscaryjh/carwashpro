import assert from "node:assert/strict";
import test from "node:test";
import {build} from "esbuild";
import {createRequire} from "node:module";

// Missing success history invalidation must fail against the real summary/form pair.
for (const mode of ["success", "read-failure", "closed"] as const) test(`reversal ${mode}: refresh current history without repeating the writer`, async () => {
 const {JSDOM}=createRequire(import.meta.url)("jsdom");
 const bundle=await build({stdin:{contents:`
 import React from 'react';import {createRoot} from 'react-dom/client';import {MemberWalletSummary} from './src/components/wallet/member-wallet-summary';
 window.confirm=()=>true;window.structuredClone=v=>JSON.parse(JSON.stringify(v));
 HTMLDialogElement.prototype.showModal=function(){this.open=true};HTMLDialogElement.prototype.close=function(){this.open=false};
 createRoot(document.getElementById('root')).render(<MemberWalletSummary customerId="customer" customerName="Customer" enabled/>);
 `,resolveDir:process.cwd(),loader:"tsx"},write:false,bundle:true,platform:"browser",format:"iife",jsx:"automatic",loader:{".css":"empty"},plugins:[{name:"server-boundaries",setup(b){
 b.onResolve({filter:/^next\/navigation$/},()=>({path:"router",namespace:"history-test"}));
 b.onResolve({filter:/(crm\/wallet|invoices)\/actions$/},()=>({path:"actions",namespace:"history-test"}));
 b.onLoad({filter:/.*/,namespace:"history-test"},a=>({contents:a.path==="router"?"const router={refresh(){}};export const useRouter=()=>router;":`
 const s=window.state;
 export async function walletTopUpAction(){throw Error('unexpected top-up');}export async function walletTopUpOptionsAction(){throw Error('unexpected top-up options');}
 export async function walletPanelAction(){s.panels++;return {ok:true,data:{totalBalance:s.reversed?'0.00':'110.00',canTopUp:false,ownerDetails:{paidBalance:s.reversed?'0.00':'100.00',bonusBalance:s.reversed?'0.00':'10.00'}}};}
 export async function walletHistoryAction(customer,page){s.reads.push({customer,page});if(s.reversed&&s.fail)throw Error('read unavailable');const row={id:'top',date:'2026-10-09T10:00:00Z',type:'Top-up',source:'Original top-up',staff:'Owner',amount:'110.00',balanceAfter:'110.00',paidAmount:'100.00',bonusAmount:'10.00'};return {ok:true,data:{rows:s.reversed?[{...row,id:'reverse',type:'Reversal',source:'New reversal',amount:'-110.00',balanceAfter:'0.00',paidAmount:'-100.00',bonusAmount:'-10.00'},row]:[row],canReverse:true,reversalSources:[{id:'top',date:row.date,offer:'Offer',paidAmount:'100.00'}],hasMore:page===0,refundScopePrefix:'business:owner'}};}
 export async function walletRefundOptionsAction(){return {ok:true,data:{kind:'top-up',releaseEnabled:true,businessId:'business',scope:'business:owner:top-up:top',sourceId:'top',canVoid:false,paidAmount:'100.00',bonusAmount:'10.00',method:'CASH',reversed:s.reversed,consumed:false,legs:[],stockLines:[],packagePurchaseRefund:null}};}
 export async function reverseWalletTopUpAction(){s.writes++;await new Promise(r=>s.resolve=r);s.reversed=true;return {ok:true};}
 export async function refundWalletSaleAction(){throw Error('wrong writer');}export async function voidInvoiceAction(){throw Error('wrong writer');}
 `}));
 }}]});
 const dom=new JSDOM(`<div id="root"></div><script>window.state={writes:0,reads:[],panels:0,reversed:false,fail:${mode==="read-failure"},resolve:null};</script><script>${bundle.outputFiles[0].text}</script>`,{runScripts:"dangerously",url:"http://history.test"});
 const d=dom.window.document as Document, s=dom.window.state;
 const text=()=>`${d.getElementById('root')?.textContent??""}${d.querySelector('dialog')?.textContent??""}`;
 const button=(name:string)=>Array.from(d.querySelectorAll<HTMLButtonElement>('button')).find(b=>b.textContent===name||b.getAttribute('aria-label')===name);
 const wait=async(check:()=>boolean)=>{const end=Date.now()+5000;while(!check()){assert.ok(Date.now()<end,`UI did not settle: ${text()}`);await new Promise(r=>setTimeout(r,10));}};
 try {
  await wait(()=>!!button('View transactions'));button('View transactions')!.click();await wait(()=>!!button('Next')&&!button('Next')!.disabled);
  button('Next')!.click();await wait(()=>text().includes('Page 2'));
  const select=d.querySelector('select')!;select.value='top';select.dispatchEvent(new dom.window.Event('change',{bubbles:true}));
  await wait(()=>!!button('Reverse'));button('Reverse')!.click();await wait(()=>!!d.querySelector('form'));
  d.querySelector<HTMLTextAreaElement>('[name="reason"]')!.value='Browser approved reversal';button('Reverse top-up')!.click();await wait(()=>s.writes===1&&!!s.resolve);
  if(mode==='closed')button('Close')!.click();
  s.resolve();await wait(()=>s.panels===2);
  if(mode==='closed'){assert.equal(d.querySelector('dialog'),null);assert.equal(s.reads.length,2);assert.equal(s.writes,1);return;}
  await wait(()=>s.reads.length===3);
  assert.deepEqual(JSON.parse(JSON.stringify(s.reads[2])),{customer:'customer',page:1});
  if(mode==='read-failure'){
   await wait(()=>!!button('Try again'));assert.match(text(),/Top-up reversed/);assert.match(text(),/transactions could not be loaded/);assert.equal(!!button('Reverse top-up'),false);
   s.fail=false;button('Try again')!.click();
  }
  await wait(()=>text().includes('New reversal'));
  assert.match(text(),/Original top-up/);assert.match(text(),/Page 2/);assert.ok(d.querySelector('dialog'));
  await wait(()=>text().includes('already reversed'));
  assert.equal(!!button('Reverse'),false);assert.equal(s.writes,1);assert.equal(dom.window.sessionStorage.length,0);
 } finally {dom.window.close();}
});

test("consumed read preserves the account, strict sequence boundary and all three debit predicates",async()=>{
 const m=await import("../../src/lib/wallet/top-up-consumed").catch(()=>null);
 assert.ok(m?.isWalletTopUpConsumed,"shared read helper is required");
 for(const found of [null,{id:"redemption"},{id:"negative-paid"},{id:"negative-bonus"}]){
  const db={walletTransaction:{findFirst:async(args:unknown)=>{
   assert.deepEqual(args,{where:{walletAccountId:"account",sequence:{gt:12},OR:[{type:"REDEMPTION"},{paidDelta:{lt:0}},{bonusDelta:{lt:0}}]}});
   return found;
  }}};
  assert.equal(await m.isWalletTopUpConsumed(db as never,"account",12),found!==null);
 }
});

for(const mode of ["consumed","cash","card","pending","stale"] as const)test(`top-up ${mode}: new controls and original retry contract`,async()=>{
 const {JSDOM}=createRequire(import.meta.url)("jsdom");
 const options={kind:"top-up",releaseEnabled:true,businessId:"business",scope:"business:owner:top-up:top",sourceId:"top",canVoid:false,paidAmount:"1000.00",bonusAmount:"100.00",method:mode==="card"?"CARD":"CASH",reversed:false,consumed:mode==="consumed"||mode==="pending",legs:[],stockLines:[],packagePurchaseRefund:null};
 const locked={operationKey:"original-key",fields:{kind:"reversal",businessId:"business",sourceId:"top",reason:"Original reason",legs:"[]",stockLines:"[]",externalRefundReference:"original-ref"}};
 const bundle=await build({stdin:{contents:`
 import React from 'react';import {createRoot} from 'react-dom/client';import {WalletRefundForm} from './src/components/wallet/wallet-refund-form';
 window.calls=[];window.confirm=()=>true;window.structuredClone=v=>JSON.parse(JSON.stringify(v));
 ${mode==="pending"?`sessionStorage.setItem('wallet-refund:${options.scope}',JSON.stringify({scope:${JSON.stringify(options.scope)},request:${JSON.stringify(locked)}}));`:""}
 createRoot(document.getElementById('root')).render(<WalletRefundForm sourceId="top" kind="top-up" recoveryScope=${JSON.stringify(options.scope)}/>);
 `,resolveDir:process.cwd(),loader:"tsx"},write:false,bundle:true,platform:"browser",format:"iife",jsx:"automatic",plugins:[{name:"boundaries",setup(b){
 b.onResolve({filter:/^next\/navigation$/},()=>({path:"router",namespace:"stub"}));
 b.onResolve({filter:/(crm\/wallet|invoices)\/actions$/},()=>({path:"actions",namespace:"stub"}));
 b.onLoad({filter:/.*/,namespace:"stub"},a=>({contents:a.path==="router"?"const r={refresh(){}};export const useRouter=()=>r;":`export async function walletRefundOptionsAction(){return {ok:true,data:${JSON.stringify(options)}}} export async function reverseWalletTopUpAction(data){window.calls.push(Object.fromEntries(data));${mode==="stale"?`return {ok:false,code:'TOP_UP_ALREADY_CONSUMED',canCorrect:true,message:'Already used'};`:`throw Error('Unknown result');`}} export async function refundWalletSaleAction(){throw Error('Wrong action');} export async function voidInvoiceAction(){throw Error('Wrong action');}`}));
 }}]});
 const dom=new JSDOM(`<div id="root"></div><script>${bundle.outputFiles[0].text}</script>`,{runScripts:"dangerously",url:"http://disposable-ui.test"});
 const d=dom.window.document as Document;
 const text=()=>d.getElementById('root')!.textContent!;
 const wait=async(check:()=>boolean)=>{const end=Date.now()+5000;while(!check()){assert.ok(Date.now()<end,"UI did not settle");await new Promise(r=>setTimeout(r,10));}};
 const button=(name:string)=>Array.from(d.querySelectorAll<HTMLButtonElement>('button')).find(b=>b.textContent===name);
 try{
  await wait(()=>!!d.querySelector('section'));
  if(mode==="consumed"){
   assert.match(text(),/Used · Not reversible/);
   assert.match(text(),/This top-up has already been used and cannot be reversed\./);
   assert.equal(d.querySelectorAll('input,textarea,form,button').length,0);return;
  }
  if(mode!=="pending"){
   assert.equal(!!d.querySelector('form'),false,"must not permanently expand reversal form");
   assert.ok(button("Reverse"));button("Reverse")!.click();await wait(()=>!!d.querySelector('form'));
   assert.match(text(),/Top-up amount/);assert.match(text(),/Bonus to remove/);assert.match(text(),/Original payment method/);
   assert.match(text(),/1000.00/);assert.match(text(),/100.00/);
   const reference=d.querySelector<HTMLInputElement>('[name="externalRefundReference"]')!;
   assert.equal(reference.required,mode==="card");
   const reason=d.querySelector<HTMLTextAreaElement>('[name="reason"]')!;
   assert.equal(reason.required,true);assert.equal(reason.minLength,3);assert.equal(reason.maxLength,500);
   assert.equal(dom.window.sessionStorage.length,0,"opening creates no operation key");
   button("Cancel")!.click();await wait(()=>!d.querySelector('form'));
   button("Reverse")!.click();await wait(()=>!!d.querySelector('form'));
   d.querySelector<HTMLTextAreaElement>('[name="reason"]')!.value="Approved reversal";
   d.querySelector<HTMLInputElement>('[name="externalRefundReference"]')!.value="original-ref";
   assert.ok(button("Reverse top-up")!.classList.contains("wallet-reversal-danger"));
  }else{assert.equal(!!d.querySelector('textarea'),false);assert.match(text(),/Original reason/);}
  d.querySelector<HTMLButtonElement>('button[type="submit"]')!.click();await wait(()=>dom.window.calls.length===1);
  if(mode==="stale"){await wait(()=>text().includes("Used · Not reversible"));assert.equal(!!d.querySelector('form'),false);return;}
  await wait(()=>!!button("Retry confirmation")&&!button("Retry confirmation")!.disabled);
  const first=JSON.parse(JSON.stringify(dom.window.calls[0]));
  assert.equal(first.topUpId,"top");assert.equal(first.operationKey,first.operationId);assert.equal(first.legs,"[]");assert.equal(first.externalRefundReference,"original-ref");
  if(mode==="pending"){assert.equal(first.operationKey,"original-key");assert.equal(first.reason,"Original reason");}
  button("Retry confirmation")!.click();await wait(()=>dom.window.calls.length===2);
  assert.deepEqual(JSON.parse(JSON.stringify(dom.window.calls[1])),first);
 }finally{dom.window.close();}
});
