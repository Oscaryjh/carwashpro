import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { cashierProps, cashierCustomer, cashierItem } from "../helpers/cashier-ui-fixture";

const { JSDOM } = createRequire(import.meta.url)("jsdom");
const paymentMethods=[
  ["CASH","Cash","BUILTIN_CASH"],["CARD","Card","BUILTIN_CARD"],["DUITNOW","DuitNow QR","BUILTIN_DUITNOW"],
  ["EWALLET","E-Wallet","BUILTIN_EWALLET"],["BANK_TRANSFER","Bank Transfer","BUILTIN_BANK_TRANSFER"],["CASH","Training / Complimentary","TRAINING_COMPLIMENTARY"],
].map(([canonicalMethod,label,code])=>({...cashierProps.paymentMethods[0],canonicalMethod,label,code,behavior:code==="TRAINING_COMPLIMENTARY"?"TRAINING_COMPLIMENTARY":"STANDARD_TENDER"}));
let script:string;
async function fixture(enabled=true, pendingRaw?:string, overrides:Record<string,unknown>={}){
  if(!script){
    const stubs:Record<string,string>={
      "next/navigation":"export const useRouter=()=>({refresh(){}});",
      "@/components/wallet/member-wallet-summary":"export const MemberWalletSummary=()=>null;",
      "@/components/performance/checkout-attribution":"export const CheckoutAttribution=()=>null;",
      "@/components/appointment-invoice-modal":"export const AppointmentInvoiceModal=()=>null;",
      "@/components/package-customer-picker":"import React,{useState} from 'react';export function PackageCustomerPicker(props){const [customer,setCustomer]=useState(props.initialCustomer);window.chooseCustomer=value=>{setCustomer(value);props.onSelectionChange(value)};return <input type='hidden' name='customerId' value={customer?.id??''}/>;}",
      "@/app/(business)/crm/wallet/actions":"export const walletPanelAction=id=>new Promise((resolve,reject)=>window.fixture.reads.push({id,resolve,reject}));",
      "@/app/(business)/cashier/actions":`export function cashierActivityOptionsAction(){throw Error('Unexpected activity read')} export function cashierPointsOptionsAction(customerId){return new Promise((resolve,reject)=>{window.fixture.pointsReads.push({customerId,resolve,reject});if(!window.fixture.holdPoints){const p=window.fixture.props;resolve({ok:true,data:{customerId,membershipStatus:'ACTIVE',availablePoints:p.initialSale.customer.loyaltyPoints,settings:p.loyaltySettings}})}})}`,
      "@/app/(business)/closing/actions":"export function startShiftAction(){throw Error('Unexpected shift write')}",
    };
    const built=await build({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import{CashierUnifiedSaleForm}from'./src/components/cashier-unified-sale-form';HTMLElement.prototype.scrollIntoView=function(){};createRoot(document.getElementById('root')).render(<CashierUnifiedSaleForm {...window.fixture.props} action={async form=>{window.fixture.writes.push([...form]);if(window.fixture.hold)return new Promise(resolve=>window.fixture.finish=resolve);return{status:'error',message:'Fixture retained request'}}}/>);`,resolveDir:process.cwd(),loader:"tsx"},write:false,bundle:true,platform:"browser",format:"iife",jsx:"automatic",loader:{".css":"empty"},plugins:[{name:"payment-io",setup(b){
      b.onResolve({filter:/.*/},a=>stubs[a.path]?{path:a.path,namespace:"payment-io"}:undefined);
      b.onLoad({filter:/.*/,namespace:"payment-io"},a=>({contents:stubs[a.path],loader:"tsx",resolveDir:process.cwd()}));
      b.onLoad({filter:/\.module\.css$/},async a=>({contents:`export default ${JSON.stringify(Object.fromEntries([...((await readFile(a.path,"utf8")).matchAll(/\.([a-zA-Z][\w-]*)/g))].map(m=>[m[1],m[1]])))}`,loader:"js"}));
    }}]});script=built.outputFiles[0].text;
  }
  const data={pointsReads:[] as {customerId:string;resolve:(value:unknown)=>void;reject:(error:Error)=>void}[],holdPoints:false,reads:[] as {id:string;resolve:(value:unknown)=>void;reject:(error:Error)=>void}[],writes:[] as [string,FormDataEntryValue][][],props:{...cashierProps,paymentMethods,action:undefined,walletCheckoutEnabled:enabled,cashierShiftsEnabled:false,initialSale:{appointmentId:"appointment",assignedStaffId:"staff",customer:cashierCustomer,lines:[{...cashierItem,type:"product",price:200,quantity:1}]}}};
  Object.assign(data.props,overrides);
  const css=await readFile("src/components/cashier-pos-preview.module.css","utf8");
  const dom=new JSDOM(`<style>${css}</style><div id="root"></div><script>${script}</script>`,{runScripts:"dangerously",url:"http://disposable-ui.test",beforeParse(w:{fixture:typeof data;sessionStorage:Storage;fetch:(url:string)=>Promise<unknown>}){w.fixture=data;if(pendingRaw)w.sessionStorage.setItem('wallet-checkout:wallet-scope:branch',pendingRaw);w.fetch=async(url:string)=>{if(url.startsWith('/api/cashier/customer-packages?')&&overrides.testPackages)return{ok:true,json:async()=>({packages:overrides.testPackages})};throw Error('Unexpected fetch')};}});
  const d=dom.window.document as Document;
  const wait=async(fn:()=>boolean)=>{const end=Date.now()+3000;while(!fn()){assert.ok(Date.now()<end,"client did not settle");await new Promise(r=>setTimeout(r,10));}};
  const button=(text:string,root:ParentNode=d)=>Array.from(root.querySelectorAll<HTMLButtonElement>("button")).find(b=>b.textContent===text)!;
  await wait(()=>!!d.querySelector('.payButton'));
  if(!pendingRaw){(d.querySelector('.payButton') as HTMLButtonElement).click();await wait(()=>!!d.querySelector('[aria-label="Payment"]'));}
  else await wait(()=>!!d.querySelector('[aria-label="Pending wallet checkout"]'));
  const expandWallet=async()=>{await wait(()=>!!d.querySelector('.paymentWallet > button:not(:disabled)'));(d.querySelector('.paymentWallet > button') as HTMLButtonElement).click();await wait(()=>!!d.querySelector('[aria-label="Wallet amount (RM)"]') && d.activeElement===d.querySelector('[aria-label="Wallet amount (RM)"]'));};
  const dialog=()=>d.querySelector<HTMLElement>('[aria-label="Payment"]')!;
  const resolve=(index:number,amount:string)=>data.reads[index].resolve({ok:true,data:{totalBalance:amount,hasAccount:amount!=="0.00",intentScope:"scope",canTopUp:true,ownerDetails:null}});
  const input=(value:string)=>{const el=d.querySelector<HTMLInputElement>('[aria-label="Wallet amount (RM)"]')!;Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype,"value")!.set!.call(el,value);el.dispatchEvent(new dom.window.Event("input",{bubbles:true}));};
  return{dom,d,data,wait,button,dialog,resolve,input,expandWallet};
}

const pointsResult=(customerId= cashierCustomer.id, availablePoints=2000, settings:Record<string,unknown>={}, membershipStatus:string|null="ACTIVE")=>({ok:true,data:{customerId,availablePoints,membershipStatus,settings:{enabled:true,redemptionEnabled:true,pointsPerRinggit:100,minimumPoints:500,...settings}}});

for(const quantity of [1,2]) test(`Package coverage quantity ${quantity} explains zero eligible value without treating it as low balance`,async()=>{
 const f=await fixture(false,undefined,{loyaltySettings:{enabled:true,redemptionEnabled:true,pointsPerRinggit:100,minimumPoints:100},
   initialSale:{appointmentId:"appointment",assignedStaffId:"staff",customer:{...cashierCustomer,loyaltyPoints:2000},lines:[{...cashierItem,type:"service",price:200,quantity}]},
   testPackages:[{id:"balance",customerPackageId:"package",name:"Test package",serviceId:cashierItem.id,serviceName:cashierItem.name,totalUses:3,remainingUses:3}]});
 try{
   await f.wait(()=>!!f.d.querySelector('.customerPackageOptions button'));
   (f.d.querySelector('.customerPackageOptions button') as HTMLButtonElement).click();
   await new Promise(r=>setTimeout(r,20));await openPoints(f);
   await f.wait(()=>f.data.pointsReads.length===1);await new Promise(r=>setTimeout(r,20));
   if(quantity===1){assert.match(f.d.querySelector('.adjustmentDialog')!.textContent!,/Points are not needed for this order\./);assert.doesNotMatch(f.d.querySelector('.adjustmentDialog')!.textContent!,/Not enough points/);assert.equal(f.button("Use max").disabled,true);}
   else{assert.doesNotMatch(f.d.querySelector('.adjustmentDialog')!.textContent!,/Points are not needed/);assert.equal(f.button("Use max").disabled,false);}
   assert.equal(f.d.querySelector<HTMLInputElement>('[name="loyaltyPoints"]')!.value,"0");assert.equal(f.data.writes.length,0);
 }finally{f.dom.window.close();}
});

test("Package purchase remains eligible for Points and is not redemption coverage",async()=>{
 const f=await fixture(false,undefined,{initialSale:{customer:{...cashierCustomer,loyaltyPoints:2000},lines:[{...cashierItem,type:"package",price:200,quantity:1}]}});
 try{await openPoints(f);await f.wait(()=>!f.button("Use max").disabled);assert.doesNotMatch(f.d.querySelector('.adjustmentDialog')!.textContent!,/Points are not needed/);}finally{f.dom.window.close();}
});
async function openPoints(f:Awaited<ReturnType<typeof fixture>>){
 (f.d.querySelector('.adjustmentsToggle') as HTMLButtonElement).click();await f.wait(()=>!!f.d.querySelector('.adjustmentDialog'));
 f.button("Points").click();await f.wait(()=>f.data.pointsReads.length>0);
}
for(const [name,status,settings,balance] of [
 ["inactive","INACTIVE",{},2000],["missing",null,{},0],["program off","ACTIVE",{enabled:false},2000],
 ["redemption off","ACTIVE",{redemptionEnabled:false},2000],["below minimum","ACTIVE",{},499],
] as const)test(`Points ${name} disables redemption without creating eligibility`,async()=>{
 const f=await fixture(false);try{f.data.holdPoints=true;await openPoints(f);
  f.data.pointsReads[0].resolve(pointsResult(cashierCustomer.id,balance,settings,status));await new Promise(r=>setTimeout(r,20));
  assert.equal(f.button("Apply").disabled,true);assert.equal(f.button("Use max").disabled,true);
  assert.equal((f.d.querySelector('[aria-label="Points to redeem"]') as HTMLInputElement).disabled,true);
  assert.doesNotMatch(f.d.querySelector('.adjustmentDialog')!.textContent!,/Loyalty member/);
  assert.match(f.d.querySelector('.adjustmentDialog')!.textContent!,name==="below minimum"?/Not enough points/:/Points unavailable/);
 }finally{f.dom.window.close();}
});
test("Points failed read retries, while Cancel leaves cash checkout available",async()=>{
 const f=await fixture(false);try{f.data.holdPoints=true;await openPoints(f);f.data.pointsReads[0].reject(Error("offline"));
  await f.wait(()=>!!f.button("Retry"));assert.equal(f.button("Apply").disabled,true);
  f.button("Retry").click();await f.wait(()=>f.data.pointsReads.length===2);
  f.data.pointsReads[1].resolve(pointsResult());await f.wait(()=>!f.button("Use max").disabled);
  f.button("Cancel",f.d.querySelector('.adjustmentDialog')!).click();await f.wait(()=>!f.d.querySelector('.adjustmentDialog'));
  assert.equal(f.d.querySelector<HTMLInputElement>('[name="loyaltyPoints"]')!.value,"0");
  f.button("Exact RM200.00").click();await f.wait(()=>!!f.button("Confirm payment · RM200.00")&&!f.button("Confirm payment · RM200.00").disabled);
 }finally{f.dom.window.close();}
});
test("Points reopen refresh cannot silently change committed allocation; Cancel preserves it",async()=>{
 const f=await fixture(false);try{f.data.holdPoints=true;await openPoints(f);f.data.pointsReads[0].resolve(pointsResult());
  await f.wait(()=>!f.button("Use max").disabled);f.button("Use max").click();await new Promise(r=>setTimeout(r,10));f.button("Apply").click();await f.wait(()=>!f.d.querySelector('.adjustmentDialog'));
  assert.equal(f.d.querySelector<HTMLInputElement>('[name="loyaltyPoints"]')!.value,"2000");
  await openPoints(f);await f.wait(()=>f.data.pointsReads.length===2);assert.equal(f.button("Apply").disabled,true);
  f.data.pointsReads[1].resolve(pointsResult(cashierCustomer.id,700));await f.wait(()=>!f.button("Use max").disabled);
  assert.match(f.d.querySelector('.adjustmentDialog')!.textContent!,/Points availability has changed/);
  assert.match(f.d.querySelector('.adjustmentDialog')!.textContent!,/Remaining points0 pts/);
  assert.equal(f.d.querySelector<HTMLInputElement>('[name="loyaltyPoints"]')!.value,"2000");
  f.button("Cancel",f.d.querySelector('.adjustmentDialog')!).click();await f.wait(()=>!f.d.querySelector('.adjustmentDialog'));
  assert.equal(f.d.querySelector<HTMLInputElement>('[name="loyaltyPoints"]')!.value,"2000");
 }finally{f.dom.window.close();}
});
test("Points customer change clears applied points and ignores out-of-order old customer response",async()=>{
 const f=await fixture(false);try{f.data.holdPoints=true;await openPoints(f);f.data.pointsReads[0].resolve(pointsResult());
  await f.wait(()=>!f.button("Use max").disabled);f.button("Use max").click();await new Promise(r=>setTimeout(r,10));f.button("Apply").click();await f.wait(()=>!f.d.querySelector('.adjustmentDialog'));
  await openPoints(f);await f.wait(()=>f.data.pointsReads.length===2);
  f.dom.window.chooseCustomer({...cashierCustomer,id:"customer-b",loyaltyPoints:9999});await f.wait(()=>f.data.pointsReads.length===3);
  assert.equal(f.d.querySelector<HTMLInputElement>('[name="loyaltyPoints"]')!.value,"0");
  f.data.pointsReads[2].resolve(pointsResult("customer-b",500));await f.wait(()=>!f.button("Use max").disabled);
  f.data.pointsReads[1].resolve(pointsResult(cashierCustomer.id,9000));await new Promise(r=>setTimeout(r,20));
  assert.match(f.d.querySelector('.pointsBalance')!.textContent!,/500 pts/);assert.doesNotMatch(f.d.querySelector('.pointsBalance')!.textContent!,/9,000/);
  f.dom.window.chooseCustomer(null);await new Promise(r=>setTimeout(r,20));
  assert.match(f.d.querySelector('.adjustmentDialog')!.textContent!,/Select a customer to use points/);assert.equal(f.button("Apply").disabled,true);
 }finally{f.dom.window.close();}
});

test("Points draft retains fresh rate across Discount tab and Apply",async()=>{
 const f=await fixture(false);try{f.data.holdPoints=true;await openPoints(f);f.data.pointsReads[0].resolve(pointsResult(cashierCustomer.id,1000,{pointsPerRinggit:250}));await f.wait(()=>!f.button("Use max").disabled);
  f.button("Use max").click();await new Promise(r=>setTimeout(r,20));assert.match(f.d.querySelector('.adjustmentPreview')!.textContent!,/−RM4.00/);
  f.button("Discount").click();await new Promise(r=>setTimeout(r,20));assert.match(f.d.querySelector('.adjustmentPreview')!.textContent!,/−RM4.00/);
  f.button("Apply").click();await f.wait(()=>!f.d.querySelector('.adjustmentDialog'));
  assert.equal(f.d.querySelector<HTMLInputElement>('[name="loyaltyPoints"]')!.value,"1000");assert.ok(f.button("Pay RM196.00"));
 }finally{f.dom.window.close();}
});
test("Points fresh rate and order cap reuse canonical maximum; draft1000 leaves1000",async()=>{
 const f=await fixture(false);try{f.data.holdPoints=true;await openPoints(f);f.data.pointsReads[0].resolve(pointsResult());await f.wait(()=>!f.button("Use max").disabled);
  (f.d.querySelector('[aria-label="Points to redeem"]') as HTMLInputElement).click();await f.wait(()=>!!f.d.querySelector('[aria-label="Points to redeem keypad"]'));
  const pad=f.d.querySelector('[aria-label="Points to redeem keypad"]')!;for(const digit of ["1","0","0","0"]){f.button(digit,pad).click();await new Promise(r=>setTimeout(r,10));}f.button("Done",pad).click();await f.wait(()=>!f.d.querySelector('[aria-label="Points to redeem keypad"]'));
  assert.match(f.d.querySelector('.pointsPreview')!.textContent!,/Remaining points1,000 pts/);
  assert.equal(f.d.querySelector<HTMLInputElement>('[name="loyaltyPoints"]')!.value,"0");
  f.button("Cancel",f.d.querySelector('.adjustmentDialog')!).click();await f.wait(()=>!f.d.querySelector('.adjustmentDialog'));
  await openPoints(f);await f.wait(()=>f.data.pointsReads.length===2);f.data.pointsReads[1].resolve(pointsResult(cashierCustomer.id,1499,{pointsPerRinggit:250}));await f.wait(()=>!f.button("Use max").disabled);
  f.button("Use max").click();await new Promise(r=>setTimeout(r,20));assert.match(f.d.querySelector('.pointsBalance')!.textContent!,/250 points = RM1/);
  assert.match(f.d.querySelector('.pointsPreview')!.textContent!,/DiscountRM5.00Remaining points249 pts/);
 }finally{f.dom.window.close();}
});
test("Points cannot apply after an ordinary payment request is locked",async()=>{
 const f=await fixture(false);try{
  f.dom.window.fixture.hold=true;f.button("Exact RM200.00").click();await f.wait(()=>!!f.button("Confirm payment · RM200.00")&&!f.button("Confirm payment · RM200.00").disabled);
  f.button("Confirm payment · RM200.00").click();await f.wait(()=>f.data.writes.length===1);const original=JSON.stringify(f.data.writes[0]);
  await openPoints(f);await new Promise(r=>setTimeout(r,20));assert.equal(f.button("Apply").disabled,true);assert.equal(f.button("Use max").disabled,true);
  f.button("Apply").click();assert.equal(JSON.stringify(f.data.writes[0]),original);assert.equal(f.d.querySelector<HTMLInputElement>('[name="loyaltyPoints"]')!.value,"0");
 }finally{f.dom.window.close();}
});
test("Points fresh read replaces snapshot, shows normalized remaining and only Apply commits",async()=>{
 const f=await fixture(false);try{
  f.data.holdPoints=true;
  (f.d.querySelector('.adjustmentsToggle') as HTMLButtonElement).click();await f.wait(()=>!!f.d.querySelector('.adjustmentDialog'));
  f.button("Points").click();await new Promise(r=>setTimeout(r,30));
  assert.equal(f.data.pointsReads.length,1,"opening Points must refresh current customer");
  assert.match(f.d.querySelector('.adjustmentDialog')!.textContent!,/Refreshing points/);
  assert.equal(f.button("Apply").disabled,true);
  f.data.pointsReads[0].resolve({ok:true,data:{customerId:cashierCustomer.id,membershipStatus:"ACTIVE",availablePoints:1307,settings:{enabled:true,redemptionEnabled:true,pointsPerRinggit:100,minimumPoints:500}}});
  await f.wait(()=>!!f.button("Use max")&&!f.button("Use max").disabled);
  f.button("Use max").click();await new Promise(r=>setTimeout(r,20));
  const panel=f.d.querySelector('.adjustmentDialog')!.textContent!;
  assert.match(panel,/1,307 pts/);assert.match(panel,/100 points = RM1/);assert.match(panel,/Minimum redemption: 500 points/);
  assert.match(panel,/Remaining points7 pts/);assert.match(panel,/DiscountRM13.00/);
  assert.equal(f.d.querySelector<HTMLInputElement>('[name="loyaltyPoints"]')!.value,"0");
  f.button("Apply").click();await f.wait(()=>!f.d.querySelector('.adjustmentDialog'));
  assert.equal(f.d.querySelector<HTMLInputElement>('[name="loyaltyPoints"]')!.value,"1300");
 }finally{f.dom.window.close();}
});

for(const mode of ["catalog","amount","percent"] as const)test(`remove ${mode} discount clears committed and draft fields, restores total and preserves unrelated checkout state`,async()=>{
 const discount={id:"discount",name:"Half price",discountType:"PERCENTAGE",percentage:50,fixedAmount:null,scope:"ALL",minimumSpend:0,maximumDiscount:null,allowLoyaltyStacking:true};
 const f=await fixture(true,undefined,{catalogDiscounts:[discount]});
 const open=async()=>{(f.d.querySelector('.adjustmentsToggle') as HTMLButtonElement).click();await f.wait(()=>!!f.d.querySelector('.adjustmentDialog'));};
 try{
  await f.wait(()=>f.data.reads.length===1);f.resolve(0,"1100.00");await f.expandWallet();f.input("20");await new Promise(r=>setTimeout(r,10));f.button("Apply wallet").click();await f.wait(()=>!f.d.querySelector('[aria-label="Wallet allocation"]'));
  f.button("Custom").click();await f.wait(()=>!!f.d.querySelector('[aria-label="Cash received keypad"]'));
  const cash=f.d.querySelector('[aria-label="Cash received keypad"]')!;
  for(const digit of ["2","5","0"]){f.button(digit,cash).click();await new Promise(r=>setTimeout(r,10));}f.button("Done",cash).click();await f.wait(()=>!f.d.querySelector('[aria-label="Cash received keypad"]'));
  await open();assert.equal(f.button("Remove discount"),undefined);
  if(mode==="catalog"){
   const select=f.d.querySelector<HTMLSelectElement>('.adjustmentDialog select')!;select.value="discount";select.dispatchEvent(new f.dom.window.Event('change',{bubbles:true}));
  }else{
   if(mode==="percent"){f.button("Percentage").click();await new Promise(r=>setTimeout(r,10));}
   (f.d.querySelector('[aria-label="Discount value"]') as HTMLInputElement).click();
   const label=mode==="percent"?"Discount percentage keypad":"Discount amount keypad";
   await f.wait(()=>!!f.d.querySelector(`[aria-label="${label}"]`));const pad=f.d.querySelector(`[aria-label="${label}"]`)!;
   f.button("Clear",pad).click();await new Promise(r=>setTimeout(r,10));for(const digit of ["5","0"]){f.button(digit,pad).click();await new Promise(r=>setTimeout(r,10));}f.button("Done",pad).click();await f.wait(()=>!f.d.querySelector(`[aria-label="${label}"]`));
  }
  await new Promise(r=>setTimeout(r,10));
  const reference=f.d.querySelector<HTMLInputElement>('[placeholder="Promotion code or note"]')!;
  Object.getOwnPropertyDescriptor(f.dom.window.HTMLInputElement.prototype,"value")!.set!.call(reference,"Old promotion");reference.dispatchEvent(new f.dom.window.Event('input',{bubbles:true}));await new Promise(r=>setTimeout(r,10));
  if(mode==="catalog"){f.button("Points").click();await f.wait(()=>!!f.button("Use max")&&!f.button("Use max").disabled);f.button("Use max").click();await new Promise(r=>setTimeout(r,10));}
  f.button("Apply").click();await f.wait(()=>!f.d.querySelector('.adjustmentDialog'));
  const value=(name:string)=>f.d.querySelector<HTMLInputElement>(`[name="${name}"]`)!.value;
  const before=Array.from(new f.dom.window.FormData(f.d.querySelector('form')!).entries()) as [string,string][];
  assert.equal(value("discountReference"),"Old promotion");
  await open();assert.ok(f.button("Remove discount"),"applied discount must have an explicit remove action");
  f.dom.window.confirm=()=>{throw Error("No confirmation should be requested");};
  f.button("Remove discount").click();await f.wait(()=>!f.d.querySelector('.adjustmentDialog'));
  assert.equal(value("catalogDiscountId"),"");assert.equal(value("discountType"),"AMOUNT");assert.equal(value("discountValue"),"0");assert.equal(value("discountReference"),"");
  assert.equal(value("walletAmount"),"20");assert.equal(value("loyaltyPoints"),mode==="catalog"?"90":"0");
  assert.match(f.d.querySelector('.paymentCashReceived')!.textContent!,/RM250.00/);
  assert.ok(f.button(mode==="catalog"?"Pay RM110.00":"Pay RM200.00"));
  const exempt=new Set(["catalogDiscountId","discountType","discountValue","discountReference"]);
  const after=Array.from(new f.dom.window.FormData(f.d.querySelector('form')!).entries()) as [string,string][];
  assert.deepEqual(after.filter(([key])=>!exempt.has(key)),before.filter(([key])=>!exempt.has(key)),"all unrelated submitted state and operation key remain unchanged");
  await open();assert.equal(f.button("Remove discount"),undefined);f.button("Discount").click();await new Promise(r=>setTimeout(r,10));
  assert.equal(f.d.querySelector<HTMLSelectElement>('.adjustmentDialog select')!.value,"");assert.equal(f.d.querySelector<HTMLInputElement>('[placeholder="Promotion code or note"]')!.value,"");
  assert.equal(f.d.querySelector<HTMLInputElement>('[aria-label="Discount value"]')!.value,"0");
  const select=f.d.querySelector<HTMLSelectElement>('.adjustmentDialog select')!;select.value="discount";select.dispatchEvent(new f.dom.window.Event('change',{bubbles:true}));await new Promise(r=>setTimeout(r,10));f.button("Apply").click();await f.wait(()=>!f.d.querySelector('.adjustmentDialog'));assert.equal(value("catalogDiscountId"),"discount");
 }finally{f.dom.window.close();}
});

test("discount remove is disabled during ordinary submission and after an uncertain confirmed request",async()=>{
 const discount={id:"discount",name:"Half price",discountType:"PERCENTAGE",percentage:50,fixedAmount:null,scope:"ALL",minimumSpend:0,maximumDiscount:null,allowLoyaltyStacking:true};
 const f=await fixture(false,undefined,{catalogDiscounts:[discount]});try{
  (f.d.querySelector('.adjustmentsToggle') as HTMLButtonElement).click();await f.wait(()=>!!f.d.querySelector('.adjustmentDialog'));
  const select=f.d.querySelector<HTMLSelectElement>('.adjustmentDialog select')!;select.value="discount";select.dispatchEvent(new f.dom.window.Event('change',{bubbles:true}));await new Promise(r=>setTimeout(r,10));f.button("Apply").click();await f.wait(()=>!f.d.querySelector('.adjustmentDialog'));
  f.dom.window.fixture.hold=true;
  f.button("Exact RM100.00").click();await f.wait(()=>!!f.button("Confirm payment · RM100.00",f.dialog())&&!f.button("Confirm payment · RM100.00",f.dialog()).disabled);
  f.button("Confirm payment · RM100.00",f.dialog()).click();await f.wait(()=>f.data.writes.length===1);
  (f.d.querySelector('.adjustmentsToggle') as HTMLButtonElement).click();await f.wait(()=>!!f.button("Remove discount"));
  assert.equal(f.button("Remove discount").disabled,true);
  const original=JSON.stringify(f.data.writes[0]);const before=Array.from(new f.dom.window.FormData(f.d.querySelector('form')!).entries());
  f.button("Remove discount").click();assert.deepEqual(Array.from(new f.dom.window.FormData(f.d.querySelector('form')!).entries()),before);
  f.dom.window.fixture.finish({status:"error",message:"Unable to confirm payment"});await f.wait(()=>f.d.body.textContent!.includes("Unable to confirm payment"));
  assert.equal(f.button("Remove discount").disabled,true);assert.equal(JSON.stringify(f.data.writes[0]),original);assert.equal(f.data.writes.length,1);
 }finally{f.dom.window.close();}
});

test("package purchase wallet draft accepts full and split allocation without changing purchase payload",async()=>{
  const f=await fixture(true,undefined,{initialSale:{customer:cashierCustomer,lines:[{...cashierItem,type:"package",price:200,quantity:1}]}});
  try{
    await f.wait(()=>f.data.reads.length===1);f.resolve(0,"1100.00");await f.expandWallet();
    f.input("100");await new Promise(r=>setTimeout(r,10));
    assert.equal(f.button("Apply wallet").disabled,false);
    assert.match(f.d.querySelector('[aria-label="Wallet allocation"]')!.textContent!,/Remaining payment: RM100.00/);
    f.button("Apply wallet").click();await f.wait(()=>!f.d.querySelector('[aria-label="Wallet allocation"]'));
    assert.equal(f.d.querySelector<HTMLInputElement>('[name="walletAmount"]')!.value,"100");
    assert.equal(f.d.querySelector<HTMLInputElement>('[name="packageId"]')!.value,cashierItem.id);
    await f.expandWallet();f.button("Use max RM200.00").click();await new Promise(r=>setTimeout(r,10));
    assert.equal(f.button("Apply wallet").disabled,false);
    assert.match(f.d.querySelector('[aria-label="Wallet allocation"]')!.textContent!,/Remaining payment: RM0.00/);
    f.button("Apply wallet").click();await f.wait(()=>!f.d.querySelector('[aria-label="Wallet allocation"]'));
    assert.equal(f.d.querySelector<HTMLInputElement>('[name="walletAmount"]')!.value,"200.00");
    assert.equal(f.d.querySelector<HTMLInputElement>('[name="method"]')!.value,"MEMBER_WALLET");
  }finally{f.dom.window.close();}
});

for(const entry of ["typed","maximum-button","maximum-keypad"] as const)test(`Points ${entry}: preview, Apply, hidden payload and reopen use normalized 1300`,async()=>{
  const f=await fixture(false,undefined,{loyaltySettings:{enabled:true,redemptionEnabled:true,pointsPerRinggit:100,minimumPoints:100},initialSale:{appointmentId:"appointment",assignedStaffId:"staff",customer:{...cashierCustomer,loyaltyPoints:1307},lines:[{...cashierItem,type:"product",price:200,quantity:1}]}});
  try {
    (f.d.querySelector('.adjustmentsToggle') as HTMLButtonElement).click();await f.wait(()=>!!f.d.querySelector('.adjustmentDialog'));
    f.button("Points").click();await f.wait(()=>!!f.button("Use max"));
    if(entry==="maximum-button") f.button("Use max").click();
    else {
      (f.d.querySelector('[aria-label="Points to redeem"]') as HTMLInputElement).click();
      await f.wait(()=>!!f.d.querySelector('[aria-label="Points to redeem keypad"]'));
      const pad=f.d.querySelector('[aria-label="Points to redeem keypad"]')!;
      if(entry==="maximum-keypad") f.button("Maximum",pad).click();
      else for(const digit of ["1","5","0","0"]){f.button(digit,pad).click();await new Promise(r=>setTimeout(r,10));}
      f.button("Done",pad).click();
    }
    await f.wait(()=>!f.d.querySelector('[aria-label="Points to redeem keypad"]'));
    await new Promise(r=>setTimeout(r,10));
    assert.match(f.d.querySelector('.adjustmentPreview')!.textContent!,/1300 pts\)−RM13.00/);
    assert.doesNotMatch(f.d.querySelector('.adjustmentPreview')!.textContent!,/1307 pts/);
    if(entry!=="typed")assert.equal(f.d.querySelector<HTMLInputElement>('[aria-label="Points to redeem"]')!.value,"1300");
    assert.equal(f.d.querySelector<HTMLInputElement>('[name="loyaltyPoints"]')!.value,"0","draft is not committed");
    f.button("Apply").click();await f.wait(()=>!f.d.querySelector('.adjustmentDialog'));
    assert.equal(f.d.querySelector<HTMLInputElement>('[name="loyaltyPoints"]')!.value,"1300");
    assert.equal(new f.dom.window.FormData(f.d.querySelector('form')!).get("loyaltyPoints"),"1300");
    (f.d.querySelector('.adjustmentsToggle') as HTMLButtonElement).click();await f.wait(()=>!!f.d.querySelector('.adjustmentDialog'));
    assert.equal(f.d.querySelector<HTMLInputElement>('[aria-label="Points to redeem"]')!.value,"1300");
    f.button("Cancel",f.d.querySelector('.adjustmentDialog')!).click();await f.wait(()=>!f.d.querySelector('.adjustmentDialog'));
    assert.equal(f.d.querySelector<HTMLInputElement>('[name="loyaltyPoints"]')!.value,"1300");assert.equal(f.data.writes.length,0);
    f.button("Exact RM187.00").click();await f.wait(()=>!!f.button("Confirm payment · RM187.00",f.dialog())&&!f.button("Confirm payment · RM187.00",f.dialog()).disabled);
    f.button("Confirm payment · RM187.00",f.dialog()).click();await f.wait(()=>f.data.writes.length===1);
    assert.equal(Object.fromEntries(f.data.writes[0]).loyaltyPoints,"1300");
  } finally { f.dom.window.close(); }
});

for(const minimumError of [false,true])test(`Points draft Cancel/minimum validation preserves committed payload: minimumError=${minimumError}`,async()=>{
  const f=await fixture(false,undefined,{loyaltySettings:{enabled:true,redemptionEnabled:true,pointsPerRinggit:100,minimumPoints:minimumError?500:100},initialSale:{appointmentId:"appointment",assignedStaffId:"staff",customer:{...cashierCustomer,loyaltyPoints:minimumError?499:1307},lines:[{...cashierItem,type:"product",price:200,quantity:1}]}});
  try {
    (f.d.querySelector('.adjustmentsToggle') as HTMLButtonElement).click();await f.wait(()=>!!f.d.querySelector('.adjustmentDialog'));
    f.button("Points").click();await f.wait(()=>!!f.d.querySelector('[aria-label="Points to redeem"]'));
    await f.wait(()=>f.data.pointsReads.length===1);await new Promise(r=>setTimeout(r,20));
    if(minimumError){
      assert.match(f.d.querySelector('.adjustmentDialog')!.textContent!,/Not enough points to redeem/);
      assert.equal(f.button("Apply").disabled,true);
      assert.equal(f.d.querySelector<HTMLInputElement>('[aria-label="Points to redeem"]')!.disabled,true);
      f.button("Cancel",f.d.querySelector('.adjustmentDialog')!).click();await f.wait(()=>!f.d.querySelector('.adjustmentDialog'));
      assert.equal(f.d.querySelector<HTMLInputElement>('[name="loyaltyPoints"]')!.value,"0");assert.equal(f.data.writes.length,0);return;
    }
    (f.d.querySelector('[aria-label="Points to redeem"]') as HTMLInputElement).click();await f.wait(()=>!!f.d.querySelector('[aria-label="Points to redeem keypad"]'));
    const pad=f.d.querySelector('[aria-label="Points to redeem keypad"]')!;
    for(const digit of ["5","5","0"]){f.button(digit,pad).click();await new Promise(r=>setTimeout(r,10));}
    f.button("Done",pad).click();await f.wait(()=>!f.d.querySelector('[aria-label="Points to redeem keypad"]'));
    if(minimumError){assert.match(f.d.querySelector('.adjustmentDialogError')!.textContent!,/available points cannot/);assert.equal(f.button("Apply").disabled,true);}
    else assert.match(f.d.querySelector('.adjustmentPreview')!.textContent!,/500 pts\)−RM5.00/);
    f.button("Cancel",f.d.querySelector('.adjustmentDialog')!).click();await f.wait(()=>!f.d.querySelector('.adjustmentDialog'));
    assert.equal(f.d.querySelector<HTMLInputElement>('[name="loyaltyPoints"]')!.value,"0");assert.equal(f.data.writes.length,0);
  }finally{f.dom.window.close();}
});

test("checkout catalog discount needs no note, hides manual controls and preserves points",async()=>{
  const discount={id:"discount",name:"Half price",discountType:"PERCENTAGE",percentage:50,fixedAmount:null,scope:"ALL",minimumSpend:0,maximumDiscount:null,allowLoyaltyStacking:true};
  const f=await fixture(false,undefined,{catalogDiscounts:[discount]});try{
    (f.d.querySelector('.adjustmentsToggle') as HTMLButtonElement).click();await f.wait(()=>!!f.d.querySelector('.adjustmentDialog'));
    const select=f.d.querySelector<HTMLSelectElement>('.adjustmentDialog select')!;
    select.value="discount";select.dispatchEvent(new f.dom.window.Event('change',{bubbles:true}));
    await new Promise(r=>setTimeout(r,10));
    assert.equal(f.button("Apply").disabled,false);
    assert.equal(!!f.d.querySelector('[aria-label="Discount type"]'),false);
    assert.match(f.d.querySelector('.adjustmentDialog')!.textContent!,/Reference \(optional\)/);
    assert.match(f.d.querySelector('.adjustmentPreview')!.textContent!,/SubtotalRM200.00Half price−RM100.00New totalRM100.00/);
    f.button("Apply").click();await f.wait(()=>!f.d.querySelector('.adjustmentDialog'));
    assert.equal(f.d.querySelector<HTMLInputElement>('[name="discountReference"]')!.value,"");
    assert.equal(f.d.querySelector<HTMLInputElement>('[name="catalogDiscountId"]')!.value,"discount");
    (f.d.querySelector('.adjustmentsToggle') as HTMLButtonElement).click();await f.wait(()=>!!f.d.querySelector('.adjustmentDialog'));
    const manual=f.d.querySelector<HTMLSelectElement>('.adjustmentDialog select')!;manual.value="";manual.dispatchEvent(new f.dom.window.Event('change',{bubbles:true}));
    await f.wait(()=>!!f.d.querySelector('[aria-label="Discount type"]'));
    f.button("Points").click();await f.wait(()=>!!f.d.querySelector('.pointsAccount'));
    assert.match(f.d.querySelector('.pointsBalance')!.textContent!,/90 pts/);
    assert.ok(f.d.querySelector('[aria-label="Close discount and rewards"]'));assert.ok(f.button("Apply"));
    f.button("Use max").click();await new Promise(r=>setTimeout(r,10));
    assert.match(f.d.querySelector('.adjustmentPreview')!.textContent!,/Points \(90 pts\)−RM90.00New totalRM110.00/);
    f.button("Apply").click();await f.wait(()=>!f.d.querySelector('.adjustmentDialog'));
    assert.equal(f.d.querySelector<HTMLInputElement>('[name="loyaltyPoints"]')!.value,"90");
  }finally{f.dom.window.close();}
});

test("locked recovery offers no allocation editor and retries the exact saved request",async()=>{
  const entries=[["operationId","checkout:original-wallet-key"],["walletAmount","80.00"],["branchId","branch"],["shiftId","original-shift"],["modeAtConfirmation","ON"],["paymentMethodCode","BUILTIN_CASH"]];
  const raw=JSON.stringify({version:1,scope:"wallet-scope:branch",operationId:"checkout:original-wallet-key",entries,summary:[{label:"Wallet",value:"RM80.00"}]});
  const f=await fixture(true,raw);try{
    assert.equal(f.button("Remove discount"),undefined);
    assert.equal(!!f.d.querySelector('[aria-label="Wallet allocation"]'),false);
    assert.match(f.d.querySelector('[aria-label="Pending wallet checkout"]')!.textContent!,/RM80.00/);
    f.button("Retry original checkout").click();await f.wait(()=>f.data.writes.length===1);
    assert.deepEqual(JSON.parse(JSON.stringify(f.data.writes[0])),entries);
    assert.equal(f.dom.window.sessionStorage.getItem('wallet-checkout:wallet-scope:branch'),raw);
  }finally{f.dom.window.close();}
});

test("wallet popover is out of flow, starts blank and outside click cancels",async()=>{
  const f=await fixture();try{
    await f.wait(()=>f.data.reads.length===1);f.resolve(0,"80.00");await f.expandWallet();
    const card=f.d.querySelector<HTMLElement>('[aria-label="Wallet allocation"]')!;
    assert.equal(f.dom.window.getComputedStyle(card).position,"fixed");
    const input=f.d.querySelector<HTMLInputElement>('[aria-label="Wallet amount (RM)"]')!;
    assert.equal(input.value,"");assert.equal(input.placeholder,"0.00");
    f.button("Use wallet").click();await f.wait(()=>!f.d.querySelector('[aria-label="Wallet allocation"]'));
    await f.expandWallet();
    f.input("50");await f.wait(()=>f.d.querySelector<HTMLInputElement>('[aria-label="Wallet amount (RM)"]')!.value==="50");
    const backdrop=f.d.querySelector<HTMLElement>('.paymentBackdrop')!;
    backdrop.dispatchEvent(new f.dom.window.MouseEvent('mousedown',{bubbles:true,cancelable:true}));
    backdrop.click();
    await f.wait(()=>!f.d.querySelector('[aria-label="Wallet allocation"]'));
    assert.ok(f.dialog());assert.equal(f.d.activeElement?.textContent,"Use wallet");
    await f.expandWallet();f.input("50");await new Promise(r=>setTimeout(r,10));f.button("Apply wallet").click();
    await f.wait(()=>!!f.button("Edit",f.d.querySelector('.paymentWallet')!));await f.expandWallet();
    const edit=f.d.querySelector<HTMLInputElement>('[aria-label="Wallet amount (RM)"]')!;
    assert.equal(edit.value,"50");assert.equal(edit.selectionStart,0);assert.equal(edit.selectionEnd,2);
    f.input("");await new Promise(r=>setTimeout(r,10));assert.equal(f.button("Apply wallet").disabled,true);
    f.input("0");await new Promise(r=>setTimeout(r,10));f.button("Apply wallet").click();
    await f.wait(()=>!f.d.querySelector('[aria-label="Wallet allocation"]'));
    assert.equal(f.d.querySelector<HTMLInputElement>('[name="walletAmount"]')!.value,"0");
  }finally{f.dom.window.close();}
});

test("allocation draft is isolated; Apply commits, Cancel/Escape preserve and zero removes",async()=>{
  const f=await fixture();try{
    await f.wait(()=>f.data.reads.length===1);
    assert.equal(f.button("Use wallet").disabled,true);
    f.resolve(0,"1100.00");await f.expandWallet();
    const committed=()=>f.d.querySelector<HTMLInputElement>('[name="walletAmount"]')?.value??"";
    const key=f.d.querySelector<HTMLInputElement>('[name="operationId"]')!.value;
    f.input("80");await new Promise(r=>setTimeout(r,20));assert.equal(committed(),"");
    f.button("Cancel",f.d.querySelector('[aria-label="Wallet allocation"]')!).click();
    await f.wait(()=>!f.d.querySelector('[aria-label="Wallet amount (RM)"]'));assert.equal(committed(),"");
    await f.expandWallet();f.button("Use max RM200.00").click();await f.wait(()=>f.d.querySelector<HTMLInputElement>('[aria-label="Wallet amount (RM)"]')!.value==="200.00");
    assert.equal(committed(),"");assert.equal(f.data.writes.length,0);
    f.input("80");await new Promise(r=>setTimeout(r,20));f.button("Apply wallet").click();await f.wait(()=>committed()==="80");
    assert.match(f.d.querySelector('.paymentWallet')!.textContent!,/Using RM80.00.*of RM1,100.00/);
    assert.match(f.d.querySelector('.paymentWallet')!.textContent!,/Remaining payment.*RM120.00/);
    await f.expandWallet();assert.equal(f.d.querySelector<HTMLInputElement>('[aria-label="Wallet amount (RM)"]')!.value,"80");
    f.input("90");await new Promise(r=>setTimeout(r,20));
    f.d.querySelector<HTMLInputElement>('[aria-label="Wallet amount (RM)"]')!.dispatchEvent(new f.dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
    await f.wait(()=>!f.d.querySelector('[aria-label="Wallet amount (RM)"]'));
    assert.ok(f.dialog());assert.equal(committed(),"80");assert.equal(f.d.activeElement?.textContent,"Edit");
    await f.expandWallet();f.input("0");await new Promise(r=>setTimeout(r,20));f.button("Apply wallet").click();await f.wait(()=>committed()==="0");
    assert.ok(f.button("Use wallet"));assert.doesNotMatch(f.dialog().textContent!,/Hide wallet/);
    assert.equal(f.d.querySelector<HTMLInputElement>('[name="operationId"]')!.value,key);
  }finally{f.dom.window.close();}
});

test("out-of-range draft never crashes checkout or changes committed allocation",async()=>{
  const f=await fixture();try{
    await f.wait(()=>f.data.reads.length===1);f.resolve(0,"80.00");await f.expandWallet();
    for(const value of ["-1", "1.001", "abc", "100000000000000", "81"]){
      f.input(value);await new Promise(r=>setTimeout(r,20));
      f.button("Apply wallet").click();await new Promise(r=>setTimeout(r,20));
      assert.ok(f.dialog(),"invalid draft must not unmount checkout");
      assert.ok(f.d.querySelector('[aria-label="Wallet allocation"] [role="alert"]'));
      assert.equal(f.d.querySelector<HTMLInputElement>('[name="walletAmount"]')?.value??"","");
    }
  }finally{f.dom.window.close();}
});

test("draft preview and specific validation never change applied allocation",async()=>{
  const f=await fixture();try{
    await f.wait(()=>f.data.reads.length===1);f.resolve(0,"1100.00");await f.expandWallet();
    const card=()=>f.d.querySelector('[aria-label="Wallet allocation"]')!;
    assert.equal(f.button("Apply wallet").disabled,true);assert.equal(!!card().querySelector('[role="alert"]'),false);
    for(const [draft,remaining,error] of [["200","RM0.00",""],["80","RM120.00",""],["300","","Maximum wallet amount is RM200.00."],["-1","","Enter an amount of RM0.00 or more."],["abc","","Enter a valid amount."]]){
      f.input(draft);await new Promise(r=>setTimeout(r,20));
      assert.equal(f.button("Apply wallet").disabled,!!error);
      if(error)assert.match(card().textContent!,new RegExp(error.replaceAll('.','\\.')));
      else {assert.match(card().textContent!,new RegExp(`Remaining payment: ${remaining.replace('.','\\.')}`));assert.equal(!!card().querySelector('[role="alert"]'),false);}
      assert.equal(f.d.querySelector<HTMLInputElement>('[name="walletAmount"]')?.value??"","");
    }
    f.button("Use max RM200.00").click();await f.wait(()=>!f.button("Apply wallet").disabled);
    assert.match(card().textContent!,/Remaining payment: RM0.00/);
  }finally{f.dom.window.close();}
});

test("draft over wallet balance reports the balance limit separately",async()=>{
  const f=await fixture();try{
    await f.wait(()=>f.data.reads.length===1);f.resolve(0,"80.00");await f.expandWallet();
    f.input("100");await f.wait(()=>f.button("Apply wallet").disabled);
    assert.match(f.d.querySelector('[aria-label="Wallet allocation"]')!.textContent!,/Available wallet balance is RM80.00/);
  }finally{f.dom.window.close();}
});

test("progressive disclosure keeps allocations and cash payload while removing unused controls",async()=>{
  const f=await fixture();try{
    assert.equal(!!f.d.querySelector('[aria-label="Wallet amount (RM)"]'),false);
    assert.match(f.d.querySelector('.adjustmentsToggle')!.textContent!,/None/);
    assert.ok(f.d.querySelector('.paymentCashCompact'));
    assert.equal(f.d.querySelector<HTMLElement>('.paymentCashCustom')!.hidden,true);
    await f.wait(()=>f.data.reads.length===1);f.resolve(0,"80.00");
    await f.expandWallet();await f.wait(()=>!!f.button("Use max RM80.00"));
    f.button("Use max RM80.00").click();await new Promise(r=>setTimeout(r,10));f.button("Apply wallet").click();await f.wait(()=>f.d.querySelector<HTMLInputElement>('[name="walletAmount"]')!.value==="80.00");
    assert.equal(f.button("Hide wallet"),undefined);
    f.button("Exact RM120.00").click();await f.wait(()=>/RM120.00/.test(f.d.querySelector('.paymentCashReceived')!.textContent!));
    assert.match(f.d.querySelector('.cashChange')!.textContent!,/RM0.00/);
    f.button("Custom").click();await f.wait(()=>!f.d.querySelector<HTMLElement>('.paymentCashCustom')!.hidden);
    assert.equal(f.d.querySelector<HTMLInputElement>('[name="walletAmount"]')!.value,"80.00");
    assert.ok(f.d.querySelector('.paymentFooter button[type="submit"]'));
  }finally{f.dom.window.close();}
});

test("open/reopen reads fresh balance; max only fills walletAmount with exact capped cents",async()=>{
  const f=await fixture();try{
    await f.wait(()=>f.data.reads.length===1);
    assert.doesNotMatch(f.dialog().textContent!,/Available RM0/);
    f.resolve(0,"1100.00");await f.expandWallet();await f.wait(()=>!!f.button("Use max RM200.00"));
    assert.match(f.dialog().textContent!,/Available RM1,100.00/);
    const key=f.d.querySelector<HTMLInputElement>('[name="operationId"]')!.value;
    f.button("Use max RM200.00").click();await new Promise(r=>setTimeout(r,10));f.button("Apply wallet").click();await f.wait(()=>f.d.querySelector<HTMLInputElement>('[name="walletAmount"]')!.value==="200.00");
    assert.equal(f.data.writes.length,0);assert.equal(f.d.querySelector<HTMLInputElement>('[name="operationId"]')!.value,key);
    f.button("Back",f.dialog()).click();await f.wait(()=>!f.dialog());f.button("Pay RM200.00").click();
    await f.wait(()=>f.data.reads.length===2);assert.doesNotMatch(f.dialog().textContent!,/Available RM1,100/);
    f.resolve(1,"80.00");await f.expandWallet();await f.wait(()=>!!f.button("Use max RM80.00"));f.button("Use max RM80.00").click();await new Promise(r=>setTimeout(r,10));f.button("Apply wallet").click();
    await f.wait(()=>f.d.querySelector<HTMLInputElement>('[name="walletAmount"]')!.value==="80.00");
    assert.match(f.dialog().textContent!,/Remaining payment.*RM120.00/);
    await f.expandWallet();f.input("90");await new Promise(r=>setTimeout(r,10));f.button("Apply wallet").click();await f.wait(()=>!!f.d.querySelector('[aria-label="Wallet allocation"] [role="alert"]'));
    assert.equal(f.d.querySelector<HTMLInputElement>('[name="walletAmount"]')!.value,"80.00");
    f.input("12.34");await new Promise(r=>setTimeout(r,10));f.button("Apply wallet").click();await f.wait(()=>f.d.querySelector<HTMLInputElement>('[name="walletAmount"]')!.value==="12.34");
    assert.match(f.dialog().textContent!,/Remaining payment.*RM187.66/);
  }finally{f.dom.window.close();}
});

test("unused wallet can collapse; applied discount survives closing and reopening its existing dialog",async()=>{
  const f=await fixture();try{
    await f.wait(()=>f.data.reads.length===1);f.resolve(0,"80.00");await f.expandWallet();f.button("Cancel",f.d.querySelector('[aria-label="Wallet allocation"]')!).click();
    await f.wait(()=>!f.d.querySelector('[aria-label="Wallet amount (RM)"]'));
    assert.equal(f.d.querySelector<HTMLInputElement>('[name="walletAmount"]')?.value??"","");
    (f.d.querySelector('.adjustmentsToggle') as HTMLButtonElement).click();
    await f.wait(()=>!!f.d.querySelector('[aria-label="Discount value"]'));
    (f.d.querySelector('[aria-label="Discount value"]') as HTMLInputElement).click();
    await f.wait(()=>!!f.d.querySelector('[aria-label="Discount amount keypad"]'));
    const keypad=f.d.querySelector('[aria-label="Discount amount keypad"]')!;
    f.button("Clear",keypad).click();await new Promise(r=>setTimeout(r,10));
    f.button("2",keypad).click();await new Promise(r=>setTimeout(r,10));
    f.button("0",keypad).click();await new Promise(r=>setTimeout(r,10));
    f.button("Done",keypad).click();await f.wait(()=>!f.d.querySelector('[aria-label="Discount amount keypad"]'));
    assert.equal(f.button("Apply").disabled,false);
    f.button("Apply").click();await f.wait(()=>!f.d.querySelector('.adjustmentDialog'));
    assert.equal(f.d.querySelector<HTMLInputElement>('[name="discountReference"]')!.value,"");
    assert.match(f.d.querySelector('.adjustmentsToggle')!.textContent!,/RM20.00 applied/);
    (f.d.querySelector('.adjustmentsToggle') as HTMLButtonElement).click();await f.wait(()=>!!f.d.querySelector('.adjustmentDialog'));
    const reference=f.d.querySelector<HTMLInputElement>('[placeholder="Promotion code or note"]')!;
    Object.getOwnPropertyDescriptor(f.dom.window.HTMLInputElement.prototype,"value")!.set!.call(reference,"Approved discount");
    reference.dispatchEvent(new f.dom.window.Event("input",{bubbles:true}));
    await f.wait(()=>!f.button("Apply").disabled);f.button("Apply").click();
    await f.wait(()=>/RM20.00 applied/.test(f.d.querySelector('.adjustmentsToggle')!.textContent!));
    await f.wait(()=>!f.d.querySelector('.adjustmentDialog'));
    assert.equal(f.d.querySelector<HTMLInputElement>('[name="discountReference"]')!.value,"Approved discount");
    const before=Array.from(new f.dom.window.FormData(f.d.querySelector('form')!).entries());
    (f.d.querySelector('.adjustmentsToggle') as HTMLButtonElement).click();
    await f.wait(()=>!!f.d.querySelector('.adjustmentDialog'));
    (f.d.querySelector('[aria-label="Close discount and rewards"]') as HTMLButtonElement).click();
    await f.wait(()=>!f.d.querySelector('.adjustmentDialog'));
    assert.deepEqual(Array.from(new f.dom.window.FormData(f.d.querySelector('form')!).entries()),before);
    assert.match(f.d.querySelector('.adjustmentsToggle')!.textContent!,/RM20.00 applied/);
  }finally{f.dom.window.close();}
});

test("custom cash retains original keypad, Received and Change; non-Cash has no cash controls",async()=>{
  const f=await fixture(false);try{
    f.button("Custom").click();await f.wait(()=>!!f.d.querySelector('[aria-label="Cash received keypad"]'));
    const keypad=f.d.querySelector('[aria-label="Cash received keypad"]')!;
    for(const digit of ["2","5","0"]){f.button(digit,keypad).click();await new Promise(r=>setTimeout(r,10));}
    f.button("Done",keypad).click();await f.wait(()=>!f.d.querySelector('[aria-label="Cash received keypad"]'));
    assert.match(f.d.querySelector('.paymentCashReceived')!.textContent!,/RM250.00/);
    assert.match(f.d.querySelector('.cashChange')!.textContent!,/RM50.00/);
    assert.equal(f.d.querySelector<HTMLInputElement>('.paymentCashCustom input')!.value,"250");
    f.button("Card").click();await f.wait(()=>!f.d.querySelector('.paymentCashCompact'));
    f.button("Cash").click();await f.wait(()=>!!f.d.querySelector('.paymentCashCompact'));
    assert.match(f.d.querySelector('.paymentCashReceived')!.textContent!,/RM250.00/);
  }finally{f.dom.window.close();}
});

test("customer switch clears balance and ignores a late previous customer response",async()=>{
  const f=await fixture();try{
    await f.wait(()=>f.data.reads.length===1);
    f.dom.window.chooseCustomer({...cashierCustomer,id:"customer-b"});await f.wait(()=>f.data.reads.length===2);
    f.resolve(1,"80.00");await f.expandWallet();await f.wait(()=>!!f.button("Use max RM80.00"));
    f.resolve(0,"1100.00");await new Promise(r=>setTimeout(r,20));
    assert.doesNotMatch(f.dialog().textContent!,/1,100/);
    f.dom.window.chooseCustomer({...cashierCustomer,id:"customer-c"});await f.wait(()=>f.data.reads.length===3);
    assert.doesNotMatch(f.dialog().textContent!,/Available RM80/);
  }finally{f.dom.window.close();}
});

test("balance failure blocks positive wallet use, not ordinary Cash, and supports retry",async()=>{
  const f=await fixture();try{
    await f.wait(()=>f.data.reads.length===1);f.data.reads[0].reject(Error("read failed"));
    await f.wait(()=>!!f.button("Retry wallet balance"));await f.expandWallet();assert.equal(f.button("Use max").disabled,true);
    f.button("Cancel",f.d.querySelector('[aria-label="Wallet allocation"]')!).click();await f.wait(()=>!f.d.querySelector('[aria-label="Wallet allocation"]'));
    f.button("Exact RM200.00").click();await f.wait(()=>!!f.button("Confirm payment · RM200.00",f.dialog())&&!f.button("Confirm payment · RM200.00",f.dialog()).disabled);
    await f.expandWallet();f.input("10");await new Promise(r=>setTimeout(r,10));f.button("Apply wallet").click();await f.wait(()=>!!f.d.querySelector('[aria-label="Wallet allocation"] [role="alert"]'));
    assert.equal(f.button("Confirm payment · RM200.00",f.dialog()).disabled,false);
    f.button("Retry wallet balance",f.d.querySelector('[aria-label="Wallet allocation"]')!).click();await f.wait(()=>f.data.reads.length===2);f.resolve(1,"0.00");
    await f.wait(()=>!!f.button("Use max RM0.00"));assert.equal(f.button("Use max RM0.00").disabled,true);
    assert.equal(f.data.writes.length,0);
  }finally{f.dom.window.close();}
});

test("Wallet disabled never reads; compact layout keeps whole-modal fallback and isolated item scrolling",async()=>{
  const f=await fixture(false);try{
    assert.equal(f.data.reads.length,0);assert.doesNotMatch(f.dialog().textContent!,/Available RM|Use max/);
    const style=(el:Element)=>f.dom.window.getComputedStyle(el);
    assert.equal(style(f.dialog()).overflowY,"auto");
    assert.equal(style(f.d.querySelector(".paymentControls")!).overflow,"visible");
    assert.equal(style(f.d.querySelector(".paymentChoices")!).gridTemplateColumns,"repeat(3, minmax(0, 1fr))");
    assert.equal(style(f.d.querySelector(".paymentOrderLines")!).overflowY,"auto");
    assert.ok(f.d.querySelector(".paymentOrderTotals"));assert.ok(f.button("Back",f.dialog()));
  }finally{f.dom.window.close();}
});

test("split confirmation uses the original form payload/key and unchanged method ordering and totals",async()=>{
  const f=await fixture();try{
    await f.wait(()=>f.data.reads.length===1);
    assert.deepEqual(Array.from(f.dialog().querySelectorAll(".paymentChoices button")).map(b=>b.textContent),paymentMethods.map(m=>m.label));
    f.resolve(0,"80.00");await f.expandWallet();await f.wait(()=>!!f.button("Use max RM80.00"));
    const operation=f.d.querySelector<HTMLInputElement>('[name="operationId"]')!.value;
    f.button("Use max RM80.00").click();await new Promise(r=>setTimeout(r,10));f.button("Apply wallet").click();await f.wait(()=>!!f.button("Exact RM120.00"));
    f.button("Exact RM120.00").click();await f.wait(()=>!!f.button("Confirm payment · RM200.00",f.dialog())&&!f.button("Confirm payment · RM200.00",f.dialog()).disabled);
    assert.match(f.d.querySelector(".paymentOrderTotals")!.textContent!,/SubtotalRM200.00TotalRM200.00/);
    const form=f.d.querySelector("form")!;
    const expected=Array.from(new f.dom.window.FormData(form).entries());
    f.button("Confirm payment · RM200.00",f.dialog()).click();await f.wait(()=>f.data.writes.length===1);
    assert.deepEqual(JSON.parse(JSON.stringify(f.data.writes[0])),JSON.parse(JSON.stringify(expected)));
    const submitted=Object.fromEntries(f.data.writes[0]);
    assert.equal(submitted.walletAmount,"80.00");assert.equal(submitted.paymentMethodCode,"BUILTIN_CASH");
    assert.equal(submitted.operationId,operation);assert.equal(submitted.modeAtConfirmation,"OFF");assert.equal(submitted.shiftId,"");
    assert.equal(submitted.branchId,"branch");assert.equal(submitted.customerId,cashierCustomer.id);
  }finally{f.dom.window.close();}
});
