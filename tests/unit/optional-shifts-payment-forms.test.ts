import assert from "node:assert/strict";
import test, {after} from "node:test";
import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {build} from "esbuild";
import {createRequire} from "node:module";
import {mkdtemp,rm,readFile} from "node:fs/promises";
import {join} from "node:path";
import {crmUiBoundaries} from "../helpers/crm-ui-fixture";

let directory:string;
after(async()=>{if(directory)await rm(directory,{recursive:true,force:true});});
const names={PaymentForm:"payment-form",PackagePaymentForm:"package-payment-form",PackagePurchasePaymentForm:"package-purchase-payment-form",ProductSaleForm:"product-sale-form",WorkOrderPackagePurchase:"work-order-package-purchase",RefundPaymentForm:"refund-payment-form",SalonAppointmentPaymentForm:"salon-appointment-payment-form",PosPaymentPanel:"pos-payment-panel"};
test("real payment forms carry ON/OFF and original shift confirmation fields",async(t)=>{
  directory=await mkdtemp(join(process.cwd(),"node_modules/.cache/optional-payment-ui-"));
  await build({entryPoints:Object.values(names).map(name=>`src/components/${name}.tsx`),outdir:directory,outExtension:{".js":".cjs"},bundle:true,packages:"external",platform:"node",format:"cjs",loader:{".css":"empty"},plugins:[crmUiBoundaries()]});
  const load=createRequire(import.meta.url);
  Object.assign(globalThis,{__crmFixture:{actions:{}}});
  const props={action:async()=>{},recordPaymentAction:async()=>{},usePackagePaymentAction:async()=>{},workOrderId:"job",customerPackageId:"package",appointmentId:"appointment",invoiceId:"invoice",invoiceNumber:"1001",paymentId:"payment",originalMethod:"CASH",refundableAmount:40,balance:40,variant:"pos",branches:[{id:"branch",name:"Main"}],branchId:"branch",products:[],packages:[],taxSettings:{enabled:false,label:"SST",rate:0},availablePackages:[],hasInvoice:false,hasOpenShift:false,subtotal:40,totalAmount:40,taxLines:[],checkoutItems:[],catalogDiscounts:[],sstEnabled:false,sstLabel:"SST",sstRate:0,onCheckoutComplete:()=>{},canPay:true,customerPackages:[{id:"package",packageName:"Wash",remainingUses:2,totalUses:5}]};
  for(const [name,file] of Object.entries(names)){
    await t.test(name,()=>{
    const Component=load(join(directory,`${file}.cjs`))[name];
    for(const enabled of [true,false]){
      const html=renderToStaticMarkup(createElement(Component,{...props,cashierShiftsEnabled:enabled,shiftId:enabled?"original-shift":null}));
      assert.match(html,new RegExp(`name="modeAtConfirmation" value="${enabled?"ON":"OFF"}"`),`${name} must carry current mode`);
      assert.match(html,new RegExp(`name="shiftId" value="${enabled?"original-shift":""}"`),`${name} must carry nullable shift`);
      if(!enabled && name==="SalonAppointmentPaymentForm")assert.doesNotMatch(html,/Start a cashier shift/);
      if(name === "PackagePaymentForm") assert.match(html,/name="preservePaymentForm"/,"package redemption retains its rejected request for explicit review");
      if(name === "PosPaymentPanel") assert.equal((html.match(/name="preservePaymentForm"/g)??[]).length,2,"both actual POS collection forms must preserve rejected requests");
    }
    });
  }
});

test("authenticated collection pages pass actual setting and shift into their form",async()=>{
  for(const path of ["src/app/(business)/appointments/[appointmentId]/page.tsx","src/app/(business)/pos/[workOrderId]/page.tsx","src/app/(business)/pos/packages/[customerPackageId]/page.tsx","src/app/(business)/work-orders/page.tsx"]){
    const source=await readFile(path,"utf8");
    assert.match(source,/cashierShiftsEnabled=\{(?:appointment|workOrder)\.business\.cashierShiftsEnabled\}|cashierShiftsEnabled=\{business\.cashierShiftsEnabled\}/,path);
    assert.match(source,/shiftId=\{openShift\?\.id\s*\?\?\s*null\}/,path);
  }
});

