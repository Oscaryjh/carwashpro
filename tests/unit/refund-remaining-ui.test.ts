import assert from 'node:assert/strict';
import test from 'node:test';
import {build} from 'esbuild';
import {createRequire} from 'node:module';

const {JSDOM}=createRequire(import.meta.url)('jsdom');
async function setup(remaining=96){
 const bundle=await build({stdin:{contents:`
 import React from 'react';import{createRoot}from'react-dom/client';import{InvoiceRefundPaymentForm}from'./src/components/invoice-refund-payment-form';
 window.f={remaining:${remaining},reads:0,writes:[],mode:'success'};window.confirm=()=>true;
 const root=createRoot(document.getElementById('root'));
 window.renderBalance=(amount)=>root.render(<InvoiceRefundPaymentForm cashierShiftsEnabled={false} invoiceId="invoice" invoiceNumber="1010" paymentId="payment" originalMethod="CASH" refundableAmount={amount}/>);
 window.reopen=()=>{root.render(null);};window.renderBalance(${remaining});
 `,resolveDir:process.cwd(),loader:'tsx'},write:false,bundle:true,platform:'browser',format:'iife',jsx:'automatic',plugins:[{name:'refund-read-io',setup(b){
 b.onResolve({filter:/^next\/navigation$/},()=>({path:'router',namespace:'io'}));
 b.onResolve({filter:/invoices\/(actions|refund-presentation)$/},a=>({path:a.path.endsWith('refund-presentation')?'read':'write',namespace:'io'}));
 b.onLoad({filter:/.*/,namespace:'io'},a=>({contents:a.path==='router'?`const r={refresh(){}};export const useRouter=()=>r;`:a.path==='read'?`export async function refundPresentationAction(){window.f.reads++;return {ok:true,refundableAmount:window.f.remaining,packagePurchaseRefund:null}};`:`export async function refundCashierActivityAction(){return {ok:true,activity:{modeAtConfirmation:'OFF',shiftId:null}}} export async function refundPaymentAction(_,data){window.f.writes.push(Object.fromEntries(data));if(window.f.mode==='pending')return new Promise(r=>window.f.finish=r);if(window.f.mode==='error')return{status:'error',message:'Retry the same request'};window.f.remaining-=Number(data.get('amount'));return{status:'success',message:'Refund recorded'};}`}));
 }}]});
 const dom=new JSDOM(`<div id="root"></div><script>${bundle.outputFiles[0].text}</script>`,{runScripts:'dangerously',url:'http://disposable-ui.test'});
 const d=dom.window.document;
 async function wait(predicate:()=>boolean){const deadline=Date.now()+4000;while(!predicate()){assert.ok(Date.now()<deadline,'real refund UI did not settle');await new Promise(r=>setTimeout(r,10));}}
 await wait(()=>!!d.querySelector('[name="amount"]')&&!!(d.querySelector('[name="operationId"]') as HTMLInputElement)?.value);
 return {dom,d,wait,input:()=>d.querySelector('[name="amount"]') as HTMLInputElement,submit:()=>d.querySelector('[type="submit"]') as HTMLButtonElement};
}

for(const amount of [96,48,0])test(`server remaining ${amount} controls default, cap and zero eligibility`,async()=>{
 const f=await setup(amount);try{
 assert.equal(f.input().value,amount.toFixed(2));assert.equal(f.input().max,amount.toFixed(2));
 assert.match(f.d.querySelector('form')!.textContent!,new RegExp(`Remaining refundable: RM${amount.toFixed(2)}`));
 assert.equal(f.submit().disabled,amount===0);
 f.input().value=(amount+0.01).toFixed(2);assert.equal(f.input().validity.rangeOverflow,true);
 }finally{f.dom.window.close();}
});

test('each consecutive successful request rotates once, including identical success messages',async()=>{
 const f=await setup();try{
 const key=()=> (f.d.querySelector('[name="operationId"]') as HTMLInputElement).value;
 const k1=key();
 for(const amount of [24,24]){
 const before=key();f.input().value=String(amount);(f.d.querySelector('[name="reason"]') as HTMLTextAreaElement).value='Sequential refund';f.submit().click();
 await f.wait(()=>f.input()?.max===f.dom.window.f.remaining.toFixed(2)&&f.dom.window.f.writes.length===(amount===24&&before===k1?1:2));
 assert.notEqual(key(),before,'completed request must rotate its key');
 }
 const k3=key();f.dom.window.renderBalance(96);await new Promise(r=>setTimeout(r,30));assert.equal(key(),k3);assert.equal(f.dom.window.f.reads,3);
 }finally{f.dom.window.close();}
});

