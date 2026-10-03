import assert from "node:assert/strict";
import test from "node:test";
import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {build} from "esbuild";
import {createRequire} from "node:module";
import {mkdtemp,rm} from "node:fs/promises";
import {join} from "node:path";
import {crmUiBoundaries} from "../helpers/crm-ui-fixture";
import {WalletRefundFields} from "../../src/components/wallet/wallet-refund-view";
const {JSDOM}=createRequire(import.meta.url)("jsdom") as {JSDOM:new (html:string)=>{window:{document:Document}}};

const options={kind:"invoice",legs:[{paymentId:"wallet",method:"MEMBER_WALLET",availableCents:10000},{paymentId:"cash",method:"CASH",availableCents:10000}],stockLines:[],paidAmount:"",bonusAmount:"",method:"",canVoid:false,packagePurchaseRefund:{refundableCents:20000,unavailableReason:null}};
test("package mixed refund presents one server total and submits every original source without editable amounts or source selectors",()=>{
 const d=new JSDOM(renderToStaticMarkup(createElement("form",null,createElement(WalletRefundFields,{options})))).window.document;
 assert.match(d.body.textContent!,/Full refund total.*RM200.00/s);
 assert.match(d.body.textContent!,/Unused packages can only be refunded in full/);
 assert.equal(d.querySelectorAll('input[type="number"], select').length,0);
 assert.equal(d.querySelector<HTMLInputElement>('[name="amount_wallet"]')?.value,"100.00");
 assert.equal(d.querySelector<HTMLInputElement>('[name="amount_cash"]')?.value,"100.00");
 assert.equal(d.querySelector<HTMLInputElement>('[name="method_wallet"]')?.value,"MEMBER_WALLET");
 assert.equal(d.querySelector<HTMLInputElement>('[name="method_cash"]')?.value,"CASH");
 assert.ok(d.querySelector('[name="reason"]'));assert.ok(d.querySelector('[name="reference_cash"]'));
});

test("ordinary purchase form uses authoritative full amount while redemption and service keep their original contracts",async()=>{
 const dir=await mkdtemp(join(process.cwd(),"node_modules/.cache/package-refund-ui-"));
 try{
  await build({entryPoints:["src/components/refund-payment-form.tsx"],outfile:join(dir,"form.cjs"),bundle:true,packages:"external",platform:"node",format:"cjs",plugins:[crmUiBoundaries()]});
  Object.assign(globalThis,{__crmFixture:{actions:{}}});
  const {RefundPaymentForm}=createRequire(import.meta.url)(join(dir,"form.cjs"));
  const props={cashierShiftsEnabled:false,invoiceId:"invoice",invoiceNumber:"1001",paymentId:"payment",originalMethod:"CASH",refundableAmount:200};
  const render=(extra:object)=>new JSDOM(renderToStaticMarkup(createElement(RefundPaymentForm,{...props,...extra}))).window.document;
  const purchase=render({packagePurchaseRefund:{refundableCents:20000,unavailableReason:null}});
  assert.match(purchase.body.textContent!,/Full refund total.*RM200.00/s);
  assert.equal(purchase.querySelector('input[name="amount"][type="number"]'),null);
  assert.equal(purchase.querySelector<HTMLInputElement>('[name="amount"]')?.value,"200.00");
  assert.equal(purchase.querySelector('[name="method"]')?.tagName,"INPUT");
  assert.match(purchase.body.textContent!,/Process full refund/);
  const used=render({packagePurchaseRefund:{refundableCents:20000,unavailableReason:"Packages must be unused."}});
  assert.equal(used.querySelector<HTMLButtonElement>('[type="submit"]')?.disabled,true);
  const redemption=render({originalMethod:"PACKAGE"});
  assert.match(redemption.body.textContent!,/Restore package use/);assert.doesNotMatch(redemption.body.textContent!,/Unused packages/);
  for(const kind of ["Service","Product"]){const normal=render({});assert.equal(normal.querySelector<HTMLInputElement>('[name="amount"]')?.readOnly,false,kind);}
 }finally{await rm(dir,{recursive:true,force:true});}
});
test("used package displays refusal instead of partial refund controls",()=>{
 const html=renderToStaticMarkup(createElement(WalletRefundFields,{options:{...options,packagePurchaseRefund:{refundableCents:20000,unavailableReason:"All packages in this invoice must be unused before they can be refunded."}}}));
 assert.match(html,/must be unused/);assert.doesNotMatch(html,/type="number"|<select/);
});
for(const kind of ["Service","Product"])test(`${kind} keeps partial refund inputs`,()=>{
 const d=new JSDOM(renderToStaticMarkup(createElement(WalletRefundFields,{options:{...options,packagePurchaseRefund:null}}))).window.document;
 assert.equal(d.querySelectorAll('input[type="number"]').length,2);assert.equal(d.querySelector<HTMLInputElement>('[name="amount_cash"]')?.value,"0");
});

test("read-only package association distinguishes purchases from redemption and blocks used or abnormal purchases",async()=>{
 const module=await import("../../src/lib/refunds/package-presentation").catch(()=>null);
 assert.ok(module?.packageRefundPresentation,"read-only association presentation is required");
 const pkg={id:"pkg",status:"ACTIVE",remainingUses:10,totalUses:10,serviceBalances:[{remainingUses:10,totalUses:10}]};
 const invoice={customerPackageId:"pkg",customerPackage:pkg,items:[],payments:[]};
 assert.deepEqual(module.packageRefundPresentation(invoice,20000),{refundableCents:20000,unavailableReason:null});
 assert.equal(module.packageRefundPresentation({customerPackageId:null,customerPackage:null,items:[{customerPackageId:"pkg",customerPackage:pkg}],payments:[{method:"PACKAGE",customerPackageId:"pkg"}]},20000),null);
 assert.equal(module.packageRefundPresentation({customerPackageId:null,customerPackage:null,items:[{customerPackageId:"pkg",customerPackage:pkg}],payments:[]},20000)?.refundableCents,20000);
 assert.match(module.packageRefundPresentation({...invoice,customerPackage:{...pkg,remainingUses:9}},20000)!.unavailableReason!,/unused/);
 assert.match(module.packageRefundPresentation({...invoice,customerPackage:null},20000)!.unavailableReason!,/unavailable/i);
 assert.equal(module.packageRefundPresentation({customerPackageId:null,customerPackage:null,items:[],payments:[]},20000),null);
});