test("expense drawer funding is hidden OFF, while non-drawer options remain",async()=>{
  const outfile=join(directory,"expense-payment-form.cjs");
  await build({entryPoints:["src/components/expense-payment-form.tsx"],outfile,bundle:true,packages:"external",platform:"node",format:"cjs",loader:{".css":"empty"},plugins:[crmUiBoundaries()]});
  const {ExpensePaymentForm}=createRequire(import.meta.url)(outfile);
  const props={expenseId:"expense",expectedRevision:1,openDrawerShifts:[],operationKey:"key",outstanding:"25.00"};
  const enabled=renderToStaticMarkup(createElement(ExpensePaymentForm,{...props,cashierShiftsEnabled:true}));
  const disabled=renderToStaticMarkup(createElement(ExpensePaymentForm,{...props,cashierShiftsEnabled:false}));
  assert.match(enabled,/value="POS_DRAWER_CASH"/);
  assert.doesNotMatch(disabled,/value="POS_DRAWER_CASH"/);
  assert.match(disabled,/Bank|bank/);
  const autofill=join(directory,"expense-autofill.cjs");
  await build({entryPoints:["src/components/expense-document-autofill-form.tsx"],outfile:autofill,bundle:true,packages:"external",platform:"node",format:"cjs",loader:{".css":"empty"},plugins:[crmUiBoundaries()],footer:{js:"module.exports.PaymentAccountOptions = PaymentAccountOptions;"}});
  const {PaymentAccountOptions}=createRequire(import.meta.url)(autofill);
  assert.doesNotMatch(renderToStaticMarkup(createElement(PaymentAccountOptions,{canUsePosDrawer:false,cashierShiftsEnabled:false})),/POS_DRAWER_CASH/);
});

test("refund opened from an invoice waits for authenticated cashier settings instead of defaulting ON",async()=>{
  const {RefundPaymentForm}=createRequire(import.meta.url)(join(directory,"refund-payment-form.cjs"));
  const html=renderToStaticMarkup(createElement(RefundPaymentForm,{invoiceId:"invoice",invoiceNumber:"1001",paymentId:"payment",originalMethod:"CASH",refundableAmount:40}));
  assert.match(html,/Loading cashier settings/);
  assert.match(html,/<button[^>]*disabled=""[^>]*>Process refund/);
  assert.doesNotMatch(html,/name="modeAtConfirmation" value="ON"/);
});

test("OFF product collection requires an explicit branch when more than one is available",async()=>{
  const {ProductSaleForm}=createRequire(import.meta.url)(join(directory,"product-sale-form.cjs"));
  const html=renderToStaticMarkup(createElement(ProductSaleForm,{action:async()=>{},cashierShiftsEnabled:false,branches:[{id:"first",name:"First"},{id:"second",name:"Second"}],products:[],taxSettings:{enabled:false,label:"SST",rate:0}}));
  assert.match(html,/<option value=""[^>]*selected=""[^>]*>Select branch/);
  assert.doesNotMatch(html,/<option value="first" selected=""/);
});

test("OFF Cashier exposes an authorized branch selection outside the hidden Start Shift modal",async()=>{
 const page=await readFile("src/app/(business)/cashier/page.tsx","utf8");
 assert.match(page,/selectCashierOutletBranch\(\{ context: outletContext/);
 assert.match(page,/outletContext.kind === "legacy_multi_branch"/);
 assert.match(page,/explicitBranchId: params.branchId/);
 assert.match(page,/!business.cashierShiftsEnabled && branches.length > 1/);
 assert.match(page,/<form action="\/cashier" method="get"/);
});

test("appointment retry captures original confirmation and exposes an explicit review path",async()=>{
 const source=await readFile("src/components/salon-appointment-payment-form.tsx","utf8");
 assert.match(source,/confirmation\.current\s*\?\?=/);
 assert.match(source,/data\.set\("modeAtConfirmation", confirmation\.current\.modeAtConfirmation\)/);
 assert.match(source,/Review current cashier settings/);
 assert.match(source,/Use reviewed cashier settings/);
});
