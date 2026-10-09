import assert from "node:assert/strict";
import test from "node:test";
import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {readFile} from "node:fs/promises";
test("Owner refund view fixes wallet destination, explicit amount and frozen retry details",async()=>{
 const m=await import("../../src/components/wallet/wallet-refund-view").catch(()=>null);assert.ok(m?.WalletRefundFields);
 const html=renderToStaticMarkup(createElement(m.WalletRefundFields,{options:{kind:"invoice",legs:[{paymentId:"payment",method:"MEMBER_WALLET",availableCents:8000}],stockLines:[],paidAmount:"",bonusAmount:"",method:"",canVoid:false}}));
 assert.match(html,/Return to member wallet/);assert.match(html,/80.00/);assert.doesNotMatch(html,/value="80.00"/);
 const top=renderToStaticMarkup(createElement(m.WalletRefundFields,{options:{kind:"top-up",legs:[],stockLines:[],paidAmount:"1000.00",bonusAmount:"100.00",method:"CASH",canVoid:false}}));
 assert.match(top,/Top-up amount<\/dt><dd>RM 1000.00/);assert.match(top,/Bonus to remove<\/dt><dd>RM 100.00/);
 const pending=renderToStaticMarkup(createElement(m.WalletRefundPending,{request:{operationKey:"key",fields:{kind:"refund",reason:"Original reason",legs:'[{"method":"CARD","amountCents":2000,"reference":"card-ref"}]',stockLines:"[]"}}}));
 assert.match(pending,/card-ref/);assert.match(pending,/Original reason/);assert.doesNotMatch(pending,/Original operation key|<input|<select/);
});

test("pending refund renders original tender amounts without raw identifiers and preserves the retry request",async()=>{
 const {WalletRefundPending}=await import("../../src/components/wallet/wallet-refund-view");
 const request={operationKey:"private-operation-key",fields:{kind:"refund",businessId:"private-business-id",sourceId:"private-source-id",reason:"P1D lost response",legs:JSON.stringify([{paymentId:"private-wallet-payment",method:"MEMBER_WALLET",amountCents:2000,reference:""},{paymentId:"private-card-payment",method:"CARD",amountCents:2000,reference:"card-original-ref"}]),stockLines:JSON.stringify([{invoiceItemId:"private-stock-id",quantity:1,disposition:"NO_RESTOCK",noRestockReason:"Damaged"}])}};
 const before=JSON.stringify(request);
 const html=renderToStaticMarkup(createElement(WalletRefundPending,{request,invoiceNumber:"1001"}));
 assert.match(html,/Refund confirmation pending/);assert.match(html,/Your refund may have been completed/);assert.match(html,/Do not issue another refund/);
 assert.match(html,/#1001/);assert.match(html,/Member wallet/);assert.match(html,/Card/);assert.equal((html.match(/RM20\.00/g)||[]).length,2);assert.match(html,/Total refund/);assert.match(html,/RM40\.00/);assert.match(html,/card-original-ref/);assert.match(html,/P1D lost response/);
 assert.doesNotMatch(html,/private-|operationKey|businessId|sourceId|stockLines|amountCents|&quot;|<input|<select/);
 assert.equal(JSON.stringify(request),before,"presentation must never alter the original financial request");
});

test("legacy or malformed pending details never fabricate amounts or expose raw payload",async()=>{
 const {WalletRefundPending}=await import("../../src/components/wallet/wallet-refund-view");
 for(const legs of ["broken-json",'[{"amountCents":-1,"method":"CARD"}]',"[]"]){
  const html=renderToStaticMarkup(createElement(WalletRefundPending,{request:{operationKey:"private-key",fields:{kind:"refund",reason:"Original",legs,stockLines:"[]"}}}));
  assert.match(html,/Refund confirmation pending/);assert.doesNotMatch(html,/RM0\.00|RM-0\.01|broken-json|private-key|amountCents/);
 }
});

test("pending invoice void does not describe ignored form legs as a refund",async()=>{
 const {WalletRefundPending}=await import("../../src/components/wallet/wallet-refund-view");
 const request={operationKey:"void-key",fields:{kind:"void",reason:"Original void",legs:'[{"method":"CARD","amountCents":2000}]',stockLines:"[]"}};
 const before=JSON.stringify(request),html=renderToStaticMarkup(createElement(WalletRefundPending,{request,invoiceNumber:"1001"}));
 assert.match(html,/Original invoice void/);assert.match(html,/#1001/);assert.match(html,/Original void/);assert.doesNotMatch(html,/Total refund|RM20\.00/);assert.equal(JSON.stringify(request),before);
});
test("invoice modal retains wallet routing after the Wallet leg is fully refunded",async()=>{
 const m=await import("../../src/components/wallet/wallet-refund-view") as unknown as {hasWalletInvoiceSource:(invoice:object)=>boolean};assert.equal(typeof m.hasWalletInvoiceSource,"function");
 assert.equal(m.hasWalletInvoiceSource({hasWalletPayment:true,refundablePayments:[{method:"CARD",refundableAmount:20}]}),true);
 assert.equal(m.hasWalletInvoiceSource({hasWalletPayment:false,refundablePayments:[{method:"CARD",refundableAmount:20}]}),false);
 assert.equal(m.hasWalletInvoiceSource({hasWalletPayment:true,refundablePayments:[{method:"CARD",refundableAmount:20}]}),true,"the original tender remains authoritative after its refundable Wallet balance reaches zero");
 const page=await readFile("src/app/(business)/invoices/page.tsx","utf8"),modal=await readFile("src/components/appointment-invoice-modal.tsx","utf8");
 assert.match(page,/hasWalletPayment:\s*invoice\.payments\.some/);assert.match(modal,/hasWalletInvoiceSource\(invoice\)/);
 const cashier=await readFile("src/app/(business)/cashier/actions.ts","utf8"),crm=await readFile("src/app/(business)/crm/page.tsx","utf8");
 assert.match(cashier,/hasWalletPayment:\s*walletCents\s*>\s*0/);assert.match(crm,/hasWalletPayment:\s*invoice\.payments\.some/);
 const form=await readFile("src/components/wallet/wallet-refund-form.tsx","utf8");
 assert.match(form,/findSavedRefundIntent\(entries,sourceId,kind,recoveryScope\)/);assert.match(form,/saved&&!options/);assert.match(form,/WalletRefundPending request=\{saved\}/,"saved confirmation remains visible if options/recovery action fails");
});