test('unknown outcome retry uses the original key and complete payload despite draft edits',async()=>{
 const f=await setup();try{
 f.dom.window.f.mode='error';f.input().value='24';(f.d.querySelector('[name="reason"]') as HTMLTextAreaElement).value='Original intent';f.submit().click();
 await f.wait(()=>!!f.d.querySelector('.form-message.error')&&!f.submit().disabled);
 const original=JSON.stringify(f.dom.window.f.writes[0]);
 f.input().value='48';(f.d.querySelector('[name="reason"]') as HTMLTextAreaElement).value='Changed draft';f.submit().click();
 await f.wait(()=>f.dom.window.f.writes.length===2);assert.equal(JSON.stringify(f.dom.window.f.writes[1]),original);
 }finally{f.dom.window.close();}
});

test('rapid double submit sends only one request; cancel sends none',async()=>{
 const f=await setup();try{
 (f.d.querySelector('[name="reason"]') as HTMLTextAreaElement).value='Guard test';
 f.dom.window.confirm=()=>false;f.submit().click();await new Promise(r=>setTimeout(r,20));assert.equal(f.dom.window.f.writes.length,0);
 f.dom.window.confirm=()=>true;f.dom.window.f.mode='pending';f.submit().click();f.submit().click();await f.wait(()=>f.dom.window.f.writes.length>0);assert.equal(f.dom.window.f.writes.length,1);
 }finally{f.dom.window.close();}
});

test('unknown second outcome retains K2 across reopen and rotates only after confirmed retry',async()=>{
 const f=await setup();try{
 const key=()=> (f.d.querySelector('[name="operationId"]') as HTMLInputElement).value;
 f.input().value='24';(f.d.querySelector('[name="reason"]') as HTMLTextAreaElement).value='First';f.submit().click();await f.wait(()=>f.input()?.max==='72.00');
 const k2=key();f.dom.window.f.mode='pending';f.input().value='24';(f.d.querySelector('[name="reason"]') as HTMLTextAreaElement).value='Second';f.submit().click();
 await f.wait(()=>f.dom.window.f.writes.length===2&&f.submit().disabled);assert.equal(key(),k2);
 f.dom.window.f.finish({status:'error',message:'Outcome unknown'});await f.wait(()=>!!f.d.querySelector('.form-message.error')&&!f.submit().disabled);
 const original=JSON.stringify(f.dom.window.f.writes[1]);
 f.dom.window.reopen();await f.wait(()=>!f.d.querySelector('form'));f.dom.window.renderBalance(72);await f.wait(()=>!!f.d.querySelector('[name="amount"]')&&key()===k2);
 assert.equal(f.input().value,'24');f.dom.window.f.mode='success';f.submit().click();await f.wait(()=>f.input()?.max==='48.00');
 assert.equal(JSON.stringify(f.dom.window.f.writes[2]),original);assert.notEqual(key(),k2);
 assert.equal(f.dom.window.sessionStorage.length,0);
 const completedKey=f.dom.window.f.writes[2].operationId;
 f.dom.window.reopen();await f.wait(()=>!f.d.querySelector('form'));f.dom.window.renderBalance(48);await f.wait(()=>!!f.d.querySelector('[name="operationId"]')&&!!key());assert.notEqual(key(),completedKey);
 }finally{f.dom.window.close();}
});
test('successful partial refund reloads authoritative balance before another fresh request',async()=>{
 const f=await setup();try{
 f.input().value='48.00';(f.d.querySelector('[name="reason"]') as HTMLTextAreaElement).value='Partial refund';f.submit().click();
 await f.wait(()=>f.input()?.max==='48.00');
 assert.equal(f.input().value,'48.00');assert.equal(f.dom.window.f.writes.length,1);
 assert.equal(f.dom.window.f.remaining,48);assert.equal(f.dom.window.f.reads,2);
 }finally{f.dom.window.close();}
});
test('server-page balance refresh on same invoice/payment invalidates cached read DTO',async()=>{
 const f=await setup();try{
 f.dom.window.f.remaining=48;f.dom.window.renderBalance(48);
 await f.wait(()=>f.input()?.max==='48.00');assert.equal(f.input().value,'48.00');
 assert.equal(f.dom.window.f.writes.length,0);
 }finally{f.dom.window.close();}
});
test('pending and rejected request retain original amount, reason and operation ID',async()=>{
 const f=await setup();try{
 f.dom.window.f.mode='pending';f.input().value='48.00';(f.d.querySelector('[name="reason"]') as HTMLTextAreaElement).value='Original reason';
 f.submit().click();await f.wait(()=>f.dom.window.f.writes.length===1&&f.submit().disabled);
 const request=JSON.parse(JSON.stringify(f.dom.window.f.writes[0]));assert.equal(f.dom.window.f.reads,1);
 f.dom.window.f.finish({status:'error',message:'Retry the same request'});
 await f.wait(()=>!!f.d.querySelector('.form-message.error')&&!f.submit().disabled);
 assert.equal(f.input().value,'48.00');assert.equal((f.d.querySelector('[name="reason"]') as HTMLTextAreaElement).value,'Original reason');
 assert.equal((f.d.querySelector('[name="operationId"]') as HTMLInputElement).value,request.operationId);assert.equal(f.dom.window.f.reads,1);
 }finally{f.dom.window.close();}
});
