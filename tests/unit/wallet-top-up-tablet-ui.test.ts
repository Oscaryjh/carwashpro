import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";

const { JSDOM } = createRequire(import.meta.url)("jsdom");
const offer = {id:"offer-a",version:7,name:"Credit A",paidAmount:"1000.00",bonusAmount:"100.00",totalCredited:"1100.00"};
const second = {...offer,id:"offer-b",name:"Credit B",paidAmount:"50.00",bonusAmount:"5.00",totalCredited:"55.00"};
const methods = [
  {code:"BUILTIN_CASH",label:"Cash"}, {code:"BUILTIN_CARD",label:"Card"},
  {code:"BUILTIN_DUITNOW",label:"DuitNow QR"}, {code:"BUILTIN_EWALLET",label:"E-Wallet"},
  {code:"BUILTIN_BANK_TRANSFER",label:"Bank Transfer"},
];
let script: string;
async function fixture(offers = [offer], paymentMethods = methods, multiBranch = false) {
  if (!script) {
    const bundle = await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {WalletTopUpModal} from './src/components/wallet/wallet-top-up-modal';import {WalletDialog} from './src/components/wallet/wallet-dialog';HTMLDialogElement.prototype.showModal=function(){this.open=true};HTMLDialogElement.prototype.close=function(){this.open=false};createRoot(document.getElementById('root')).render(<><WalletTopUpModal intentScope="tablet-test" customerId="customer" customerName="Customer" balance="1100.00" onClose={()=>{}} onSuccess={()=>{}}/><WalletDialog title="Other wallet dialog" onClose={()=>{}}>Other content</WalletDialog></>);`,resolveDir:process.cwd(),loader:"tsx"},write:false,bundle:true,platform:"browser",format:"iife",jsx:"automatic",loader:{".css":"empty"},plugins:[{name:"remote-and-dialog-boundaries",setup(b){
      b.onResolve({filter:/^@\/app\/.*\/crm\/wallet\/actions$/},()=>({path:"actions",namespace:"wallet-tablet"}));
      b.onLoad({filter:/.*/,namespace:"wallet-tablet"},({path})=>({contents:path === "actions" ? `export async function walletTopUpOptionsAction(){return {ok:true,data:window.fixture.options}};export async function walletTopUpAction(form){window.fixture.requests.push(Object.fromEntries(form));return window.fixture.response;}` : `import React from 'react';export function WalletDialog({children}){return <section>{children}</section>}`,loader:"tsx",resolveDir:process.cwd()}));
    }}]});
    script = bundle.outputFiles[0].text;
  }
  const data = {options:{offers,paymentMethods,branches:multiBranch ? [{id:"branch",name:"Local"},{id:"other",name:"Other"}] : [{id:"branch",name:"Local"}],activity:{modeAtConfirmation:"OFF",branchId:"branch",shiftId:null}},requests:[] as Record<string,string>[],response:{ok:false,uncertain:true,message:"Unknown result"} as Record<string,unknown>};
  const css = await readFile("src/components/wallet/wallet.css", "utf8") + "\n" + await readFile("src/components/wallet/wallet-top-up-modal.css", "utf8");
  const dom = new JSDOM(`<style>${css}</style><div id="root"></div><script>${script}</script>`,{runScripts:"dangerously",url:"http://disposable-ui.test",beforeParse(window: {fixture: unknown}){window.fixture=data;}});
  const document = dom.window.document as Document;
  async function wait(predicate:()=>boolean) { const deadline=Date.now()+5000;while(!predicate()){assert.ok(Date.now()<deadline,"client did not settle");await new Promise(resolve=>setTimeout(resolve,10));} }
  await wait(()=>!!document.querySelector(".wallet-top-up-fields") && Array.from(document.querySelectorAll("button")).some(b=>b.textContent==="Confirm top-up"));
  const buttons = (kind:string) => Array.from(document.querySelectorAll<HTMLButtonElement>(`.wallet-${kind}`));
  const named = (name:string) => {const button=Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(b=>b.textContent===name);assert.ok(button,`Missing ${name}; buttons: ${Array.from(document.querySelectorAll("button")).map(b=>b.textContent).join(" | ")}`);return button;};
  return {dom,document,data,wait,buttons,named};
}

test("single offer automatically selects its card and submits unchanged amounts, method code and reference", async()=>{
  const f=await fixture();try {
    const cards=f.buttons("offer-card");assert.equal(cards.length,1);assert.equal(cards[0].getAttribute("aria-pressed"),"true");
    assert.match(cards[0].textContent!,/RM1,000/);assert.match(cards[0].textContent!,/\+ RM100 bonus/);assert.match(cards[0].textContent!,/Wallet receives RM1,100/);
    assert.equal(f.named("Confirm top-up").disabled,false);
    const reference=f.document.querySelector<HTMLInputElement>("input[maxlength='500']")!;
    const setter=Object.getOwnPropertyDescriptor(f.dom.window.HTMLInputElement.prototype,"value")!.set!;
    setter.call(reference,"terminal-123");reference.dispatchEvent(new f.dom.window.Event("input",{bubbles:true}));
    await new Promise(resolve=>setTimeout(resolve,0));
    f.named("Confirm top-up").click();await f.wait(()=>f.data.requests.length===1);
    assert.equal(f.data.requests[0].offerId,"offer-a");assert.equal(f.data.requests[0].expectedOfferVersion,"7");
    assert.equal(f.data.requests[0].paymentMethodCode,"BUILTIN_CASH");assert.equal(f.data.requests[0].reference,"terminal-123");
    assert.equal(f.data.requests[0].branchId,"branch");assert.equal(f.data.requests[0].shiftId,"");
  } finally {f.dom.window.close();}
});

test("only top-up gets the wide dialog class and compact customer, offer and three-part money layout",async()=>{
  const f=await fixture();try{
    const dialog=f.document.querySelector("dialog.wallet-top-up-dialog");assert.ok(dialog);
    assert.equal(f.document.querySelectorAll("dialog.wallet-top-up-dialog").length,1);
    const other=Array.from(f.document.querySelectorAll("dialog")).find(d=>d.textContent?.includes("Other content"));assert.ok(other);assert.equal(other.className,"wallet-dialog wallet-ui");
    assert.equal(dialog.querySelectorAll(".wallet-top-up-customer > div").length,2);
    assert.equal(dialog.querySelectorAll(".wallet-offer-copy").length,1);
    assert.equal(dialog.querySelector(".wallet-offer-amount")!.textContent,"RM1,000");
    assert.equal(dialog.querySelectorAll(".wallet-top-up-summary > div").length,3);
    assert.match(dialog.querySelector(".wallet-top-up-summary")!.textContent!,/Wallet receivesRM 1,100.00/);
    assert.match(dialog.querySelector(".wallet-top-up-balance-after")!.textContent!,/Balance after top-upRM 2,200.00/);
    assert.equal(dialog.querySelectorAll(".wallet-payment-grid button").length,5);
    assert.ok(dialog.querySelector('input[maxlength="500"]'));
    f.data.response={ok:false,uncertain:true,message:"A long validation message must remain fully available without clipping or losing confirmation controls."};
    f.named("Confirm top-up").click();await f.wait(()=>!!dialog.querySelector('[role="alert"]'));
    assert.equal(dialog.querySelector('[role="alert"]')!.textContent,f.data.response.message);
    await f.wait(()=>Array.from(dialog.querySelectorAll("button")).some(b=>b.textContent==="Retry same confirmation"));
  }finally{f.dom.window.close();}
});

test("top-up reduces vertical spacing without shrinking touch controls or hiding parent overflow",async()=>{
  const f=await fixture();try{
    const dialog=f.document.querySelector("dialog.wallet-top-up-dialog")!;
    const style=(selector:string)=>f.dom.window.getComputedStyle(dialog.querySelector(selector)!);
    const parent=f.dom.window.getComputedStyle(dialog);
    assert.equal(parent.maxWidth,"960px");
    assert.equal(parent.overflowY,"auto");
    assert.ok(!parent.height || parent.height==="auto");
    assert.notEqual(parent.scrollbarWidth,"none");
    // This is a spacing contract, NOT a scrollHeight/viewport assertion: jsdom has no layout engine.
    const verticalPadding=(s:CSSStyleDeclaration)=>parseFloat(s.paddingTop)+parseFloat(s.paddingBottom);
    assert.ok(verticalPadding(parent)<=24,"parent padding must leave room for the footer");
    assert.ok(parseFloat(style(":scope > header").marginBottom)<=8,"compact title/body gap");
    assert.ok(parseFloat(style(".wallet-top-up-customer").marginBottom)<=8);
    assert.ok(parseFloat(style(".wallet-top-up-fields").gap)<=8,"section gaps must not accumulate excess height");
    assert.ok(verticalPadding(style(".wallet-top-up-summary > div"))<=12);
    assert.ok(verticalPadding(style(".wallet-note"))<=10);
    assert.ok(parseFloat(style(".wallet-top-up-fields > label").gap)<=4);
    const close=style('header button');
    assert.ok(parseFloat(close.minHeight)>=44,"Close retains a touch-friendly target");
    const payment=style(".wallet-payment-choice");
    assert.ok(parseFloat(payment.minHeight)>=44 && parseFloat(payment.minHeight)<=48);
    assert.equal(style(".wallet-payment-grid").gridTemplateColumns,"repeat(5, minmax(0, 1fr))");
    assert.equal(style(".wallet-top-up-summary").gridTemplateColumns,"repeat(3, minmax(0, 1fr))");
    assert.ok(dialog.contains(f.named("Cancel")));assert.ok(dialog.contains(f.named("Confirm top-up")));
    assert.match(dialog.querySelector(".wallet-note")!.textContent!,/Confirm after receiving payment.*does not charge the customer/);
    for(const selector of [".wallet-top-up-modal",".wallet-top-up-fields","footer"]){
      const s=style(selector);assert.ok(!s.height || s.height==="auto");
      assert.ok(!s.maxHeight || s.maxHeight==="none");assert.notEqual(s.overflowY,"hidden");
    }
    const other=f.document.querySelector("dialog:not(.wallet-top-up-dialog)")!;
    const otherStyle=f.dom.window.getComputedStyle(other);
    assert.equal(otherStyle.paddingTop,"24px");
    assert.equal(f.dom.window.getComputedStyle(other.querySelector("header")).marginBottom,"18px");
  }finally{f.dom.window.close();}
});

test("1, 2 and 5 offers are unbounded direct grids; 6 offers use only horizontal scrolling",async()=>{
  for(const count of [1,2,5,6]){
    const offers=Array.from({length:count},(_,index)=>({...offer,id:`offer-${index}`,name:`Custom ${index}`}));
    const f=await fixture(offers);try{
      const grid=f.document.querySelector<HTMLElement>(".wallet-offer-grid")!;
      assert.equal(grid.getAttribute("data-offer-count"),String(count));
      assert.equal(grid.classList.contains("wallet-offer-scroll"),count>5);
      const style=f.dom.window.getComputedStyle(grid);
      assert.ok(!style.maxHeight || style.maxHeight==="none");
      if(count>5){assert.equal(style.display,"flex");assert.equal(style.overflowX,"auto");assert.equal(style.overflowY,"hidden");assert.equal(style.scrollSnapType,"x proximity");}
      else {assert.equal(style.display,"grid");assert.equal(style.overflowX,"hidden");assert.equal(style.overflowY,"hidden");}
      assert.deepEqual(f.buttons("offer-card").map(b=>b.value),offers.map(o=>o.id));
    }finally{f.dom.window.close();}
  }
});

test("only exact amount-like Top Up names are hidden; custom, malformed and different-amount names remain",async()=>{
  for(const [name,hidden] of [["Top Up 3000",true],["Top up RM3,000",true],["TOP UP RM 3,000.00",true],["Birthday credit",false],["Top Up 3000 VIP",false],["Top Up 300",false],["Top Up 30,00",false]] as const){
    const f=await fixture([{...offer,name,paidAmount:"3000.00",bonusAmount:"550.00",totalCredited:"3550.00"}]);try{
      const card=f.buttons("offer-card")[0];const label=card.querySelector(".wallet-offer-heading");
      assert.equal(label?.textContent??null,hidden?null:name);
      assert.equal(card.querySelector(".wallet-offer-amount")!.textContent,"RM3,000");
      assert.match(card.textContent!,/\+ RM550 bonus/);assert.match(card.textContent!,/Wallet receives RM3,550/);
      assert.equal(card.getAttribute("aria-pressed"),"true");
    }finally{f.dom.window.close();}
  }
});

test("long custom names remain intact without a fixed offer area or card height",async()=>{
  const name="Custom celebration credit for returning customers with a deliberately long descriptive name";
  for(const count of [2,5,6]){
    const f=await fixture(Array.from({length:count},(_,index)=>({...offer,id:`long-${index}`,name})));try{
      const grid=f.document.querySelector<HTMLElement>(".wallet-offer-grid")!;
      const gridStyle=f.dom.window.getComputedStyle(grid);
      assert.equal(gridStyle.overflowY,"hidden");assert.ok(!gridStyle.height || gridStyle.height==="auto");assert.ok(!gridStyle.maxHeight || gridStyle.maxHeight==="none");
      for(const card of f.buttons("offer-card")){
        assert.equal(card.querySelector(".wallet-offer-heading")!.textContent,name);
        const style=f.dom.window.getComputedStyle(card);
        assert.ok(!style.height || style.height==="auto");assert.ok(!style.maxHeight || style.maxHeight==="none");
      }
    }finally{f.dom.window.close();}
  }
});

test("multiple cards preserve server order and require explicit exclusive selection",async()=>{
  const f=await fixture([second,offer]);try{
    const cards=f.buttons("offer-card");assert.deepEqual(cards.map(b=>b.value),["offer-b","offer-a"]);
    assert.ok(cards.every(b=>b.getAttribute("aria-pressed")==="false"));assert.equal(f.named("Confirm top-up").disabled,true);
    cards[1].click();await f.wait(()=>cards[1].getAttribute("aria-pressed")==="true");
    cards[0].click();await f.wait(()=>cards[0].getAttribute("aria-pressed")==="true");
    assert.equal(cards[1].getAttribute("aria-pressed"),"false");
    f.named("Confirm top-up").click();await f.wait(()=>f.data.requests.length===1);assert.equal(f.data.requests[0].offerId,"offer-b");
  }finally{f.dom.window.close();}
});

test("no active offer cannot manufacture a zero offer or submit",async()=>{
  const f=await fixture([]);try{assert.equal(f.buttons("offer-card").length,0);assert.match(f.document.body.textContent!,/No active top-up offers/);assert.equal(f.named("Confirm top-up").disabled,true);f.named("Confirm top-up").click();assert.equal(f.data.requests.length,0);}finally{f.dom.window.close();}
});

test("all returned payment methods are native accessible buttons; selected Card uses its exact code",async()=>{
  const f=await fixture();try{
    const buttons=f.buttons("payment-choice");assert.deepEqual(buttons.map(b=>b.value),methods.map(m=>m.code));
    assert.ok(buttons.every(b=>b.type==="button"&&!b.disabled));assert.equal(buttons[0].getAttribute("aria-pressed"),"true");
    buttons[1].focus();assert.equal(f.document.activeElement,buttons[1]);
    buttons[1].click();await f.wait(()=>buttons[1].getAttribute("aria-pressed")==="true");assert.equal(buttons[0].getAttribute("aria-pressed"),"false");
    f.named("Confirm top-up").click();await f.wait(()=>f.data.requests.length===1);assert.equal(f.data.requests[0].paymentMethodCode,"BUILTIN_CARD");
  }finally{f.dom.window.close();}
});

test("payment defaults to server first item, not forced Cash; empty methods prevent confirm",async()=>{
  for(const paymentMethods of [[methods[1],methods[0]],[]]){
    const f=await fixture([offer],paymentMethods);try{
      if(paymentMethods.length)assert.equal(f.buttons("payment-choice")[0].getAttribute("aria-pressed"),"true");
      else assert.equal(f.named("Confirm top-up").disabled,true);
    }finally{f.dom.window.close();}
  }
});

test("pending retry and mode reconfirm keep original offer, method, branch and key despite refreshed defaults",async()=>{
  for(const modeChanged of [false,true]){
    const f=await fixture();try{
      f.buttons("payment-choice")[1].click();await f.wait(()=>f.buttons("payment-choice")[1].getAttribute("aria-pressed")==="true");
      if(modeChanged)f.data.response={ok:false,code:"CASHIER_SHIFT_MODE_CHANGED",message:"Review settings"};
      f.data.options={...f.data.options,offers:[second],paymentMethods:[methods[0]]};
      f.named("Confirm top-up").click();await f.wait(()=>f.data.requests.length===1);
      const original={...f.data.requests[0]};
      await f.wait(()=>Array.from(f.document.querySelectorAll("button")).some(b=>b.textContent===(modeChanged?"Confirm with current cashier settings":"Retry same confirmation")&&!b.disabled));
      assert.match(f.document.body.textContent!,/Credit A/);assert.match(f.document.body.textContent!,/Card/);
      f.named(modeChanged?"Confirm with current cashier settings":"Retry same confirmation").click();await f.wait(()=>f.data.requests.length===2);
      assert.deepEqual({...f.data.requests[1]},original);
    }finally{f.dom.window.close();}
  }
});

test("valid chosen offer and payment survive an options reload without reverting to first method",async()=>{
  const f=await fixture([offer,second],methods,true);try{
    f.buttons("offer-card")[1].click();f.buttons("payment-choice")[1].click();
    await f.wait(()=>f.buttons("payment-choice")[1].getAttribute("aria-pressed")==="true");
    f.data.options={...f.data.options,activity:{...f.data.options.activity,branchId:"other"}};
    const select=f.document.querySelector<HTMLSelectElement>('select[aria-label="Collection branch"]')!;
    select.value="other";select.dispatchEvent(new f.dom.window.Event("change",{bubbles:true}));
    await f.wait(()=>select.value==="other" && Array.from(f.document.querySelectorAll("button")).some(b=>b.textContent==="Confirm top-up"&&!b.disabled));
    assert.equal(f.buttons("offer-card")[1].getAttribute("aria-pressed"),"true");
    assert.equal(f.buttons("payment-choice")[1].getAttribute("aria-pressed"),"true");
    f.named("Confirm top-up").click();await f.wait(()=>f.data.requests.length===1);
    assert.equal(f.data.requests[0].paymentMethodCode,"BUILTIN_CARD");assert.equal(f.data.requests[0].offerId,"offer-b");
  }finally{f.dom.window.close();}
});
